import type {
  AcaoDeteccao,
  DeteccaoPadroes,
  DeteccaoPrefs,
  DeteccaoPrefsInput,
  Printer,
  RotacaoCamera
} from '@gridfarm/shared';
import { acaoValida } from '@gridfarm/shared';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { cameras } from './cameras.js';
import { farm } from './farm.js';
import { criarAlerta, marcarPausaAutomatica } from './alerts.js';
import { caminhoDoModelo, modeloPronto } from './modelo.js';
import { classificar } from '../lib/visao.js';

/**
 * Detecção de falha pela câmera: olha um quadro de vez em quando, e quando a
 * evidência se acumula, pausa a impressão.
 *
 * O problema difícil aqui não é reconhecer espaguete numa foto — o modelo faz
 * isso. É *não parar uma impressão boa*. O bico passa na frente da câmera, a
 * luz muda quando alguém acende a oficina, um quadro sai borrado no meio de um
 * movimento rápido: qualquer um desses tira uma nota alta de um classificador
 * treinado em fotos limpas. Por isso nada aqui age numa amostra só — são
 * `deteccaoConfirmacoes` seguidas, o que com o intervalo padrão dá mais de um
 * minuto de evidência contínua.
 *
 * E o custo é segurado por três escolhas, não pelo tamanho do modelo: só olha
 * quem está imprimindo, uma análise por vez na fazenda inteira, e um quadro a
 * cada ~25 s por máquina. Numa fazenda de oito imprimindo tudo isso dá ~26 %
 * de um núcleo de um Raspberry Pi 4.
 */

/** De quanto em quanto tempo o relógio acorda para escolher uma máquina. */
const TIQUE_MS = 5_000;

type Estado = {
  /** a impressão que estamos acompanhando; mudou, zera tudo */
  job: string;
  /** quando vimos esta impressão começar — a espera inicial conta daqui */
  desde: number;
  ultimaAnaliseEm: number;
  /** amostras suspeitas em sequência; qualquer quadro limpo zera */
  seguidas: number;
  /** já agimos nesta impressão — uma vez por job, e só uma */
  agiu: boolean;
  ultimaConf: number;
};

const estados = new Map<string, Estado>();

let relogio: NodeJS.Timeout | null = null;
let analisando = false;
/** Lembrado para não fazer um stat no disco a cada tique. */
let modeloOk = false;
let avisouSemModelo = false;

type Classificador = (jpeg: Buffer, rotacao: RotacaoCamera) => Promise<number>;

const classificadorPadrao: Classificador = async (jpeg, rotacao) => {
  if (config.deteccaoSimularConf !== '') {
    const forcado = Number(config.deteccaoSimularConf);
    return Number.isFinite(forcado) ? forcado : 0;
  }
  return classificar(jpeg, rotacao, caminhoDoModelo());
};

let classificador: Classificador = classificadorPadrao;

// ── preferências por impressora ─────────────────────────────────────────────

type PrefsRow = { printer_id: string; ligado: number; limiar: number | null; acao: string | null };

export function prefsDe(printerId: string): DeteccaoPrefs {
  const row = getDb().prepare('SELECT * FROM deteccao_prefs WHERE printer_id = ?').get(printerId) as
    | PrefsRow
    | undefined;
  if (!row) return { printerId, ligado: false, limiar: null, acao: null };
  return {
    printerId,
    ligado: row.ligado === 1,
    limiar: row.limiar,
    acao: acaoValida(row.acao) ? row.acao : null
  };
}

/** Limita o limiar ao intervalo útil; `null` volta a herdar o global. */
function limiarOuHerda(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(0.95, Math.max(0.1, n));
}

export function salvarPrefs(printerId: string, entrada: DeteccaoPrefsInput): DeteccaoPrefs {
  const atual = prefsDe(printerId);
  const ligado = 'ligado' in entrada ? entrada.ligado === true : atual.ligado;
  const limiar = 'limiar' in entrada ? limiarOuHerda(entrada.limiar) : atual.limiar;
  const acao = 'acao' in entrada ? (acaoValida(entrada.acao) ? entrada.acao : null) : atual.acao;

  getDb()
    .prepare(
      `INSERT INTO deteccao_prefs (printer_id, ligado, limiar, acao, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(printer_id) DO UPDATE SET
         ligado = excluded.ligado, limiar = excluded.limiar,
         acao = excluded.acao, updated_at = excluded.updated_at`
    )
    .run(printerId, ligado ? 1 : 0, limiar, acao);

  // desligar no meio de uma suspeita não deve deixar a contagem pendurada
  if (!ligado) estados.delete(printerId);
  return { printerId, ligado, limiar, acao };
}

