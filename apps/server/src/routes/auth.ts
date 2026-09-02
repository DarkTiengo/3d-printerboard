import type { FastifyInstance } from 'fastify';
import type { LoginPayload, Role } from '@3dfarm/shared';
import { config } from '../config.js';
import {
  COOKIE_SESSAO,
  assinarToken,
  contarAdmins,
  criarUsuario,
  listarUsuarios,
  removerUsuario,
  trocarSenha,
  verificarCredenciais,
  acharUsuario
} from '../services/auth.js';
import { exigirLogin, exigirPermissao } from '../lib/guard.js';
import { logger } from '../lib/logger.js';

const ROLES: Role[] = ['admin', 'operador', 'leitura'];

export async function rotasAuth(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Partial<LoginPayload> }>(
    '/api/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const { usuario, senha, lembrar } = req.body ?? {};
      if (!usuario?.trim() || !senha) {
        return reply.code(400).send({ erro: 'Informe usuário e senha.' });
      }

      const user = verificarCredenciais(usuario.trim(), senha);
      if (!user) {
        logger.warn({ usuario, ip: req.ip }, 'login recusado');
        return reply.code(401).send({ erro: 'Usuário ou senha inválidos.' });
      }

      const { token, maxAge } = assinarToken(user, !!lembrar);
      reply.setCookie(COOKIE_SESSAO, token, {
        httpOnly: true,
        sameSite: 'strict',
        // 'auto': Secure só quando a conexão realmente é HTTPS. Um cookie
        // Secure enviado por http:// é descartado pelo navegador em qualquer
        // origem que não seja localhost — e a fazenda é acessada pelo IP.
        secure:
          config.cookieSecure === 'auto' ? req.protocol === 'https' : config.cookieSecure === 'true',
        path: '/',
        maxAge
      });
      return { usuario: user };
    }
  );

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_SESSAO, { path: '/' });
    return { ok: true };
  });

  /** O front chama no boot para decidir entre login e painel. */
  app.get('/api/auth/eu', { preHandler: exigirLogin }, async (req) => ({
    usuario: { id: req.sessao!.sub, username: req.sessao!.usuario, role: req.sessao!.role }
  }));

  // ── gestão de usuários (admin) ───────────────────────────────────────────

  app.get('/api/usuarios', { preHandler: exigirPermissao('gerirUsuarios') }, async () => listarUsuarios());

  app.post<{ Body: { usuario?: string; senha?: string; role?: Role } }>(
    '/api/usuarios',
    {
      preHandler: exigirPermissao('gerirUsuarios'),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const { usuario, senha, role } = req.body ?? {};
      if (!usuario?.trim() || !senha || senha.length < 8) {
        return reply.code(400).send({ erro: 'Usuário obrigatório e senha com ao menos 8 caracteres.' });
      }
      if (!role || !ROLES.includes(role)) {
        return reply.code(400).send({ erro: 'Papel inválido.' });
      }
      if (acharUsuario(usuario.trim())) {
        return reply.code(409).send({ erro: 'Já existe um usuário com esse nome.' });
      }
      return criarUsuario(usuario.trim(), senha, role);
    }
  );

  app.put<{ Params: { id: string }; Body: { senha?: string } }>(
    '/api/usuarios/:id/senha',
    { preHandler: exigirLogin, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const id = Number(req.params.id);
      const eu = req.sessao!;
      // trocar a própria senha é permitido a qualquer papel; a dos outros, só admin
      if (eu.sub !== id && eu.role !== 'admin') {
        return reply.code(403).send({ erro: 'sem permissão para esta ação' });
      }
      const senha = req.body?.senha;
      if (!senha || senha.length < 8) {
        return reply.code(400).send({ erro: 'Senha com ao menos 8 caracteres.' });
      }
      trocarSenha(id, senha);
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/usuarios/:id',
    { preHandler: exigirPermissao('gerirUsuarios') },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (id === req.sessao!.sub) {
        return reply.code(400).send({ erro: 'Você não pode remover a própria conta.' });
      }
      // sem esta trava dá para ficar sem nenhum admin e perder o acesso à gestão
      const alvo = listarUsuarios().find((u) => u.id === id);
      if (alvo?.role === 'admin' && contarAdmins() <= 1) {
        return reply.code(400).send({ erro: 'É o último administrador — promova outro antes de remover.' });
      }
      if (!removerUsuario(id)) return reply.code(404).send({ erro: 'usuário não encontrado' });
      return { ok: true };
    }
  );
}
