import type { FastifyReply, FastifyRequest } from 'fastify';
import { pode } from '@3dfarm/shared';
import type { Acao, Role } from '@3dfarm/shared';
import { COOKIE_SESSAO, acharUsuarioPorId, lerToken, type Sessao } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    sessao?: Sessao;
  }
}

/**
 * preHandler: exige sessão válida.
 *
 * O papel vem do banco, não do token. O JWT é assinado no login e vive até 30
 * dias; sem esta consulta, remover um usuário ou rebaixá-lo de admin não teria
 * efeito nenhum até o token expirar — o crachá continuaria abrindo a porta.
 */
export async function exigirLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies?.[COOKIE_SESSAO];
  const sessao = token ? lerToken(token) : null;
  if (!sessao) {
    await reply.code(401).send({ erro: 'não autenticado' });
    return;
  }

  const atual = acharUsuarioPorId(sessao.sub);
  if (!atual) {
    // conta removida enquanto o token ainda era válido
    reply.clearCookie(COOKIE_SESSAO, { path: '/' });
    await reply.code(401).send({ erro: 'sessão inválida' });
    return;
  }

  req.sessao = { sub: atual.id, usuario: atual.username, role: atual.role as Role };
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
