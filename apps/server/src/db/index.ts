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

  for (const dir of [config.dataDir, config.backupsDir, config.framesDir, config.thumbsDir, config.blobsDir]) {
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

  return db;
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
