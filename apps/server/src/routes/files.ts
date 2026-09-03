import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import type { EnqueuePayload } from '@3dfarm/shared';
import { listarBiblioteca, listarArquivos } from '../services/files.js';
import { cancelarJob, despacharJob, enfileirar, filaDaImpressora, listarFila } from '../services/queue.js';
import { config } from '../config.js';
import { exigirLogin, exigirPermissao } from '../lib/guard.js';
import { farm } from '../services/farm.js';
import { logger } from '../lib/logger.js';

export async function rotasFiles(app: FastifyInstance): Promise<void> {
  app.get('/api/arquivos', { preHandler: exigirLogin }, async () => listarBiblioteca());

  app.get<{ Params: { id: string } }>('/api/printers/:id/arquivos', { preHandler: exigirLogin }, async (req) =>
    listarArquivos(req.params.id)
  );

  /** Miniaturas extraídas do G-code, servidas da nossa origem. */
  app.get<{ Params: { arquivo: string } }>('/api/thumbnails/:arquivo', { preHandler: exigirLogin }, async (req, reply) => {
    // path traversal: só aceitamos o nome que nós mesmos geramos
    if (!/^[a-f0-9]{16}\.png$/.test(req.params.arquivo)) {
      return reply.code(400).send({ erro: 'nome inválido' });
    }
    const caminho = path.join(config.thumbsDir, req.params.arquivo);
    if (!fs.existsSync(caminho)) return reply.code(404).send({ erro: 'miniatura não encontrada' });
    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'private, max-age=3600')
      .send(fs.createReadStream(caminho));
  });

  // ── fila ─────────────────────────────────────────────────────────────────

  app.get<{ Querystring: { historico?: string } }>('/api/fila', { preHandler: exigirLogin }, async (req) =>
    listarFila(req.query.historico === '1')
  );

  app.post<{ Body: EnqueuePayload }>('/api/fila', { preHandler: exigirPermissao('enfileirar') }, async (req, reply) => {
    const { arquivo, destino } = req.body ?? {};
    if (!arquivo?.trim()) return reply.code(400).send({ erro: 'informe o arquivo' });
    try {
      return await enfileirar(arquivo.trim(), destino ?? null);
    } catch (err) {
      return reply.code(400).send({ erro: err instanceof Error ? err.message : 'falha ao enfileirar' });
    }
  });

  app.delete<{ Params: { id: string } }>(
    '/api/fila/:id',
    { preHandler: exigirPermissao('enfileirar') },
    async (req, reply) => {
      const job = cancelarJob(Number(req.params.id));
      if (!job) return reply.code(404).send({ erro: 'trabalho não encontrado' });
      return job;
    }
  );

  /** O que esta impressora pode imprimir agora — é o que o painel dela mostra. */
  app.get<{ Params: { id: string } }>('/api/printers/:id/fila', { preHandler: exigirLogin }, async (req) =>
    filaDaImpressora(req.params.id)
  );

  /**
   * Autoriza e inicia uma impressão. Este é o único caminho que dá partida
   * numa máquina pela fila: nada começa sozinho, porque a peça anterior pode
   * continuar na mesa.
   */
  app.post<{ Params: { id: string }; Body: { printerId?: string } }>(
    '/api/fila/:id/iniciar',
    {
      preHandler: exigirPermissao('controlarImpressao'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const printerId = req.body?.printerId;
      if (!printerId) return reply.code(400).send({ erro: 'informe a impressora' });
      try {
        const job = await despacharJob(Number(req.params.id), printerId);
        logger.info({ job: job.id, printer: printerId, por: req.sessao!.usuario }, 'impressão autorizada');
        return job;
      } catch (err) {
        return reply.code(409).send({ erro: err instanceof Error ? err.message : 'não foi possível iniciar' });
      }
    }
  );

  /**
   * Reimprime a peça que acabou de sair. Enfileira o mesmo arquivo endereçado
   * à própria máquina e já autoriza — a pessoa acabou de dizer que quer outra.
   */
  app.post<{ Params: { id: string } }>(
    '/api/printers/:id/reimprimir',
    {
      preHandler: exigirPermissao('controlarImpressao'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const printer = farm.printer(req.params.id);
      if (!printer) return reply.code(404).send({ erro: 'impressora não encontrada' });
      if (!printer.concluiuComSucesso || printer.job === '—') {
        return reply.code(409).send({ erro: 'a última impressão não terminou com sucesso' });
      }
      try {
        const job = await enfileirar(printer.job, printer.id);
        const iniciado = await despacharJob(job.id, printer.id);
        logger.info(
          { job: iniciado.id, printer: printer.id, arquivo: printer.job, por: req.sessao!.usuario },
          'reimpressão autorizada'
        );
        return iniciado;
      } catch (err) {
        return reply.code(409).send({ erro: err instanceof Error ? err.message : 'não foi possível reimprimir' });
      }
    }
  );
}
