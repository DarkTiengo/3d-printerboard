import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@3dfarm/shared';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const CUSTO_BCRYPT = 12;
export const COOKIE_SESSAO = 'printerboard_sessao';

type UserRow = { id: number; username: string; password_hash: string; role: Role };

export function acharUsuario(username: string): UserRow | null {
  return (getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow) ?? null;
}

export function listarUsuarios(): User[] {
  const rows = getDb().prepare('SELECT id, username, role FROM users ORDER BY username').all() as User[];
  return rows;
}

export function criarUsuario(username: string, senha: string, role: Role): User {
  const hash = bcrypt.hashSync(senha, CUSTO_BCRYPT);
  const r = getDb()
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, role);
  return { id: Number(r.lastInsertRowid), username, role };
}

export function trocarSenha(id: number, senha: string): void {
  const hash = bcrypt.hashSync(senha, CUSTO_BCRYPT);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
}

export function removerUsuario(id: number): boolean {
  return getDb().prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
}

export function contarAdmins(): number {
  const r = getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number };
  return r.n;
}

/**
 * Verifica credenciais. Sempre roda um bcrypt, mesmo com usuário inexistente,
 * para o tempo de resposta não denunciar quais usuários existem.
 */
const HASH_FALSO = bcrypt.hashSync('usuario-inexistente', CUSTO_BCRYPT);

export function verificarCredenciais(username: string, senha: string): User | null {
  const row = acharUsuario(username);
  const hash = row?.password_hash ?? HASH_FALSO;
  const ok = bcrypt.compareSync(senha, hash);
  if (!ok || !row) return null;
  return { id: row.id, username: row.username, role: row.role };
}

// ── sessão ──────────────────────────────────────────────────────────────────

export type Sessao = { sub: number; usuario: string; role: Role };

export function assinarToken(user: User, lembrar: boolean): { token: string; maxAge: number } {
  const maxAge = lembrar ? config.sessaoLongaDias * 86_400 : config.sessaoCurtaHoras * 3_600;
  const token = jwt.sign({ sub: user.id, usuario: user.username, role: user.role } satisfies Sessao, config.jwtSecret, {
    expiresIn: maxAge
  });
  return { token, maxAge };
}

export function lerToken(token: string): Sessao | null {
  try {
    return jwt.verify(token, config.jwtSecret) as unknown as Sessao;
  } catch {
    return null;
  }
}

/**
 * Cria o admin inicial no primeiro boot. Sem ADMIN_PASSWORD e sem nenhum
 * usuário no banco o app fica inacessível — então avisamos alto.
 */
export function garantirAdmin(): void {
  const n = (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (n > 0) return;

  if (!config.adminPassword) {
    logger.error(
      'Nenhum usuário cadastrado e ADMIN_PASSWORD não foi definido. ' +
        'Defina ADMIN_USER/ADMIN_PASSWORD no .env e reinicie — sem isso não há como entrar.'
    );
    return;
  }
  criarUsuario(config.adminUser, config.adminPassword, 'admin');
  logger.info(`Usuário admin "${config.adminUser}" criado a partir do .env.`);
}
