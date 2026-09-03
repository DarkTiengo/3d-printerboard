-- Migration 001 — esquema inicial.
-- Rodado inteiro numa transação por src/db/index.ts; tudo é IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'operador', 'leitura')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS printers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  moonraker_url  TEXT NOT NULL,
  api_key        TEXT,
  camera_url     TEXT,
  backup_enabled INTEGER NOT NULL DEFAULT 1,
  order_index    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS queue_jobs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  filename          TEXT NOT NULL,
  -- NULL = "próxima livre"
  target_printer_id TEXT REFERENCES printers(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','atribuido','imprimindo','concluido','falhou','cancelado')),
  printer_id        TEXT REFERENCES printers(id) ON DELETE SET NULL,
  tempo             TEXT,
  erro              TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT,
  finished_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  printer_id   TEXT REFERENCES printers(id) ON DELETE SET NULL,
  printer_name TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('alta','media','baixa')),
  -- chave estável do tipo de alerta; o título traduzido é montado no front
  codigo       TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  frame_label  TEXT NOT NULL DEFAULT '',
  frame_path   TEXT,
  -- evita empilhar o mesmo alerta a cada reconexão do WebSocket
  dedupe_key   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT,
  resolved_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedupe
  ON alerts(dedupe_key) WHERE dedupe_key IS NOT NULL AND resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS backup_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  printer_id   TEXT NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('OK','PARCIAL','FALHOU','RODANDO')),
  bytes        INTEGER NOT NULL DEFAULT 0,
  file_count   INTEGER NOT NULL DEFAULT 0,
  archive_path TEXT,
  firmware     TEXT,
  gcode_resumo TEXT,
  error        TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_backup_printer ON backup_runs(printer_id, started_at DESC);

-- Preferências de backup por impressora: o que copiar, de quanto em quanto
-- tempo e quantas cópias guardar. Linha ausente = tudo, no padrão global.
CREATE TABLE IF NOT EXISTS backup_prefs (
  printer_id      TEXT PRIMARY KEY REFERENCES printers(id) ON DELETE CASCADE,
  -- lista separada por vírgula: config,banco,sistema,gcode
  secoes          TEXT NOT NULL DEFAULT 'config,banco,sistema,gcode',
  -- JSON com os caminhos de config desmarcados
  excluidos       TEXT NOT NULL DEFAULT '[]',
  -- NULL = herda o valor global
  intervalo_horas INTEGER,
  retencao        INTEGER,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
