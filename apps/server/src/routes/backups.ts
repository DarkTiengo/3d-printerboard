import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { BackupPrefsInput, RestorePayload } from '@3dfarm/shared';
import {
  aplicarRetencaoDeTodas,
  cardsDeBackup,
  coletarLixo,
  listarArquivosDeConfig,
  listarSnapshots,
  padroesBackup,
  prefsDe,
  prepararDownload,
  restaurar,
  resumoDeBackup,
  salvarPrefs
} from '../services/backup.js';
import { pedirBackup, rodarCicloCompleto } from '../services/backup-agenda.js';
import { exigirLogin, exigirPermissao } from '../lib/guard.js';
import { acharPrinter } from '../services/printers.repo.js';
import { logger } from '../lib/logger.js';

export async function rotasBackups(app: FastifyInstance): Promise<void> {
  app.get('/api/backups', { preHandler: exigirLogin }, async () => ({
    resumo: resumoDeBackup(),
    cards: cardsDeBackup()
  }));

  app.get<{ Querystring: { printer?: string } }>('/api/backups/snapshots', { preHandler: exigirLogin }, async (req) =>
    listarSnapshots(req.query.printer)
  );

  /**
   * Backup da fazenda inteira. Só as ociosas começam agora; as que estão
   * imprimindo entram na fila e são copiadas quando terminarem — a resposta
   * diz exatamente quantas caíram em cada caso.
   */
  app.post('/api/backups/rodar', { preHandler: exigirPermissao('rodarBackup') }, async (req) => {
    logger.info({ por: req.sessao!.usuario }, 'backup manual da fazenda');
    const r = rodarCicloCompleto('manual');
    return {
      ok: true,
      iniciados: r.iniciados.length,
      adiados: r.adiados.length,
      offline: r.offline.length,
      adiadasIds: r.adiados
    };
  });

  // ── o que cada impressora copia, de quanto em quanto tempo, quantas cópias ──

  app.get<{ Params: { id: string } }>('/api/backups/:id/prefs', { preHandler: exigirLogin }, async (req, reply) => {
    const cfg = acharPrinter(req.params.id);
    if (!cfg) return reply.code(404).send({ erro: 'impressora não encontrada' });
    return { prefs: prefsDe(req.params.id), padroes: padroesBackup() };
  });

  /**
   * Mudar a retenção para menos apaga cópias na hora — por isso é papel admin,
   * o mesmo de restaurar.
   */
  app.put<{ Params: { id: string }; Body: BackupPrefsInput }>(
    '/api/backups/:id/prefs',
    { preHandler: exigirPermissao('restaurarBackup') },
    async (req, reply) => {
      const cfg = acharPrinter(req.params.id);
      if (!cfg) return reply.code(404).send({ erro: 'impressora não encontrada' });

      const prefs = salvarPrefs(req.params.id, req.body ?? {});
      logger.info({ printer: req.params.id, por: req.sessao!.usuario, prefs }, 'preferências de backup alteradas');
      // a retenção nova pode ser menor que a antiga: aplica já
      await aplicarRetencaoDeTodas();
      await coletarLixo();
      return { ok: true, prefs, padroes: padroesBackup() };
    }
  );

  /**
   * Os arquivos de config que estão na máquina agora, para o usuário marcar
   * quais entram. Vai buscar ao vivo: só funciona com a impressora na rede.
   */
  app.get<{ Params: { id: string } }>(
    '/api/backups/:id/arquivos',
    { preHandler: exigirLogin },
    async (req, reply) => {
      try {
        return await listarArquivosDeConfig(req.params.id);
      } catch (err) {
        return reply
          .code(503)
          .send({ erro: err instanceof Error ? err.message : 'não foi possível listar os arquivos' });
      }
    }
  );

  /**
   * Baixar uma cópia. `gcode=1` remonta o zip com a biblioteca de peças junto —
   * o que fica guardado no disco não a repete, para não multiplicar gigabytes
   * por cópia.
   */
  app.get<{ Params: { id: string }; Querystring: { gcode?: string } }>(
    '/api/backups/snapshots/:id/baixar',
    { preHandler: exigirPermissao('rodarBackup') },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ erro: 'snapshot inválido' });

      try {
        const comGcode = req.query.gcode === '1' || req.query.gcode === 'true';
        const download = await prepararDownload(id, comGcode);
        logger.info({ snapshot: id, por: req.sessao!.usuario, comGcode }, 'download de backup');

        reply
          .header('content-type', 'application/zip')
          .header('content-disposition', `attachment; filename="${download.nome}"`);

        if (download.tipo === 'arquivo') {
          if (download.nome.endsWith('.tar.gz')) reply.header('content-type', 'application/gzip');
          return reply.send(createReadStream(download.caminho));
        }
        // zip montado na hora: pipa primeiro, fecha depois
        void reply.send(download.zip);
        void download.zip.finalize();
        return reply;
      } catch (err) {
        return reply.code(404).send({ erro: err instanceof Error ? err.message : 'snapshot não encontrado' });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/backups/:id/rodar',
    { preHandler: exigirPermissao('rodarBackup') },
    async (req, reply) => {
      const cfg = acharPrinter(req.params.id);
      if (!cfg) return reply.code(404).send({ erro: 'impressora não encontrada' });

      logger.info({ printer: req.params.id, por: req.sessao!.usuario }, 'backup manual');
      const resultado = pedirBackup(req.params.id, 'manual');

      if (resultado === 'offline') {
        return reply.code(503).send({ erro: 'impressora offline' });
      }
      return { ok: true, resultado, nome: cfg.nome };
    }
  );

  /**
   * Restauração sobrescreve a config da impressora de destino.
   * Só admin, e o corpo precisa confirmar explicitamente.
   */
  app.post<{ Body: RestorePayload & { confirmar?: boolean } }>(
    '/api/backups/restaurar',
    {
      preHandler: exigirPermissao('restaurarBackup'),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const { snapshotId, destinoPrinterId, confirmar } = req.body ?? {};
      if (!snapshotId || !destinoPrinterId) {
        return reply.code(400).send({ erro: 'informe o snapshot e a impressora de destino' });
      }
      if (!confirmar) {
        return reply.code(400).send({ erro: 'a restauração precisa ser confirmada' });
      }
      try {
        const r = await restaurar(snapshotId, destinoPrinterId);
        logger.warn({ por: req.sessao!.usuario, snapshotId, destinoPrinterId }, 'restauração executada');
        return { ok: true, ...r };
      } catch (err) {
        return reply.code(400).send({ erro: err instanceof Error ? err.message : 'falha na restauração' });
      }
    }
  );

  app.post('/api/backups/limpar', { preHandler: exigirPermissao('restaurarBackup') }, async () => ({
    removidos: await coletarLixo()
  }));
}