export function padroesDeteccao(): DeteccaoPadroes {
  return {
    disponivel: config.deteccaoLigada,
    limiar: config.deteccaoLimiar,
    acao: acaoValida(config.deteccaoAcao) ? config.deteccaoAcao : 'pausar',
    intervaloS: config.deteccaoIntervaloS,
    confirmacoes: config.deteccaoConfirmacoes
  };
}

function limiarDe(prefs: DeteccaoPrefs): number {
  return prefs.limiar ?? padroesDeteccao().limiar;
}

function acaoDe(prefs: DeteccaoPrefs): AcaoDeteccao {
  return prefs.acao ?? padroesDeteccao().acao;
}

// ── o ciclo ─────────────────────────────────────────────────────────────────

/**
 * Acompanha o estado de uma impressora e diz se ela está elegível agora.
 *
 * Também é aqui que a contagem de suspeitas é zerada: a evidência precisa ser
 * contínua, então qualquer coisa que interrompa a impressão recomeça do zero.
 * O que *não* é zerado fora de uma troca de impressão é o `agiu` — quem
 * retomou depois de olhar a foto já decidiu, e pausar de novo seria discutir
 * com o usuário.
 */
function acompanhar(p: Printer, agora: number): Estado {
  const anterior = estados.get(p.id);
  if (!anterior || anterior.job !== p.job) {
    const novo: Estado = { job: p.job, desde: agora, ultimaAnaliseEm: 0, seguidas: 0, agiu: false, ultimaConf: 0 };
    estados.set(p.id, novo);
    return novo;
  }
  if (p.status !== 'imprimindo') anterior.seguidas = 0;
  return anterior;
}

function elegivel(p: Printer, e: Estado, prefs: DeteccaoPrefs, agora: number): boolean {
  if (!prefs.ligado || e.agiu) return false;
  if (p.status !== 'imprimindo' || !p.online || p.klippy !== 'ready') return false;
  if (!p.temTaCamera) return false;
  // a linha de purga e a saia são exatamente o que o modelo chama de emaranhado
  if (agora - e.desde < config.deteccaoEsperaInicialS * 1_000) return false;
  return agora - e.ultimaAnaliseEm >= config.deteccaoIntervaloS * 1_000;
}

/** A máquina que está esperando análise há mais tempo. */
function proxima(agora: number): { p: Printer; e: Estado; prefs: DeteccaoPrefs } | null {
  let escolhida: { p: Printer; e: Estado; prefs: DeteccaoPrefs } | null = null;

  for (const p of farm.printers()) {
    const e = acompanhar(p, agora);
    const prefs = prefsDe(p.id);
    if (!elegivel(p, e, prefs, agora)) continue;
    if (!escolhida || e.ultimaAnaliseEm < escolhida.e.ultimaAnaliseEm) escolhida = { p, e, prefs };
  }

  return escolhida;
}

async function analisar(p: Printer, e: Estado, prefs: DeteccaoPrefs): Promise<void> {
  /*
   * `capturar` devolve o quadro do cache quando a parede de câmeras já está
   * aberta — nesse caso a análise não custa um byte de rede. Com ninguém
   * olhando, sobe a fonte por alguns segundos e o linger do hub a derruba.
   */
  const jpeg = await cameras.capturar(p.id, config.deteccaoIntervaloS * 900, 8_000);
  e.ultimaAnaliseEm = Date.now();
  if (!jpeg) return;

  const conf = await classificador(jpeg, p.cameraRotacao);
  e.ultimaConf = conf;

  const limiar = limiarDe(prefs);
  if (conf < limiar) {
    e.seguidas = 0;
    return;
  }

  e.seguidas += 1;
  logger.debug(
    { printer: p.id, conf: conf.toFixed(2), seguidas: e.seguidas },
    'quadro suspeito na detecção de falha'
  );
  if (e.seguidas < config.deteccaoConfirmacoes) return;

  e.agiu = true;
  await agir(p, e, prefs, jpeg, conf);
}

/**
 * Confirmada a falha: age na máquina e só então cria o alerta.
 *
 * Nesta ordem, e com o quadro que convenceu indo junto. Recapturar depois
 * daria uma foto da máquina já pausada, com o bico estacionado noutro canto —
 * a imagem que explica a decisão é a que a motivou, não a de dez segundos
 * depois.
 */
