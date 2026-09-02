import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { createHash } from 'node:crypto';
import * as tar from 'tar';
import type { BackupCard, BackupEstado, BackupResumo, BackupSnapshot, PrinterConfig } from '@3dfarm/shared';
import { bytes as fmtBytes, quandoCurto, quando } from '@3dfarm/shared';
import { getDb, getSetting, setSetting } from '../db/index.js';
import { config } from '../config.js';
import { farm } from './farm.js';
import { listarPrinters, acharPrinter } from './printers.repo.js';
import { MoonrakerHttp } from '../moonraker/http.js';
import { criarAlerta } from './alerts.js';
import { logger } from '../lib/logger.js';

type RunRow = {
  id: number;
  printer_id: string;
  status: BackupEstado | 'RODANDO';
  bytes: number;
  file_count: number;
  archive_path: string | null;
  firmware: string | null;
  gcode_resumo: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type Manifesto = {
  versao: 1;
  printerId: string;
  nome: string;
  moonrakerUrl: string;
  criadoEm: string;
  firmware: string;
  arquivosConfig: string[];
  namespacesBanco: string[];
  /** nome lógico → hash no blob store */
  gcode: Record<string, string>;
  parcial: boolean;
  avisos: string[];
};

const rodandoAgora = new Set<string>();

// ── blob store ──────────────────────────────────────────────────────────────

/**
 * G-code vai para um store endereçado por conteúdo.
 *
 * Oito máquinas de uma fazenda imprimem em boa parte os mesmos arquivos, e um
 * backup diário por máquina multiplicaria isso por 7 na retenção. Guardando por
 * hash, o mesmo G-code ocupa espaço uma vez só, para sempre — o .tar.gz do
 * snapshot carrega só o manifesto apontando para os blobs.
 */
function caminhoBlob(hash: string): string {
  return path.join(config.blobsDir, hash.slice(0, 2), hash);
}

async function guardarBlob(conteudo: Buffer): Promise<string> {
  const hash = createHash('sha256').update(conteudo).digest('hex');
  const destino = caminhoBlob(hash);
  if (!fsSync.existsSync(destino)) {
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, conteudo);
  }
  return hash;
}

export function lerBlob(hash: string): Buffer | null {
  const caminho = caminhoBlob(hash);
  return fsSync.existsSync(caminho) ? fsSync.readFileSync(caminho) : null;
}

/** Remove blobs que nenhum manifesto guardado referencia mais. */
export async function coletarLixo(): Promise<number> {
  const vivos = new Set<string>();
  for (const m of await todosManifestos()) {
    for (const hash of Object.values(m.gcode)) vivos.add(hash);
  }

  let removidos = 0;
  const prefixos = await fs.readdir(config.blobsDir).catch(() => [] as string[]);
  for (const prefixo of prefixos) {
    const dir = path.join(config.blobsDir, prefixo);
    if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) continue;
    for (const nome of await fs.readdir(dir)) {
      if (vivos.has(nome)) continue;
      await fs.rm(path.join(dir, nome), { force: true });
      removidos++;
    }
  }
  if (removidos > 0) logger.info(`coleta de lixo: ${removidos} blobs removidos`);
  return removidos;
}

async function todosManifestos(): Promise<Manifesto[]> {
  const rows = getDb()
    .prepare("SELECT archive_path FROM backup_runs WHERE archive_path IS NOT NULL AND status != 'RODANDO'")
    .all() as { archive_path: string }[];
  const out: Manifesto[] = [];
  for (const r of rows) {
    const m = await lerManifesto(r.archive_path).catch(() => null);
    if (m) out.push(m);
  }
  return out;
}

async function lerManifesto(arquivoTar: string): Promise<Manifesto | null> {
  if (!fsSync.existsSync(arquivoTar)) return null;
  let json: string | null = null;
  await tar.list({
    file: arquivoTar,
    filter: (p) => p === 'manifest.json' || p === './manifest.json',
    onentry: (entry) => {
      const pedacos: Buffer[] = [];
      entry.on('data', (c: Buffer) => pedacos.push(c));
      entry.on('end', () => {
        json = Buffer.concat(pedacos).toString('utf8');
      });
    }
  });
  return json ? (JSON.parse(json) as Manifesto) : null;
}

