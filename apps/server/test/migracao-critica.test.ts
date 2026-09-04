import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { abrirBanco, fecharBanco } from '../src/db/index.js';
import { config } from '../src/config.js';

/**
 * A severidade 'critica' entrou depois do esquema inicial, e o CHECK de uma
 * tabela é imutável no SQLite. Quem já rodava o app tem um banco que rejeita
 * todo alerta crítico — o alerta mais importante do projeto seria justamente o
 * único que não grava. Este teste é sobre esse banco, não sobre um novo.
 */

const ESQUEMA_ANTIGO = `
CREATE TABLE printers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  moonraker_url  TEXT NOT NULL,
  api_key        TEXT,
  camera_url     TEXT,
  backup_enabled INTEGER NOT NULL DEFAULT 1,
  order_index    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  printer_id   TEXT REFERENCES printers(id) ON DELETE SET NULL,
  printer_name TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('alta','media','baixa')),
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
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);
CREATE UNIQUE INDEX idx_alerts_dedupe
  ON alerts(dedupe_key) WHERE dedupe_key IS NOT NULL AND resolved_at IS NULL;
`;

let dir: string | null = null;

function bancoAntigo(): void {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printerboard-mig-'));
  for (const chave of ['dataDir', 'backupsDir', 'framesDir', 'thumbsDir', 'blobsDir'] as const) {
    (config as any)[chave] = path.join(dir, chave);
  }
  (config as any).dbPath = path.join(dir, 'app.db');

  const db = new Database(config.dbPath);
  db.exec(ESQUEMA_ANTIGO);
  db.prepare(
    `INSERT INTO alerts (id, printer_name, severity, codigo, title, detail, dedupe_key, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(7, 'Voron 0.2', 'alta', 'erro_impressao', 'Impressão interrompida', 'detalhe', 'erro:P05', null);
  db.close();
}

afterEach(() => {
  fecharBanco();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('migração da severidade crítica', () => {
  it('passa a aceitar alertas críticos sem perder os que já existiam', () => {
    bancoAntigo();
    const db = abrirBanco();

    // a linha antiga sobreviveu inteira, id e tudo
    expect(db.prepare('SELECT * FROM alerts WHERE id = 7').get()).toMatchObject({
      id: 7,
      printer_name: 'Voron 0.2',
      severity: 'alta',
      codigo: 'erro_impressao',
      dedupe_key: 'erro:P05'
    });

    expect(() =>
      db
        .prepare(
          `INSERT INTO alerts (printer_name, severity, codigo, title, dedupe_key)
           VALUES ('Voron 0.2', 'critica', 'klipper_parado', 'Klipper parado', 'klippy:P05')`
        )
        .run()
    ).not.toThrow();

    // e o CHECK continua valendo para o que não é severidade
    expect(() =>
      db
        .prepare(`INSERT INTO alerts (printer_name, severity, title) VALUES ('x', 'urgentissima', 'y')`)
        .run()
    ).toThrow();
  });

  it('recria os índices que o rebuild derrubou, incluindo o dedupe', () => {
    bancoAntigo();
    const db = abrirBanco();

    const indices = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'alerts'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(indices).toContain('idx_alerts_created');
    expect(indices).toContain('idx_alerts_dedupe');

    // sem o índice único, cada reconexão empilharia um alerta igual
    db.prepare(
      `INSERT INTO alerts (printer_name, severity, title, dedupe_key)
       VALUES ('Voron 0.2', 'critica', 'Klipper parado', 'klippy:P05')`
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO alerts (printer_name, severity, title, dedupe_key)
           VALUES ('Voron 0.2', 'critica', 'Klipper parado', 'klippy:P05')`
        )
        .run()
    ).toThrow();
  });

  it('é idempotente: reabrir o banco já migrado não mexe em nada', () => {
    bancoAntigo();
    abrirBanco();
    fecharBanco();

    const db = abrirBanco();
    expect(db.prepare("SELECT COUNT(*) c FROM alerts").get()).toMatchObject({ c: 1 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'alerts_antiga'").get()).toBeUndefined();
  });
});
