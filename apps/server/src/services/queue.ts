import type { Printer, QueueJob, QueueStatus } from '@3dfarm/shared';
import { getDb } from '../db/index.js';
import { farm } from './farm.js';
import { acharPrinter, listarPrinters } from './printers.repo.js';
import { listarArquivos, invalidarCache } from './files.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

type Row = {
  id: number;
  filename: string;
  target_printer_id: string | null;
  status: QueueStatus;
  printer_id: string | null;
  tempo: string | null;
  erro: string | null;
  created_at: string;
};

function paraJob(r: Row): QueueJob {
  return {
    id: r.id,
    arquivo: r.filename,
    destino: r.target_printer_id,
    tempo: r.tempo ?? '—',
    status: r.status,
    printerId: r.printer_id,
    criadoEm: r.created_at + 'Z',
    erro: r.erro
  };
}

const ABERTOS: QueueStatus[] = ['pendente', 'atribuido', 'imprimindo'];

export function listarFila(incluirFechados = false): QueueJob[] {
  const sql = incluirFechados
    ? 'SELECT * FROM queue_jobs ORDER BY created_at DESC LIMIT 100'
    : `SELECT * FROM queue_jobs WHERE status IN (${ABERTOS.map(() => '?').join(',')}) ORDER BY created_at`;
  const rows = (incluirFechados ? getDb().prepare(sql).all() : getDb().prepare(sql).all(...ABERTOS)) as Row[];
  return rows.map(paraJob);
}

