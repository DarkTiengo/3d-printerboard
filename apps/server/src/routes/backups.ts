import type { FastifyInstance } from 'fastify';
import type { RestorePayload } from '@3dfarm/shared';
import {
  cardsDeBackup,
  coletarLixo,
  listarSnapshots,
  restaurar,
  resumoDeBackup
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
    { preHandler: exigirPermissao('restaurarBackup') },
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