// ── execução ────────────────────────────────────────────────────────────────

/**
 * Backup de uma impressora, só pela API HTTP do Moonraker.
 *
 * Cobre exatamente as três linhas do card da tela de Backups:
 *  perfis            → root `config` (printer.cfg, macros) + banco do Moonraker
 *  firmware/calib.   → /machine/update/status + /machine/system_info
 *  G-code            → root `gcodes`, deduplicado no blob store
 *
 * Falha parcial é o caso normal (uma máquina com o Klipper caído ainda entrega
 * os arquivos de config), então o status PARCIAL existe de propósito.
 */
export async function rodarBackup(printerId: string): Promise<BackupSnapshot | null> {
  if (rodandoAgora.has(printerId)) {
    logger.warn(`backup de ${printerId} já está rodando`);
    return null;
  }
  const cfg = acharPrinter(printerId);
  if (!cfg) return null;

  rodandoAgora.add(printerId);
  const db = getDb();
  const runId = Number(
    db.prepare("INSERT INTO backup_runs (printer_id, status) VALUES (?, 'RODANDO')").run(printerId).lastInsertRowid
  );

  const avisos: string[] = [];
  const http = farm.http(printerId) ?? new MoonrakerHttp(cfg);
  const tmp = path.join(config.dataDir, `.tmp-backup-${printerId}-${runId}`);
  await fs.mkdir(path.join(tmp, 'config'), { recursive: true });

  const manifesto: Manifesto = {
    versao: 1,
    printerId,
    nome: cfg.nome,
    moonrakerUrl: cfg.moonrakerUrl,
    criadoEm: new Date().toISOString(),
    firmware: '—',
    arquivosConfig: [],
    namespacesBanco: [],
    gcode: {},
    parcial: false,
    avisos
  };

  let totalBytes = 0;
  let totalArquivos = 0;

  try {
    // 1. config: printer.cfg, macros, moonraker.conf
    try {
      const arquivos = await http.listarArquivos('config');
      for (const arq of arquivos) {
        try {
          const conteudo = await http.baixar('config', arq.path);
          const destino = path.join(tmp, 'config', arq.path);
          await fs.mkdir(path.dirname(destino), { recursive: true });
          await fs.writeFile(destino, conteudo);
          manifesto.arquivosConfig.push(arq.path);
          totalBytes += conteudo.length;
          totalArquivos++;
        } catch (err) {
          avisos.push(`config/${arq.path}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      avisos.push(`listagem de config falhou: ${err instanceof Error ? err.message : err}`);
    }

    // 2. banco do Moonraker: perfis de fatiamento do Mainsail/Fluidd, mesh, etc.
    try {
      const { namespaces } = await http.listarNamespaces();
      const dump: Record<string, unknown> = {};
      for (const ns of namespaces) {
        try {
          const item = await http.itemBanco(ns);
          dump[ns] = item.value;
          manifesto.namespacesBanco.push(ns);
        } catch (err) {
          avisos.push(`banco/${ns}: ${err instanceof Error ? err.message : err}`);
        }
      }
      const json = Buffer.from(JSON.stringify(dump, null, 2), 'utf8');
      await fs.writeFile(path.join(tmp, 'moonraker-database.json'), json);
      totalBytes += json.length;
      totalArquivos++;
    } catch (err) {
      avisos.push(`banco do Moonraker: ${err instanceof Error ? err.message : err}`);
    }

    // 3. firmware e calibração
    try {
      const [sistema, atualizacao] = await Promise.all([http.infoSistema(), http.statusAtualizacao()]);
      manifesto.firmware = descreverFirmware(atualizacao);
      const json = Buffer.from(JSON.stringify({ sistema, atualizacao }, null, 2), 'utf8');
      await fs.writeFile(path.join(tmp, 'sistema.json'), json);
      totalBytes += json.length;
      totalArquivos++;
    } catch (err) {
      avisos.push(`info de sistema: ${err instanceof Error ? err.message : err}`);
    }

    // 4. G-code, deduplicado
    if (config.backupIncluiGcode) {
      try {
        const arquivos = await http.listarArquivos('gcodes');
        let baixados = 0;
        for (const arq of arquivos) {
          if (baixados + arq.size > config.backupGcodeMaxBytes) {
            avisos.push(`teto de ${fmtBytes(config.backupGcodeMaxBytes)} de G-code atingido; ${arq.path} e seguintes ficaram de fora`);
            break;
          }
          try {
            const conteudo = await http.baixar('gcodes', arq.path);
            manifesto.gcode[arq.path] = await guardarBlob(conteudo);
            baixados += conteudo.length;
            totalBytes += conteudo.length;
            totalArquivos++;
          } catch (err) {
            avisos.push(`gcodes/${arq.path}: ${err instanceof Error ? err.message : err}`);
          }
        }
      } catch (err) {
        avisos.push(`listagem de G-code falhou: ${err instanceof Error ? err.message : err}`);
      }
    }

    manifesto.parcial = avisos.length > 0;
    await fs.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(manifesto, null, 2));

    // 5. empacota
    const dirDestino = path.join(config.backupsDir, printerId);
    await fs.mkdir(dirDestino, { recursive: true });
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
    const arquivoTar = path.join(dirDestino, `${carimbo}.tar.gz`);
    await tar.create({ gzip: true, file: arquivoTar, cwd: tmp }, ['.']);

    const nadaVeio = manifesto.arquivosConfig.length === 0 && manifesto.namespacesBanco.length === 0;
    const status: BackupEstado = nadaVeio ? 'FALHOU' : manifesto.parcial ? 'PARCIAL' : 'OK';

    db.prepare(
      `UPDATE backup_runs
          SET status = ?, bytes = ?, file_count = ?, archive_path = ?, firmware = ?, gcode_resumo = ?,
              error = ?, finished_at = datetime('now')
        WHERE id = ?`
    ).run(
      status,
      totalBytes,
      totalArquivos,
      arquivoTar,
      manifesto.firmware,
      `${Object.keys(manifesto.gcode).length} arq.`,
      avisos.length ? avisos.slice(0, 10).join('\n') : null,
      runId
    );

    if (status === 'FALHOU') {
      await criarAlerta({
        printerId,
        printerNome: cfg.nome,
        sev: 'alta',
        titulo: 'Backup falhou',
        detalhe: `Nenhum arquivo de configuração veio de ${cfg.nome}. ${avisos[0] ?? ''}`.trim(),
        frameLabel: 'CAPTURA DO LOG DE BACKUP',
        dedupeKey: `backup:${printerId}`
      });
    }

    await aplicarRetencao(printerId);
    logger.info({ printer: printerId, status, bytes: totalBytes }, 'backup concluído');
    emitirMudanca();
    return snapshotDeRun(runId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE backup_runs SET status = 'FALHOU', error = ?, finished_at = datetime('now') WHERE id = ?").run(
      msg,
      runId
    );
    await criarAlerta({
      printerId,
      printerNome: cfg.nome,
      sev: 'alta',
      titulo: 'Backup falhou',
      detalhe: msg,
      frameLabel: 'CAPTURA DO LOG DE BACKUP',
      dedupeKey: `backup:${printerId}`
    });
    logger.error({ printer: printerId }, `backup falhou: ${msg}`);
    emitirMudanca();
    return null;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
    rodandoAgora.delete(printerId);
  }
}

function descreverFirmware(status: Record<string, any>): string {
  const versoes = status?.version_info ?? {};
  const klipper = versoes.klipper?.version;
  if (klipper) return `Klipper ${klipper}`;
  const mcu = Object.entries(versoes).find(([k]) => k.startsWith('mcu'));
  if (mcu) return `${mcu[0]} ${(mcu[1] as any)?.version ?? ''}`.trim();
  return '—';
}

/** Backup de todas as impressoras com backup ligado, uma de cada vez. */
export async function rodarBackupDeTodas(): Promise<void> {
  const alvos = listarPrinters().filter((p) => p.backupEnabled);
  logger.info(`ciclo de backup: ${alvos.length} impressoras`);
  // sequencial de propósito: paralelo satura a rede da fazenda e o disco do host
  for (const p of alvos) {
    await rodarBackup(p.id);
  }
  setSetting('ultimo_ciclo', new Date().toISOString());
  await coletarLixo();
  emitirMudanca();
}

/** Mantém os N mais recentes por impressora. */
async function aplicarRetencao(printerId: string): Promise<void> {
  const antigos = getDb()
    .prepare(
      `SELECT id, archive_path FROM backup_runs
        WHERE printer_id = ? AND archive_path IS NOT NULL AND status != 'RODANDO'
        ORDER BY started_at DESC LIMIT -1 OFFSET ?`
    )
    .all(printerId, config.backupRetencao) as { id: number; archive_path: string }[];

  for (const a of antigos) {
    await fs.rm(a.archive_path, { force: true });
    getDb().prepare('DELETE FROM backup_runs WHERE id = ?').run(a.id);
  }
}

// ── restauração ─────────────────────────────────────────────────────────────

/**
 * Restaura um snapshot numa impressora — possivelmente outra, que é o caso de
 * "clonar a configuração da máquina que funciona". Sobrescreve config na
 * máquina de destino: a rota exige papel admin e confirmação explícita.
 */
export async function restaurar(snapshotId: number, destinoPrinterId: string): Promise<{ arquivos: number }> {
  const run = getDb().prepare('SELECT * FROM backup_runs WHERE id = ?').get(snapshotId) as RunRow | undefined;
  if (!run?.archive_path) throw new Error('snapshot não encontrado');

  const destino = acharPrinter(destinoPrinterId);
  if (!destino) throw new Error('impressora de destino não encontrada');

  const http = farm.http(destinoPrinterId) ?? new MoonrakerHttp(destino);
  const tmp = path.join(config.dataDir, `.tmp-restore-${snapshotId}-${Date.now()}`);
  await fs.mkdir(tmp, { recursive: true });

  try {
    await tar.extract({ file: run.archive_path, cwd: tmp });
    const manifesto = JSON.parse(await fs.readFile(path.join(tmp, 'manifest.json'), 'utf8')) as Manifesto;

    let enviados = 0;
    for (const relativo of manifesto.arquivosConfig) {
      const conteudo = await fs.readFile(path.join(tmp, 'config', relativo));
      await http.enviar('config', relativo, conteudo);
      enviados++;
    }

    logger.warn(
      { de: manifesto.printerId, para: destinoPrinterId, arquivos: enviados },
      'configuração restaurada'
    );
    return { arquivos: enviados };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ── leitura para a tela ─────────────────────────────────────────────────────

/**
 * Quando este printer teve o último backup aproveitável.
 *
 * PARCIAL conta: um ciclo que trouxe o printer.cfg e perdeu dois G-code ainda
 * é um backup. Só FALHOU — que é "não veio nada" — não conta, senão uma máquina
 * quebrada pareceria protegida.
 */
export function ultimoBackupUtilEm(printerId: string): string | null {
  const r = getDb()
    .prepare(
      `SELECT started_at FROM backup_runs
        WHERE printer_id = ? AND status IN ('OK','PARCIAL')
        ORDER BY started_at DESC LIMIT 1`
    )
    .get(printerId) as { started_at: string } | undefined;
  return r ? r.started_at + 'Z' : null;
}

/**
 * O backup está vencido? `null` em `ultimoEm` significa nunca — e nunca sempre
 * vence. Função pura para dar para testar sem banco nem relógio.
 */
export function backupVencido(ultimoEm: string | null, intervaloHoras: number, agora = Date.now()): boolean {
  if (!ultimoEm) return true;
  const quando = new Date(ultimoEm).getTime();
  if (!Number.isFinite(quando)) return true;
  return agora - quando >= intervaloHoras * 3_600_000;
}

/** Intervalo em horas, com o `settings` podendo sobrescrever o .env. */
export function intervaloBackupHoras(): number {
  const salvo = Number(getSetting('backup_intervalo_horas'));
  return Number.isFinite(salvo) && salvo > 0 ? salvo : config.backupIntervaloHoras;
}

function ultimoRun(printerId: string): RunRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM backup_runs WHERE printer_id = ? AND status != 'RODANDO' ORDER BY started_at DESC LIMIT 1")
      .get(printerId) as RunRow | undefined) ?? null
  );
}

function snapshotDeRun(id: number): BackupSnapshot | null {
  const r = getDb().prepare('SELECT * FROM backup_runs WHERE id = ?').get(id) as RunRow | undefined;
  if (!r) return null;
  return {
    id: r.id,
    printerId: r.printer_id,
    quando: quando(r.started_at + 'Z'),
    criadoEm: r.started_at + 'Z',
    estado: r.status === 'RODANDO' ? 'PARCIAL' : r.status,
    tamanho: fmtBytes(r.bytes),
    arquivos: r.file_count
  };
}

export function listarSnapshots(printerId?: string): BackupSnapshot[] {
  const sql = printerId
    ? "SELECT * FROM backup_runs WHERE printer_id = ? AND status != 'RODANDO' ORDER BY started_at DESC"
    : "SELECT * FROM backup_runs WHERE status != 'RODANDO' ORDER BY started_at DESC LIMIT 200";
  const rows = (printerId ? getDb().prepare(sql).all(printerId) : getDb().prepare(sql).all()) as RunRow[];
  return rows.map((r) => snapshotDeRun(r.id)!).filter(Boolean);
}

export function cardsDeBackup(): BackupCard[] {
  return listarPrinters().map((cfg: PrinterConfig) => {
    const run = ultimoRun(cfg.id);
    if (!run) {
      return {
        printerId: cfg.id,
        nome: cfg.nome,
        estado: 'NUNCA' as BackupEstado,
        perfis: 'nunca',
        firmware: '—',
        gcode: '—'
      };
    }
    return {
      printerId: cfg.id,
      nome: cfg.nome,
      estado: run.status as BackupEstado,
      perfis: quandoCurto(run.started_at + 'Z'),
      firmware: run.firmware ?? '—',
      gcode: `${run.gcode_resumo ?? '0 arq.'} · ${fmtBytes(run.bytes)}`
    };
  });
}

export function resumoDeBackup(): BackupResumo {
  const db = getDb();
  const total = db.prepare("SELECT COALESCE(SUM(bytes), 0) AS b FROM backup_runs WHERE status != 'RODANDO'").get() as {
    b: number;
  };
  const falhas = db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE status = 'FALHOU'").get() as { n: number };
  const ultimo = getSetting('ultimo_ciclo');

  return {
    // a rotina agendada mais a rede de segurança: uma máquina que estava
    // desligada às 03:00 é recuperada assim que voltar
    rotina: `${descreverCron(config.backupCron)} · e ao religar`,
    ultimoCiclo: ultimo ? quandoCurto(ultimo) : 'nunca',
    armazenado: fmtBytes(total.b),
    falhas: falhas.n
  };
}

/** '0 3 * * *' → 'diário 03:00'. Cai para o cru quando o padrão não bate. */
export function descreverCron(cron: string): string {
  const m = /^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/.exec(cron.trim());
  if (!m) return cron;
  return `diário ${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
}

let emissor: (() => void) | null = null;
export function aoMudarBackup(fn: () => void): void {
  emissor = fn;
}
function emitirMudanca(): void {
  emissor?.();
}
