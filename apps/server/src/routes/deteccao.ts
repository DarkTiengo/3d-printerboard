import type { FastifyInstance } from 'fastify';
import type { DeteccaoPrefsInput } from '@gridfarm/shared';
import { padroesDeteccao, prefsDe, salvarPrefs } from '../services/deteccao.js';
import { baixarModelo, estadoDoModelo } from '../services/modelo.js';
import { exigirLogin, exigirPermissao } from '../lib/guard.js';
import { acharPrinter } from '../services/printers.repo.js';
import { logger } from '../lib/logger.js';

export async function rotasDeteccao(app: FastifyInstance): Promise<void> {
  /** Estado do arquivo do modelo, para a tela dizer se dá para ligar. */
  app.get('/api/deteccao/modelo', { preHandler: exigirLogin }, async () => ({
    modelo: await estadoDoModelo(),
    padroes: padroesDeteccao()
  }));

  /**
   * Baixa o modelo. É admin porque faz o servidor buscar uma URL da rede — a
   * mesma razão pela qual só admin cadastra o endereço de uma impressora.
   */
  app.post(
    '/api/deteccao/modelo',
    {
      preHandler: exigirPermissao('gerirImpressoras'),
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    },
    async (req) => {
      logger.info({ por: req.sessao!.usuario }, 'download do modelo de detecção');
      return { ok: true, modelo: await baixarModelo() };
    }
  );

  app.get<{ Params: { id: string } }>('/api/printers/:id/deteccao', { preHandler: exigirLogin }, async (req, reply) => {
    const cfg = acharPrinter(req.params.id);
    if (!cfg) return reply.code(404).send({ erro: 'impressora não encontrada' });
    return { prefs: prefsDe(req.params.id), padroes: padroesDeteccao() };
  });

  /**
   * Ligar isto autoriza o servidor a pausar impressão sozinho, e é papel de
   * admin pelo mesmo motivo que gerir impressoras é.
   */
  app.put<{ Params: { id: string }; Body: DeteccaoPrefsInput }>(
    '/api/printers/:id/deteccao',
    { preHandler: exigirPermissao('gerirImpressoras') },
    async (req, reply) => {
      const cfg = acharPrinter(req.params.id);
      if (!cfg) return reply.code(404).send({ erro: 'impressora não encontrada' });

      const prefs = salvarPrefs(req.params.id, req.body ?? {});
      logger.info({ printer: req.params.id, por: req.sessao!.usuario, prefs }, 'detecção de falha alterada');
      return { ok: true, prefs, padroes: padroesDeteccao() };
    }
  );
}
