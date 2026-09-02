import type { FastifyReply, FastifyRequest } from 'fastify';
import { pode } from '@3dfarm/shared';
import type { Acao } from '@3dfarm/shared';
import { COOKIE_SESSAO, lerToken, type Sessao } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    sessao?: Sessao;
  }
}

/** preHandler: exige sessão válida. */
export async function exigirLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies?.[COOKIE_SESSAO];
  const sessao = token ? lerToken(token) : null;
  if (!sessao) {
    await reply.code(401).send({ erro: 'não autenticado' });
    return;
  }
  req.sessao = sessao;
}

/** preHandler: exige sessão válida com permissão para a ação. */
export function exigirPermissao(acao: Acao) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await exigirLogin(req, reply);
    if (reply.sent) return;
    if (!pode(req.sessao?.role, acao)) {
      await reply.code(403).send({ erro: 'sem permissão para esta ação' });
    }
  };
}
