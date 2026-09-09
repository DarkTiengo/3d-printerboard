import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

let db: DB | null = null;

export function abrirBanco(): DB {
  if (db) return db;

  for (const dir of [
    config.dataDir,
    config.backupsDir,
    config.framesDir,
    config.thumbsDir,
    config.blobsDir,
    config.modelosDir
  ]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      // caso clássico no Docker: o bind mount ./data foi criado pelo daemon e
      // pertence ao root, enquanto o processo roda como node (uid 1000)
      if ((err as NodeJS.ErrnoException).code === 'EACCES') {
        throw new Error(
          `Sem permissão de escrita em ${dir}. No Docker, isso quase sempre é o volume ./data ` +
            `pertencendo ao root: rode "mkdir -p data && sudo chown -R $(id -u):$(id -g) data" ` +
            `e suba de novo, ou ajuste PUID/PGID no .env.`
        );
      }
      throw err;
    }
  }

  db = new Database(config.dbPath);
  // WAL: leituras do front não travam enquanto o backup escreve.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const schema = fs.readFileSync(path.join(aqui, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrarSeveridadeCritica(db);
  migrarRotacaoDaCamera(db);

  return db;
}

/**
 * Migração 002 — a severidade 'critica' entrou depois do esquema inicial.
 *
 * O CHECK de uma tabela é imutável no SQLite, e `CREATE TABLE IF NOT EXISTS` é
 * um no-op onde `alerts` já existe: bancos criados antes desta versão
 * rejeitariam todo alerta crítico. A saída é o rebuild clássico — tabela nova,
 * cópia, troca — e ele só roda quando o CHECK antigo ainda está lá.
 */
function migrarSeveridadeCritica(db: DB): void {
  const atual = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'alerts'")
    .get() as { sql: string } | undefined;
  if (!atual || atual.sql.includes("'critica'")) return;

  /*
   * `codigo` também entrou depois do esquema inicial, e antes da severidade
   * crítica. Num banco daquela época a coluna não existe, e copiá-la pelo nome
   * fazia o SELECT estourar com "no such column: codigo" — dentro do
   * abrirBanco(), ou seja, antes de o servidor subir. O app não voltava mais,
   * e nada no erro dizia que a causa era a idade do banco.
   *
   * Onde ela falta, entra string vazia, que é o default da coluna no esquema
   * novo. O alerta antigo perde o código e fica com o título que o servidor
   * escreveu na época — que é exatamente o que o front usa como reserva.
   */
  const colunas = db.prepare('PRAGMA table_info(alerts)').all() as { name: string }[];
  const origemCodigo = colunas.some((c) => c.name === 'codigo') ? 'codigo' : "''";

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    ALTER TABLE alerts RENAME TO alerts_antiga;
    CREATE TABLE alerts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      printer_id   TEXT REFERENCES printers(id) ON DELETE SET NULL,
      printer_name TEXT NOT NULL,
      severity     TEXT NOT NULL CHECK (severity IN ('critica','alta','media','baixa')),
      codigo       TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL,
      detail       TEXT NOT NULL DEFAULT '',
      frame_label  TEXT NOT NULL DEFAULT '',
      frame_path   TEXT,
      dedupe_key   TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at  TEXT,
      resolved_by  TEXT
    );
    INSERT INTO alerts (id, printer_id, printer_name, severity, codigo, title, detail,
                        frame_label, frame_path, dedupe_key, created_at, resolved_at, resolved_by)
      SELECT id, printer_id, printer_name, severity, ${origemCodigo}, title, detail,
             frame_label, frame_path, dedupe_key, created_at, resolved_at, resolved_by
      FROM alerts_antiga;
    -- os índices seguiram a tabela no RENAME e morrem com ela
    DROP TABLE alerts_antiga;
    CREATE INDEX idx_alerts_created ON alerts(created_at DESC);
    CREATE UNIQUE INDEX idx_alerts_dedupe
      ON alerts(dedupe_key) WHERE dedupe_key IS NOT NULL AND resolved_at IS NULL;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

/**
 * Migração 003 — a rotação da câmera entrou depois do esquema inicial.
 *
 * `CREATE TABLE IF NOT EXISTS` não mexe numa tabela que já existe, então quem
 * atualizou o app teria a coluna faltando e todo SELECT quebraria. Aqui não
 * precisa do rebuild da 002: acrescentar coluna com DEFAULT é barato no SQLite
 * e as linhas antigas já saem com 0 — que é "não gira", o que sempre valeu.
 */
function migrarRotacaoDaCamera(db: DB): void {
  const colunas = db.prepare('PRAGMA table_info(printers)').all() as { name: string }[];
  if (colunas.some((c) => c.name === 'camera_rotation')) return;
  db.exec('ALTER TABLE printers ADD COLUMN camera_rotation INTEGER NOT NULL DEFAULT 0');
}

export function getDb(): DB {
  if (!db) throw new Error('banco não aberto — chame abrirBanco() primeiro');
  return db;
}

export function fecharBanco(): void {
  db?.close();
  db = null;
}

// ── settings ────────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}
