import type { FastifyInstance } from 'fastify';
import type { NotificacaoPrefs } from '@3dfarm/shared';
import { CODIGOS_DE_ALERTA, SEGREDO_MASCARADO } from '@3dfarm/shared';

import { exigirPermissao } from '../lib/guard.js';
import { logger } from '../lib/logger.js';
import { configuracao, enviarTeste, prefs, salvarPrefs, salvarToken, token } from '../services/notificacoes.js';

type Corpo = Partial<NotificacaoPrefs> & { token?: string };

/**
 * O token do bot nunca sai daqui, do mesmo jeito que a chave do Moonraker: a
 * tela recebe `tokenDefinido` e devolve a sentinela quando não quer trocá-lo.
 */
function tokenPedido(corpo: Corpo): string {
  const enviado = (corpo.token ?? '').trim();
  if (!enviado || enviado === SEGREDO_MASCARADO) return token();
  return enviado;
}

function normalizar(corpo: Corpo): NotificacaoPrefs {
  const atual = prefs();
  const conhecidos = new Set(CODIGOS_DE_ALERTA.map((c) => c.codigo));
  return {
    ligado: corpo.ligado ?? atual.ligado,
    chatId: (corpo.chatId ?? atual.chatId).trim(),
    codigos: (corpo.codigos ?? atual.codigos).filter((c) => conhecidos.has(c)),
    avisarResolucao: corpo.avisarResolucao ?? atual.avisarResolucao,
    responderComandos: corpo.responderComandos ?? atual.responderComandos
  };
}

export async function rotasNotificacoes(app: FastifyInstance): Promise<void> {
  app.get('/api/config/notificacoes', { preHandler: exigirPermissao('gerirNotificacoes') }, async () =>
    configuracao()
  );

  app.put<{ Body: Corpo }>(
    '/api/config/notificacoes',
    { preHandler: exigirPermissao('gerirNotificacoes') },
    async (req, reply) => {
      const novo = normalizar(req.body ?? {});
      const tok = tokenPedido(req.body ?? {});

      // ligar sem para onde mandar não é preferência, é engano
      if ((novo.ligado || novo.responderComandos) && (!tok || !novo.chatId)) {
        return reply.code(400).send({ erro: 'Para ligar as notificações, informe o token do bot e o chat.' });
      }

      salvarToken(tok);
      salvarPrefs(novo);
      logger.info({ por: req.sessao!.usuario, ligado: novo.ligado }, 'notificações reconfiguradas');
      return configuracao();
    }
  );

  /*
   * Sempre 200, com `{ ok, erro }`. O front quer a recusa do Telegram inline ao
   * lado do botão, e não num catch — mesma escolha do teste de impressora.
   * Diferente daquele, este dispara tráfego para fora, então tem teto.
   */
  app.post<{ Body: Corpo }>(
    '/api/config/notificacoes/testar',
    {
      preHandler: exigirPermissao('gerirNotificacoes'),
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const corpo = req.body ?? {};
      const tok = tokenPedido(corpo);
      const chatId = (corpo.chatId ?? prefs().chatId).trim();

      if (!tok || !chatId) {
        return reply.code(200).send({ ok: false, erro: 'Informe o token do bot e o chat antes de testar.' });
      }

      try {
        await enviarTeste(tok, chatId);
        return { ok: true as const };
      } catch (err) {
        return reply
          .code(200)
          .send({ ok: false, erro: err instanceof Error ? err.message : 'falha ao falar com o Telegram' });
      }
    }
  );
}
