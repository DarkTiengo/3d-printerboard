import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import type { Archiver } from 'archiver';
import * as tar from 'tar';
import type {
  ArquivoDeConfig,
  BackupCard,
  BackupEstado,
  BackupPadroes,
  BackupPrefs,
  BackupPrefsInput,
  BackupResumo,
  BackupSecao,
  BackupSnapshot,
  PrinterConfig
} from '@3dfarm/shared';
import { BACKUP_SECOES, bytes as fmtBytes } from '@3dfarm/shared';
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
  /** 1 = tar.gz com os arquivos dentro; 2 = zip + sidecar, conteúdo nos blobs */
  versao: 1 | 2;
  printerId: string;
  nome: string;
  moonrakerUrl: string;
  criadoEm: string;
  firmware: string;
  /** o que esta cópia se propôs a levar */
  secoes?: BackupSecao[];
  arquivosConfig: string[];
  namespacesBanco: string[];
  /** caminho dentro do zip → hash no blob store (versão 2) */
  entradas?: Record<string, string>;
  /** nome lógico → hash no blob store */
  gcode: Record<string, string>;
  parcial: boolean;
  avisos: string[];
};

const rodandoAgora = new Set<string>();

// ── preferências por impressora ─────────────────────────────────────────────

/**
 * Cada máquina escolhe o que copiar, de quanto em quanto tempo e quantas
 * cópias guardar.
 *
 * Sem linha na tabela valem os padrões do .env — é o comportamento antigo,
 * então nada muda para quem nunca abriu a tela de configuração. As seções
 * ficam separadas porque o peso delas é muito diferente: config e banco são
 * kilobytes por dia; a biblioteca de G-code de uma máquina pode ser gigabytes.
 */
type PrefsRow = {
  printer_id: string;
  secoes: string;
  excluidos: string;
  intervalo_horas: number | null;
  retencao: number | null;
};

function secoesPadrao(): BackupSecao[] {
  return BACKUP_SECOES.filter((s) => s !== 'gcode' || config.backupIncluiGcode);
}

function lerSecoes(cru: string): BackupSecao[] {
  const escolhidas = cru
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is BackupSecao => (BACKUP_SECOES as string[]).includes(s));
  return BACKUP_SECOES.filter((s) => escolhidas.includes(s));
}