async function agir(p: Printer, e: Estado, prefs: DeteccaoPrefs, jpeg: Buffer, conf: number): Promise<void> {
  const acao = acaoDe(prefs);
  logger.info({ printer: p.id, por: 'detector', conf: conf.toFixed(2), acao }, 'falha detectada pela câmera');

  let feito: string;
  if (acao === 'alertar') {
    feito = 'Nenhuma ação automática: esta impressora está configurada só para avisar.';
  } else {
    const cliente = farm.clienteVivo(p.id);
    const verbo = acao === 'pausar' ? 'pausada' : 'cancelada';
    if (!cliente) {
      feito = `Tentei ${acao} a impressão, mas a máquina saiu da rede antes.`;
    } else {
      try {
        // o alerta desta pausa é o de baixo, com a foto: o "impressão pausada"
        // genérico logo atrás só faria o celular tocar duas vezes pelo mesmo
        if (acao === 'pausar') marcarPausaAutomatica(p.id);
        await (acao === 'pausar' ? cliente.pausar() : cliente.cancelar());
        feito =
          acao === 'pausar'
            ? 'A impressão foi pausada — abra o painel para retomar ou cancelar.'
            : 'A impressão foi cancelada.';
      } catch (err) {
        feito = `Tentei deixar a impressão ${verbo} e a máquina recusou: ${err instanceof Error ? err.message : err}`;
      }
    }
  }

  await criarAlerta({
    printerId: p.id,
    printerNome: p.nome,
    sev: 'alta',
    codigo: 'falha_detectada',
    titulo: 'Possível falha na impressão',
    detalhe:
      `A câmera mostrou algo parecido com espaguete em ${e.seguidas} análises seguidas ` +
      `(confiança ${conf.toFixed(2)}), na impressão de ${p.job || 'arquivo sem nome'}. ${feito}`,
    frameLabel: `CAM ${p.id}`,
    dedupeKey: `falha:${p.id}:${p.job}`,
    capturarFrame: true,
    frame: jpeg
  });
}

async function tique(): Promise<void> {
  if (analisando) return; // a análise anterior ainda roda: pula a vez

  if (!modeloOk) {
    modeloOk = await modeloPronto();
    if (!modeloOk) {
      if (!avisouSemModelo) {
        logger.warn('detecção de falha ligada, mas o modelo ainda não está no disco — nada será analisado');
        avisouSemModelo = true;
      }
      return;
    }
  }

  const agora = Date.now();
  const alvo = proxima(agora);
  if (!alvo) return;

  analisando = true;
  try {
    await analisar(alvo.p, alvo.e, alvo.prefs);
  } catch (err) {
    logger.warn(`falha ao analisar a câmera de ${alvo.p.id}: ${err}`);
  } finally {
    analisando = false;
  }
}

export function ligarDetectorDeFalhas(): void {
  if (!config.deteccaoLigada) {
    logger.info('detecção de falha pela câmera desligada (DETECCAO_ENABLED)');
    return;
  }
  if (config.deteccaoSimularConf !== '') {
    logger.warn(`DETECCAO_SIMULAR_CONF=${config.deteccaoSimularConf} — a confiança está sendo forçada, só use isso em desenvolvimento`);
  }

  farm.on('removida', (id: string) => estados.delete(id));

  relogio = setInterval(() => void tique(), TIQUE_MS);
  relogio.unref();
  logger.info(
    `detecção de falha ativa: um quadro a cada ${config.deteccaoIntervaloS} s por máquina, ` +
      `${config.deteccaoConfirmacoes} suspeitas seguidas para agir`
  );
}

export function pararDetectorDeFalhas(): void {
  if (relogio) clearInterval(relogio);
  relogio = null;
}

// ── ganchos de teste ────────────────────────────────────────────────────────

export function _usarClassificador(fn: Classificador): void {
  classificador = fn;
}

export function _limparDeteccao(): void {
  classificador = classificadorPadrao;
  estados.clear();
  analisando = false;
  modeloOk = false;
  avisouSemModelo = false;
  pararDetectorDeFalhas();
}

/** Roda um ciclo agora, sem esperar o relógio. Só os testes usam. */
export async function _tique(): Promise<void> {
  await tique();
}

/** Finge que o modelo está no disco, para os testes não precisarem de arquivo. */
export function _modeloPronto(v: boolean): void {
  modeloOk = v;
}