export function contarFila(): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM queue_jobs WHERE status IN (${ABERTOS.map(() => '?').join(',')})`)
    .get(...ABERTOS) as { n: number };
  return r.n;
}

export async function enfileirar(arquivo: string, destino: string | null): Promise<QueueJob> {
  if (destino && !acharPrinter(destino)) throw new Error('impressora de destino não existe');

  // o tempo estimado vem do metadado do G-code; é só rótulo na lista da fila
  let tempo: string | null = null;
  try {
    const origem = destino ?? farm.printers()[0]?.id;
    if (origem) {
      const arquivos = await listarArquivos(origem);
      tempo = arquivos.find((a) => a.path.endsWith(arquivo))?.tempo ?? null;
    }
  } catch {
    /* estimativa é opcional */
  }

  const info = getDb()
    .prepare('INSERT INTO queue_jobs (filename, target_printer_id, tempo) VALUES (?, ?, ?)')
    .run(arquivo, destino, tempo);
  const job = acharJob(Number(info.lastInsertRowid))!;
  logger.info({ job: job.id, arquivo, destino }, 'trabalho enfileirado');
  emitirMudanca();
  // só tem efeito com a fila automática; no padrão o trabalho espera autorização
  void processarFila();
  return job;
}

export function acharJob(id: number): QueueJob | null {
  const r = getDb().prepare('SELECT * FROM queue_jobs WHERE id = ?').get(id) as Row | undefined;
  return r ? paraJob(r) : null;
}

export function cancelarJob(id: number): QueueJob | null {
  getDb()
    .prepare(
      `UPDATE queue_jobs SET status = 'cancelado', finished_at = datetime('now')
        WHERE id = ? AND status IN ('pendente','atribuido')`
    )
    .run(id);
  emitirMudanca();
  return acharJob(id);
}

// ── motor ───────────────────────────────────────────────────────────────────

/**
 * Escolhe a impressora para um trabalho.
 *
 * `target_printer_id` fixo → só aquela, e só se estiver ociosa e online.
 * Nulo ("próxima livre") → a primeira ociosa na ordem da fazenda, o que torna a
 * ordem da tela de gestão a política de prioridade.
 */
export function escolherImpressora(job: QueueJob, printers: Printer[], ocupadas: Set<string>): Printer | null {
  const livre = (p: Printer) => p.online && p.status === 'ociosa' && !ocupadas.has(p.id);

  if (job.destino) {
    const alvo = printers.find((p) => p.id === job.destino);
    return alvo && livre(alvo) ? alvo : null;
  }
  const ordem = listarPrinters().map((c) => c.id);
  for (const id of ordem) {
    const p = printers.find((x) => x.id === id);
    if (p && livre(p)) return p;
  }
  return null;
}

/** Copia o arquivo para a impressora se ela ainda não tiver. */
async function garantirArquivo(printerId: string, arquivo: string): Promise<void> {
  const http = farm.http(printerId);
  if (!http) throw new Error('impressora sem conexão HTTP');

  const lista = await http.listarArquivos('gcodes');
  const nome = arquivo.split('/').pop()!;
  if (lista.some((a) => a.path === arquivo || a.path.split('/').pop() === nome)) return;

  // não está lá: busca em outra máquina da fazenda que tenha o mesmo arquivo
  for (const outra of farm.printers()) {
    if (outra.id === printerId) continue;
    const outroHttp = farm.http(outra.id);
    if (!outroHttp) continue;
    try {
      const deLa = await outroHttp.listarArquivos('gcodes');
      const achado = deLa.find((a) => a.path === arquivo || a.path.split('/').pop() === nome);
      if (!achado) continue;
      const conteudo = await outroHttp.baixar('gcodes', achado.path);
      await http.enviar('gcodes', nome, conteudo);
      logger.info({ de: outra.id, para: printerId, arquivo: nome }, 'arquivo copiado entre impressoras');
      invalidarCache(printerId);
      return;
    } catch {
      /* tenta a próxima */
    }
  }
  throw new Error(`arquivo ${nome} não encontrado em nenhuma impressora da fazenda`);
}

let rodando = false;

/** Impressoras já comprometidas com um trabalho neste momento. */
function ocupadasAgora(): Set<string> {
  return new Set(
    listarFila()
      .filter((j) => j.status === 'atribuido' || j.status === 'imprimindo')
      .map((j) => j.printerId)
      .filter((id): id is string => !!id)
  );
}

/**
 * O que esta impressora pode imprimir agora, em ordem.
 *
 * Primeiro os trabalhos endereçados a ela; depois os sem destino, que podem
 * rodar em qualquer máquina. É o que o painel mostra ao selecionar a impressora.
 */
export function filaDaImpressora(printerId: string): QueueJob[] {
  const abertos = listarFila().filter((j) => j.status === 'pendente');
  return [...abertos.filter((j) => j.destino === printerId), ...abertos.filter((j) => j.destino === null)];
}

/**
 * Manda um trabalho específico para uma impressora específica. É o caminho
 * autorizado: quem chama já decidiu que pode começar.
 */
export async function despacharJob(jobId: number, printerId: string): Promise<QueueJob> {
  const job = acharJob(jobId);
  if (!job) throw new Error('trabalho não encontrado');
  if (job.status !== 'pendente') throw new Error('este trabalho já saiu da fila');
  if (job.destino && job.destino !== printerId) {
    throw new Error('este trabalho está endereçado a outra impressora');
  }

  const printer = farm.printer(printerId);
  if (!printer?.online) throw new Error('impressora offline');
  if (printer.status !== 'ociosa') throw new Error('a impressora não está ociosa');
  if (ocupadasAgora().has(printerId)) throw new Error('esta impressora já tem um trabalho em andamento');

  getDb()
    .prepare("UPDATE queue_jobs SET status = 'atribuido', printer_id = ?, started_at = datetime('now') WHERE id = ?")
    .run(printerId, jobId);
  emitirMudanca();

  try {
    await garantirArquivo(printerId, job.arquivo);
    const cliente = farm.clienteVivo(printerId);
    if (!cliente) throw new Error('impressora ficou offline durante o despacho');
    await cliente.iniciarImpressao(job.arquivo.split('/').pop()!);
    getDb().prepare("UPDATE queue_jobs SET status = 'imprimindo' WHERE id = ?").run(jobId);
    logger.info({ job: jobId, printer: printerId, arquivo: job.arquivo }, 'impressão autorizada e iniciada');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    getDb()
      .prepare("UPDATE queue_jobs SET status = 'falhou', erro = ?, finished_at = datetime('now') WHERE id = ?")
      .run(msg, jobId);
    logger.warn({ job: jobId, printer: printerId }, `despacho falhou: ${msg}`);
    emitirMudanca();
    throw new Error(msg);
  }

  emitirMudanca();
  return acharJob(jobId)!;
}

/**
 * Tick do motor.
 *
 * Só faz alguma coisa com QUEUE_AUTO_START ligado. No padrão, a próxima
 * impressão espera autorização: a peça anterior continua na mesa até alguém
 * tirar, e começar por cima dela estraga as duas.
 */
export async function processarFila(): Promise<void> {
  if (!config.filaAutomatica) return;
  if (rodando) return;
  rodando = true;
  try {
    const pendentes = listarFila().filter((j) => j.status === 'pendente');
    if (pendentes.length === 0) return;

    const printers = farm.printers();
    const ocupadas = ocupadasAgora();

    for (const job of pendentes) {
      const alvo = escolherImpressora(job, printers, ocupadas);
      if (!alvo) continue;
      ocupadas.add(alvo.id);
      try {
        await despacharJob(job.id, alvo.id);
      } catch {
        ocupadas.delete(alvo.id);
      }
    }
  } finally {
    rodando = false;
  }
}

/** Fecha os trabalhos quando a impressora sai de 'imprimindo'. */
export function ligarMotorDaFila(): void {
  farm.on('printer', (atual: Printer, anterior: Printer | null) => {
    if (anterior?.status === 'imprimindo' && atual.status !== 'imprimindo') {
      const status: QueueStatus =
        atual.status === 'ociosa' && anterior.pct >= 95
          ? 'concluido'
          : atual.status === 'cancelada'
            ? 'cancelado'
            : atual.status === 'atenção'
              ? 'falhou'
              : 'concluido';
      const r = getDb()
        .prepare(
          `UPDATE queue_jobs SET status = ?, finished_at = datetime('now')
            WHERE printer_id = ? AND status = 'imprimindo'`
        )
        .run(status, atual.id);
      if (r.changes > 0) emitirMudanca();
    }
    if (atual.status === 'ociosa' && atual.online) void processarFila();
  });

  // rede da fazenda oscila; o tick periódico é a rede de segurança do event-driven
  setInterval(() => void processarFila(), 20_000).unref();
}

let emissor: (() => void) | null = null;
export function aoMudarFila(fn: () => void): void {
  emissor = fn;
}
function emitirMudanca(): void {
  emissor?.();
}
