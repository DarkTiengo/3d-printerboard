import path from 'node:path';
import fs from 'node:fs/promises';
import type { Alert, Printer, Severidade } from '@3dfarm/shared';

import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { farm } from '../services/farm.js';
import { cameras } from './cameras.js';
import { logger } from '../lib/logger.js';

type Row = {
  id: number;
  codigo: string | null;
  printer_id: string | null;
  printer_name: string;
  severity: Severidade;
  title: string;
  detail: string;
  frame_label: string;
  frame_path: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

function paraAlert(r: Row): Alert {
  return {
    id: r.id,
    codigo: r.codigo ?? '',
    titulo: r.title,
    impressora: r.printer_name,
    printerId: r.printer_id,
    criadoEm: r.created_at + 'Z',
    sev: r.severity,
    detalhe: r.detail,
    frame: r.frame_label,
    frameUrl: r.frame_path ? `/api/alertas/${r.id}/frame` : null,
    resolvidoEm: r.resolved_at ? r.resolved_at + 'Z' : null,
    resolvidoPor: r.resolved_by
  };
}

export function listarAlertas(incluirResolvidos = false, limite = 100): Alert[] {
  const sql = incluirResolvidos
    ? 'SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT ?';
  return (getDb().prepare(sql).all(limite) as Row[]).map(paraAlert);
}

export function acharAlerta(id: number): { alert: Alert; framePath: string | null } | null {
  const r = getDb().prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Row | undefined;
  return r ? { alert: paraAlert(r), framePath: r.frame_path } : null;
}

export function resolverAlerta(id: number, por: string): Alert | null {
  getDb()
    .prepare("UPDATE alerts SET resolved_at = datetime('now'), resolved_by = ? WHERE id = ? AND resolved_at IS NULL")
    .run(por, id);
  return acharAlerta(id)?.alert ?? null;
}

export type NovoAlerta = {
  printerId: string | null;
  printerNome: string;
  sev: Severidade;
  /** chave estável do tipo — é o que o front usa para traduzir o título */
  codigo: string;
  titulo: string;
  detalhe: string;
  frameLabel?: string;
  /** Enquanto houver um alerta aberto com esta chave, não criamos outro. */
  dedupeKey?: string;
  /** Guarda o quadro da câmera no instante do alerta. */
  capturarFrame?: boolean;
};

/**
 * Cria um alerta. Emite pelo hub SSE via callback registrado em ligarAlertas().
 * Devolve null quando o dedupe barrou — é o caso comum de reconexão em loop.
 */
export async function criarAlerta(novo: NovoAlerta): Promise<Alert | null> {
  const db = getDb();
  const existente = novo.dedupeKey
    ? db.prepare('SELECT id FROM alerts WHERE dedupe_key = ? AND resolved_at IS NULL').get(novo.dedupeKey)
    : undefined;
  if (existente) return null;

  const info = db
    .prepare(
      `INSERT INTO alerts (printer_id, printer_name, severity, codigo, title, detail, frame_label, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      novo.printerId,
      novo.printerNome,
      novo.sev,
      novo.codigo,
      novo.titulo,
      novo.detalhe,
      novo.frameLabel ?? '',
      novo.dedupeKey ?? null
    );
  const id = Number(info.lastInsertRowid);

  if (novo.capturarFrame && novo.printerId) {
    // fora do caminho crítico: se a câmera demorar, o alerta já existe
    void capturarFrame(id, novo.printerId);
  }

  const alert = acharAlerta(id)!.alert;
  logger.info({ alerta: id, sev: novo.sev, printer: novo.printerId }, novo.titulo);
  emissor?.(alert);
  return alert;
}

async function capturarFrame(alertaId: number, printerId: string): Promise<void> {
  try {
    // o frame do alerta precisa ser do instante do alerta, não um cacheado
    const jpeg = await cameras.capturar(printerId, 1_000);
    if (!jpeg) return;
    const arquivo = path.join(config.framesDir, `alerta-${alertaId}.jpg`);
    await fs.writeFile(arquivo, jpeg);
    getDb().prepare('UPDATE alerts SET frame_path = ? WHERE id = ?').run(arquivo, alertaId);
    const alert = acharAlerta(alertaId)?.alert;
    if (alert) emissor?.(alert);
  } catch (err) {
    logger.warn(`não foi possível capturar o frame do alerta ${alertaId}: ${err}`);
  }
}

let emissor: ((a: Alert) => void) | null = null;
export function aoCriarAlerta(fn: (a: Alert) => void): void {
  emissor = fn;
}

// ── gerador ─────────────────────────────────────────────────────────────────

const nomeCurto = (p: Printer) => p.nome;

/**
 * Observa o Farm e as câmeras e transforma transições em alertas.
 * As regras são as do § 7 do plano; o que dispara é sempre uma *transição*,
 * nunca o estado em si — senão cada update do Klipper geraria um alerta.
 */
export function ligarGeradorDeAlertas(): void {
  farm.on('printer', (atual: Printer, anterior: Printer | null) => {
    if (!anterior) return;

    if (anterior.status !== 'atenção' && atual.status === 'atenção') {
      void criarAlerta({
        printerId: atual.id,
        printerNome: nomeCurto(atual),
        sev: 'alta',
        codigo: 'erro_impressao',
        titulo: 'Impressão interrompida por erro',
        detalhe: `${atual.job} parou na camada ${atual.camada}. O Klipper reportou erro e a impressão não avança. Verifique a máquina antes de retomar.`,
        frameLabel: `CAM ${atual.id}`,
        dedupeKey: `erro:${atual.id}:${atual.job}`,
        capturarFrame: true
      });
    }

    if (anterior.online && !atual.online) {
      void criarAlerta({
        printerId: atual.id,
        printerNome: nomeCurto(atual),
        sev: 'alta',
        codigo: 'impressora_offline',
        titulo: 'Impressora fora do ar',
        detalhe: `O host do Moonraker parou de responder. ${
          anterior.status === 'imprimindo'
            ? `Havia uma impressão em ${anterior.pct}% (${anterior.job}) — ela pode ter continuado sem monitoramento.`
            : 'A máquina estava ociosa.'
        }`,
        frameLabel: `CAM ${atual.id}`,
        dedupeKey: `offline:${atual.id}`
      });
    }

    if (anterior.status === 'imprimindo' && atual.status === 'ociosa' && anterior.pct >= 95) {
      void criarAlerta({
        printerId: atual.id,
        printerNome: nomeCurto(atual),
        sev: 'baixa',
        codigo: 'impressao_concluida',
        titulo: 'Impressão concluída',
        detalhe: `${anterior.job} terminou em ${nomeCurto(atual)}. A mesa segue ocupada até a peça ser retirada.`,
        frameLabel: `CAM ${atual.id}`,
        capturarFrame: true
      });
    }
  });

  farm.on('evento', (printerId: string, metodo: string, params: any) => {
    if (metodo !== 'notify_gcode_response') return;
    const texto: string = Array.isArray(params) ? String(params[0] ?? '') : '';
    // o sensor de filamento do Klipper avisa por gcode response, não por objeto
    if (/filament|runout/i.test(texto)) {
      const p = farm.printer(printerId);
      if (!p) return;
      void criarAlerta({
        printerId,
        printerNome: nomeCurto(p),
        sev: 'media',
        codigo: 'filamento_acabando',
        titulo: 'Filamento acabando',
        detalhe: texto.trim(),
        frameLabel: `CAM ${printerId}`,
        dedupeKey: `filamento:${printerId}`,
        capturarFrame: true
      });
    }
  });

  cameras.on('offline', (printerId: string, motivo: string) => {
    const p = farm.printer(printerId);
    void criarAlerta({
      printerId,
      printerNome: p ? nomeCurto(p) : printerId,
      sev: 'media',
      codigo: 'camera_offline',
        titulo: 'Câmera offline',
      detalhe: `O stream parou de responder (${motivo}). A impressão continua, mas sem imagem. Vale checar a alimentação do hub USB.`,
      frameLabel: `CAM ${printerId}`,
      dedupeKey: `camera:${printerId}`
    });
  });

  cameras.on('online', (printerId: string) => {
    // câmera voltou: fecha o alerta sozinha, ninguém precisa resolver na mão
    getDb()
      .prepare(
        "UPDATE alerts SET resolved_at = datetime('now'), resolved_by = 'sistema' WHERE dedupe_key = ? AND resolved_at IS NULL"
      )
      .run(`camera:${printerId}`);
  });
}