function lerExcluidos(cru: string): string[] {
  try {
    const v = JSON.parse(cru);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function prefsDe(printerId: string): BackupPrefs {
  const row = getDb().prepare('SELECT * FROM backup_prefs WHERE printer_id = ?').get(printerId) as
    | PrefsRow
    | undefined;
  if (!row) {
    return { printerId, secoes: secoesPadrao(), excluidos: [], intervaloHoras: null, retencao: null };
  }
  return {
    printerId,
    secoes: lerSecoes(row.secoes),
    excluidos: lerExcluidos(row.excluidos),
    intervaloHoras: row.intervalo_horas,
    retencao: row.retencao
  };
}

/** Limita a um intervalo sensato; `null` volta a herdar o padrão global. */
function numeroOuHerda(v: number | null | undefined, min: number, max: number): number | null {
  if (v == null) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function salvarPrefs(printerId: string, entrada: BackupPrefsInput): BackupPrefs {
  const atual = prefsDe(printerId);
  const secoes = entrada.secoes ? lerSecoes(entrada.secoes.join(',')) : atual.secoes;
  const excluidos = entrada.excluidos
    ? [...new Set(entrada.excluidos.map((s) => String(s).trim()).filter(Boolean))]
    : atual.excluidos;
  const intervaloHoras =
    'intervaloHoras' in entrada ? numeroOuHerda(entrada.intervaloHoras, 1, 24 * 90) : atual.intervaloHoras;
  const retencao = 'retencao' in entrada ? numeroOuHerda(entrada.retencao, 1, 365) : atual.retencao;

  getDb()
    .prepare(
      `INSERT INTO backup_prefs (printer_id, secoes, excluidos, intervalo_horas, retencao, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(printer_id) DO UPDATE SET
         secoes = excluded.secoes, excluidos = excluded.excluidos,
         intervalo_horas = excluded.intervalo_horas, retencao = excluded.retencao,
         updated_at = excluded.updated_at`
    )
    .run(printerId, secoes.join(','), JSON.stringify(excluidos), intervaloHoras, retencao);

  emitirMudanca();
  return { printerId, secoes, excluidos, intervaloHoras, retencao };
}

export function padroesBackup(): BackupPadroes {
  return { intervaloHoras: intervaloGlobalHoras(), retencao: config.backupRetencao };
}

/** Intervalo global, com o `settings` podendo sobrescrever o .env. */
function intervaloGlobalHoras(): number {
  const salvo = Number(getSetting('backup_intervalo_horas'));
  return Number.isFinite(salvo) && salvo > 0 ? salvo : config.backupIntervaloHoras;
}

/** Intervalo em horas: o da impressora quando existe, senão o global. */
export function intervaloBackupHoras(printerId?: string): number {
  if (printerId) {
    const p = prefsDe(printerId).intervaloHoras;
    if (p != null) return p;
  }
  return intervaloGlobalHoras();
}

/** Quantas cópias guardar desta impressora antes de apagar as mais antigas. */
export function retencaoDe(printerId: string): number {
  const p = prefsDe(printerId).retencao;
  return p != null ? p : config.backupRetencao;
}

/**
 * Os arquivos de config que estão na impressora agora, marcando quais entram
 * no backup. É o que a tela de seleção mostra — por isso vai buscar ao vivo,
 * em vez de listar o que foi copiado da última vez.
 */
export async function listarArquivosDeConfig(printerId: string): Promise<ArquivoDeConfig[]> {
  const cfg = acharPrinter(printerId);
  if (!cfg) throw new Error('impressora não encontrada');
  const http = farm.http(printerId) ?? new MoonrakerHttp(cfg);
  const excluidos = new Set(prefsDe(printerId).excluidos);
  const arquivos = await http.listarArquivos('config');
  return arquivos
    .map((a) => ({ caminho: a.path, bytes: a.size, incluso: !excluidos.has(a.path) }))
    .sort((a, b) => a.caminho.localeCompare(b.caminho));
}

// ── blob store ──────────────────────────────────────────────────────────────

/**
 * O conteúdo copiado vai para um store endereçado por hash.
 *
 * Oito máquinas de uma fazenda imprimem em boa parte os mesmos arquivos, e um
 * backup diário por máquina multiplicaria isso pela retenção. Guardando por
 * hash, o mesmo conteúdo ocupa espaço uma vez só — e o printer.cfg que não
 * mudou em trinta dias é um blob, não trinta. O .zip do snapshot é montado a
 * partir dos blobs, e o manifesto ao lado dele diz quais são.
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
    for (const hash of Object.values(m.entradas ?? {})) vivos.add(hash);
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

/** O manifesto fica ao lado do .zip: ler não custa abrir o arquivo. */
function caminhoManifesto(arquivoZip: string): string {
  return arquivoZip.replace(/\.zip$/, '') + '.json';
}

export async function lerManifesto(arquivo: string): Promise<Manifesto | null> {
  if (arquivo.endsWith('.zip')) {
    const sidecar = caminhoManifesto(arquivo);
    if (!fsSync.existsSync(sidecar)) return null;
    return JSON.parse(await fs.readFile(sidecar, 'utf8')) as Manifesto;
  }
  return lerManifestoLegado(arquivo);
}

/** Snapshots anteriores à mudança para zip: o manifesto está dentro do .tar.gz. */
async function lerManifestoLegado(arquivoTar: string): Promise<Manifesto | null> {
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

// ── empacotamento ───────────────────────────────────────────────────────────

/**
 * Monta o .zip a partir dos blobs. Quem chama pipa a saída e só então chama
 * `finalize()` — o G-code pode ser grande e é lido do disco, não da memória.
 *
 * `comGcode` é falso ao guardar: as peças já estão deduplicadas nos blobs e
 * repeti-las dentro de cada cópia diária encheria o volume. No download é
 * escolha do usuário, porque aí ele quer o backup inteiro na mão.
 */
export function montarZip(manifesto: Manifesto, opcoes: { comGcode: boolean }): Archiver {
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.append(JSON.stringify(manifesto, null, 2), { name: 'manifest.json' });

  for (const [nome, hash] of Object.entries(manifesto.entradas ?? {})) {
    const origem = caminhoBlob(hash);
    if (fsSync.existsSync(origem)) zip.file(origem, { name: nome });
  }

  if (opcoes.comGcode) {
    for (const [nome, hash] of Object.entries(manifesto.gcode)) {
      const origem = caminhoBlob(hash);
      if (fsSync.existsSync(origem)) zip.file(origem, { name: path.posix.join('gcode', nome) });
    }
  }
  return zip;
}

async function escreverZip(manifesto: Manifesto, destino: string): Promise<number> {
  const zip = montarZip(manifesto, { comGcode: false });
  const saida = fsSync.createWriteStream(destino);
  const terminando = pipeline(zip, saida);
  void zip.finalize();
  await terminando;
  return (await fs.stat(destino)).size;
}

// ── execução ────────────────────────────────────────────────────────────────

/**
 * Backup de uma impressora, só pela API HTTP do Moonraker.
 *
 * As seções são as mesmas linhas do card da tela de Backups, e cada máquina
 * escolhe quais quer:
 *  config    → root `config` (printer.cfg, macros), menos o que foi desmarcado
 *  banco     → banco do Moonraker (perfis de fatiamento do Mainsail/Fluidd)
 *  sistema   → /machine/update/status + /machine/system_info (firmware, calib.)
 *  gcode     → root `gcodes`, deduplicado no blob store
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

  const prefs = prefsDe(printerId);
  if (prefs.secoes.length === 0) {
    logger.warn({ printer: printerId }, 'backup pedido sem nenhuma seção selecionada — nada a copiar');
    return null;
  }

  rodandoAgora.add(printerId);
  const db = getDb();
  const runId = Number(
    db.prepare("INSERT INTO backup_runs (printer_id, status) VALUES (?, 'RODANDO')").run(printerId).lastInsertRowid
  );

  const avisos: string[] = [];
  const http = farm.http(printerId) ?? new MoonrakerHttp(cfg);
  const excluidos = new Set(prefs.excluidos);

  const manifesto: Manifesto = {
    versao: 2,
    printerId,
    nome: cfg.nome,
    moonrakerUrl: cfg.moonrakerUrl,
    criadoEm: new Date().toISOString(),
    firmware: '—',
    secoes: prefs.secoes,
    arquivosConfig: [],
    namespacesBanco: [],
    entradas: {},
    gcode: {},
    parcial: false,
    avisos
  };

  let totalBytes = 0;
  let totalArquivos = 0;

  try {
    // 1. config: printer.cfg, macros, moonraker.conf — menos o que foi desmarcado
    if (prefs.secoes.includes('config')) {
      try {
        const arquivos = await http.listarArquivos('config');
        for (const arq of arquivos) {
          if (excluidos.has(arq.path)) continue;
          try {
            const conteudo = await http.baixar('config', arq.path);
            manifesto.entradas![path.posix.join('config', arq.path)] = await guardarBlob(conteudo);
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
    }

    // 2. banco do Moonraker: perfis de fatiamento do Mainsail/Fluidd, mesh, etc.
    if (prefs.secoes.includes('banco')) {
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
        manifesto.entradas!['moonraker-database.json'] = await guardarBlob(json);
        totalBytes += json.length;
        totalArquivos++;
      } catch (err) {
        avisos.push(`banco do Moonraker: ${err instanceof Error ? err.message : err}`);
      }
    }

    // 3. firmware e calibração
    if (prefs.secoes.includes('sistema')) {
      try {
        const [sistema, atualizacao] = await Promise.all([http.infoSistema(), http.statusAtualizacao()]);
        manifesto.firmware = descreverFirmware(atualizacao);
        const json = Buffer.from(JSON.stringify({ sistema, atualizacao }, null, 2), 'utf8');
        manifesto.entradas!['sistema.json'] = await guardarBlob(json);
        totalBytes += json.length;
        totalArquivos++;
      } catch (err) {
        avisos.push(`info de sistema: ${err instanceof Error ? err.message : err}`);
      }
    }

    // 4. G-code, deduplicado
    if (prefs.secoes.includes('gcode')) {
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

    // 5. empacota: o .zip para o usuário baixar, o manifesto ao lado para nós
    const dirDestino = path.join(config.backupsDir, printerId);
    await fs.mkdir(dirDestino, { recursive: true });
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
    const arquivoZip = path.join(dirDestino, `${carimbo}.zip`);
    await fs.writeFile(caminhoManifesto(arquivoZip), JSON.stringify(manifesto, null, 2));
    const bytesZip = await escreverZip(manifesto, arquivoZip);

    const pediuConteudo = prefs.secoes.includes('config') || prefs.secoes.includes('banco');
    const nadaVeio =
      pediuConteudo && manifesto.arquivosConfig.length === 0 && manifesto.namespacesBanco.length === 0;
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
      arquivoZip,
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
        codigo: 'backup_falhou',
        titulo: 'Backup falhou',
        detalhe: `Nenhum arquivo de configuração veio de ${cfg.nome}. ${avisos[0] ?? ''}`.trim(),
        frameLabel: 'CAPTURA DO LOG DE BACKUP',
        dedupeKey: `backup:${printerId}`
      });
    }

    await aplicarRetencao(printerId);
    logger.info({ printer: printerId, status, bytes: totalBytes, zip: bytesZip }, 'backup concluído');
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
      codigo: 'backup_falhou',
      titulo: 'Backup falhou',
      detalhe: msg,
      frameLabel: 'CAPTURA DO LOG DE BACKUP',
      dedupeKey: `backup:${printerId}`
    });
    logger.error({ printer: printerId }, `backup falhou: ${msg}`);
    emitirMudanca();
    return null;
  } finally {
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

/** Marca o fim de um ciclo — o número "último ciclo" da tela de Backups. */
export function registrarCiclo(): void {
  setSetting('ultimo_ciclo', new Date().toISOString());
  emitirMudanca();
}

/**
 * Mantém as N cópias mais recentes desta impressora e apaga o resto — o zip,
 * o manifesto ao lado e a linha do banco. Os blobs que ficarem sem dono somem
 * na coleta de lixo que roda no fim do ciclo.
 */
async function aplicarRetencao(printerId: string): Promise<void> {
  const antigos = getDb()
    .prepare(
      `SELECT id, archive_path FROM backup_runs
        WHERE printer_id = ? AND archive_path IS NOT NULL AND status != 'RODANDO'
        ORDER BY started_at DESC LIMIT -1 OFFSET ?`
    )
    .all(printerId, retencaoDe(printerId)) as { id: number; archive_path: string }[];

  for (const a of antigos) {
    await fs.rm(a.archive_path, { force: true });
    if (a.archive_path.endsWith('.zip')) await fs.rm(caminhoManifesto(a.archive_path), { force: true });
    getDb().prepare('DELETE FROM backup_runs WHERE id = ?').run(a.id);
  }
  if (antigos.length > 0) {
    logger.info({ printer: printerId, removidas: antigos.length, guardadas: retencaoDe(printerId) }, 'retenção aplicada');
  }
}

/** Reaplica a retenção de todas as impressoras — usado quando o número muda. */
export async function aplicarRetencaoDeTodas(): Promise<void> {
  for (const p of listarPrinters()) await aplicarRetencao(p.id);
}

// ── download ────────────────────────────────────────────────────────────────

export type Download =
  | { tipo: 'zip'; nome: string; zip: Archiver }
  | { tipo: 'arquivo'; nome: string; caminho: string };

/**
 * O .zip de uma cópia, para o usuário levar embora.
 *
 * O que está guardado no disco não tem o G-code dentro (os blobs deduplicam a
 * biblioteca entre máquinas e entre dias), então quando o usuário pede tudo o
 * zip é remontado na hora a partir dos blobs — não há cópia intermediária no
 * volume, ele sai direto pela resposta.
 */
export async function prepararDownload(snapshotId: number, comGcode: boolean): Promise<Download> {
  const run = getDb().prepare('SELECT * FROM backup_runs WHERE id = ?').get(snapshotId) as RunRow | undefined;
  if (!run?.archive_path) throw new Error('snapshot não encontrado');
  if (!fsSync.existsSync(run.archive_path)) throw new Error('o arquivo desse backup não está mais no disco');

  const carimbo = path.basename(run.archive_path).replace(/\.(zip|tar\.gz)$/, '');
  const base = `backup-${run.printer_id}-${carimbo}`;

  // snapshot antigo: o .tar.gz já tem tudo dentro, vai como está
  if (!run.archive_path.endsWith('.zip')) {
    return { tipo: 'arquivo', nome: `${base}.tar.gz`, caminho: run.archive_path };
  }

  const manifesto = await lerManifesto(run.archive_path);
  if (!comGcode || !manifesto || Object.keys(manifesto.gcode).length === 0) {
    return { tipo: 'arquivo', nome: `${base}.zip`, caminho: run.archive_path };
  }
  return { tipo: 'zip', nome: `${base}-com-gcode.zip`, zip: montarZip(manifesto, { comGcode: true }) };
}

// ── restauração ─────────────────────────────────────────────────────────────

/**
 * Restaura um snapshot numa impressora — possivelmente outra, que é o caso de
 * "clonar a configuração da máquina que funciona". Sobrescreve config na
 * máquina de destino: a rota exige papel admin e confirmação explícita.
 */
/** O caminho resolvido continua dentro da raiz? Barra `..` e absolutos. */
function caminhoSeguro(raiz: string, relativo: string): boolean {
  if (!relativo || path.isAbsolute(relativo)) return false;
  const destino = path.resolve(raiz, relativo);
  return destino === raiz || destino.startsWith(raiz + path.sep);
}

/** Exportado só para teste. */
export const _caminhoSeguro = caminhoSeguro;

export async function restaurar(snapshotId: number, destinoPrinterId: string): Promise<{ arquivos: number }> {
  const run = getDb().prepare('SELECT * FROM backup_runs WHERE id = ?').get(snapshotId) as RunRow | undefined;
  if (!run?.archive_path) throw new Error('snapshot não encontrado');

  const destino = acharPrinter(destinoPrinterId);
  if (!destino) throw new Error('impressora de destino não encontrada');

  const http = farm.http(destinoPrinterId) ?? new MoonrakerHttp(destino);
  const manifesto = await lerManifesto(run.archive_path);
  if (!manifesto) throw new Error('manifesto do snapshot não encontrado');

  const enviados = manifesto.entradas
    ? await restaurarDosBlobs(manifesto, http, snapshotId)
    : await restaurarDoTar(run.archive_path, manifesto, http, snapshotId);

  logger.warn({ de: manifesto.printerId, para: destinoPrinterId, arquivos: enviados }, 'configuração restaurada');
  return { arquivos: enviados };
}

async function restaurarDosBlobs(
  manifesto: Manifesto,
  http: MoonrakerHttp,
  snapshotId: number
): Promise<number> {
  const raiz = path.resolve('/config');
  const ignorados: string[] = [];
  let enviados = 0;

  for (const relativo of manifesto.arquivosConfig) {
    // O manifesto é lido de um arquivo dentro de um volume gravável, então não
    // é entrada confiável: um caminho com ../ mandaria para a impressora algo
    // de fora do snapshot.
    if (!caminhoSeguro(raiz, relativo)) {
      ignorados.push(relativo);
      continue;
    }
    const hash = manifesto.entradas?.[path.posix.join('config', relativo)];
    const conteudo = hash ? lerBlob(hash) : null;
    if (!conteudo) {
      ignorados.push(relativo);
      continue;
    }
    await http.enviar('config', relativo, conteudo);
    enviados++;
  }

  if (ignorados.length > 0) {
    logger.warn({ snapshotId, ignorados }, 'restauração pulou arquivos suspeitos ou sem conteúdo guardado');
  }
  return enviados;
}

/** Snapshots anteriores à mudança para zip continuam restauráveis. */
async function restaurarDoTar(
  arquivoTar: string,
  manifesto: Manifesto,
  http: MoonrakerHttp,
  snapshotId: number
): Promise<number> {
  const tmp = path.join(config.dataDir, `.tmp-restore-${snapshotId}-${Date.now()}`);
  await fs.mkdir(tmp, { recursive: true });
  try {
    await tar.extract({ file: arquivoTar, cwd: tmp });
    const raizConfig = path.resolve(tmp, 'config');
    const ignorados: string[] = [];
    let enviados = 0;

    for (const relativo of manifesto.arquivosConfig) {
      if (!caminhoSeguro(raizConfig, relativo)) {
        ignorados.push(relativo);
        continue;
      }
      const conteudo = await fs.readFile(path.join(raizConfig, relativo));
      await http.enviar('config', relativo, conteudo);
      enviados++;
    }
    if (ignorados.length > 0) {
      logger.warn({ snapshotId, ignorados }, 'restauração ignorou caminhos suspeitos no manifesto');
    }
    return enviados;
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

function ultimoRun(printerId: string): RunRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM backup_runs WHERE printer_id = ? AND status != 'RODANDO' ORDER BY started_at DESC LIMIT 1")
      .get(printerId) as RunRow | undefined) ?? null
  );
}

function contarGcode(resumo: string | null): number {
  return Number(/(\d+)/.exec(resumo ?? '')?.[1] ?? 0);
}

function snapshotDeRun(id: number): BackupSnapshot | null {
  const r = getDb().prepare('SELECT * FROM backup_runs WHERE id = ?').get(id) as RunRow | undefined;
  if (!r) return null;
  return {
    id: r.id,
    printerId: r.printer_id,
    criadoEm: r.started_at + 'Z',
    estado: r.status === 'RODANDO' ? 'PARCIAL' : r.status,
    bytes: r.bytes,
    arquivos: r.file_count,
    gcodeArquivos: contarGcode(r.gcode_resumo),
    formato: r.archive_path?.endsWith('.zip') === false ? 'tar.gz' : 'zip'
  };
}

export function listarSnapshots(printerId?: string): BackupSnapshot[] {
  const sql = printerId
    ? "SELECT * FROM backup_runs WHERE printer_id = ? AND status != 'RODANDO' ORDER BY started_at DESC"
    : "SELECT * FROM backup_runs WHERE status != 'RODANDO' ORDER BY started_at DESC LIMIT 200";
  const rows = (printerId ? getDb().prepare(sql).all(printerId) : getDb().prepare(sql).all()) as RunRow[];
  return rows.map((r) => snapshotDeRun(r.id)!).filter(Boolean);
}

/**
 * Quem está na fila esperando ficar ociosa. Injetado pela agenda de backup —
 * é ela que guarda a fila, e importá-la aqui daria import circular.
 */
let ehPendente: (printerId: string) => boolean = () => false;
export function definirVerificadorDePendencia(fn: (printerId: string) => boolean): void {
  ehPendente = fn;
}

export function cardsDeBackup(): BackupCard[] {
  const db = getDb();
  return listarPrinters().map((cfg: PrinterConfig) => {
    const run = ultimoRun(cfg.id);
    const pendente = ehPendente(cfg.id);
    const prefs = prefsDe(cfg.id);
    const copias = (
      db
        .prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE printer_id = ? AND status != 'RODANDO'")
        .get(cfg.id) as { n: number }
    ).n;

    if (!run) {
      return {
        printerId: cfg.id,
        nome: cfg.nome,
        estado: 'NUNCA' as BackupEstado,
        ultimoEm: null,
        firmware: '—',
        gcodeArquivos: 0,
        bytes: 0,
        pendente,
        prefs,
        copias
      };
    }
    return {
      printerId: cfg.id,
      nome: cfg.nome,
      estado: run.status as BackupEstado,
      ultimoEm: run.started_at + 'Z',
      firmware: run.firmware ?? '—',
      gcodeArquivos: contarGcode(run.gcode_resumo),
      bytes: run.bytes,
      pendente,
      prefs,
      copias
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
    cron: config.backupCron,
    ultimoCicloEm: ultimo,
    bytes: total.b,
    falhas: falhas.n,
    padroes: padroesBackup()
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
