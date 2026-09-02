import type { PrinterConfig, PrinterConfigInput } from '@3dfarm/shared';
import { getDb } from '../db/index.js';

type Row = {
  id: string;
  name: string;
  moonraker_url: string;
  api_key: string | null;
  camera_url: string | null;
  backup_enabled: number;
  order_index: number;
};

function paraConfig(r: Row): PrinterConfig {
  return {
    id: r.id,
    nome: r.name,
    moonrakerUrl: r.moonraker_url,
    apiKey: r.api_key,
    cameraUrl: r.camera_url,
    backupEnabled: !!r.backup_enabled,
    ordem: r.order_index
  };
}

export function listarPrinters(): PrinterConfig[] {
  const rows = getDb()
    .prepare('SELECT * FROM printers ORDER BY order_index, id')
    .all() as Row[];
  return rows.map(paraConfig);
}

export function acharPrinter(id: string): PrinterConfig | null {
  const row = getDb().prepare('SELECT * FROM printers WHERE id = ?').get(id) as Row | undefined;
  return row ? paraConfig(row) : null;
}

/** IDs seguem o padrão do design: P01, P02… Gera o próximo livre. */
export function proximoId(): string {
  const rows = getDb().prepare("SELECT id FROM printers WHERE id GLOB 'P[0-9][0-9]'").all() as { id: string }[];
  const usados = new Set(rows.map((r) => r.id));
  for (let i = 1; i <= 99; i++) {
    const id = `P${String(i).padStart(2, '0')}`;
    if (!usados.has(id)) return id;
  }
  throw new Error('limite de 99 impressoras atingido');
}

export function criarPrinter(entrada: PrinterConfigInput): PrinterConfig {
  const id = entrada.id?.trim() || proximoId();
  const maxOrdem = (getDb().prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM printers').get() as { m: number }).m;
  const ordem = entrada.ordem ?? maxOrdem + 1;
  getDb()
    .prepare(
      `INSERT INTO printers (id, name, moonraker_url, api_key, camera_url, backup_enabled, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      entrada.nome,
      entrada.moonrakerUrl,
      entrada.apiKey || null,
      entrada.cameraUrl || null,
      entrada.backupEnabled ? 1 : 0,
      ordem
    );
  return acharPrinter(id)!;
}

export function atualizarPrinter(id: string, entrada: PrinterConfigInput): PrinterConfig | null {
  const atual = acharPrinter(id);
  if (!atual) return null;
  getDb()
    .prepare(
      `UPDATE printers
          SET name = ?, moonraker_url = ?, api_key = ?, camera_url = ?, backup_enabled = ?, order_index = ?
        WHERE id = ?`
    )
    .run(
      entrada.nome,
      entrada.moonrakerUrl,
      entrada.apiKey || null,
      entrada.cameraUrl || null,
      entrada.backupEnabled ? 1 : 0,
      entrada.ordem ?? atual.ordem,
      id
    );
  return acharPrinter(id);
}

export function removerPrinter(id: string): boolean {
  const r = getDb().prepare('DELETE FROM printers WHERE id = ?').run(id);
  return r.changes > 0;
}
