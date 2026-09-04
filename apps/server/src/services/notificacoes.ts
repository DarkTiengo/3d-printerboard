import fs from 'node:fs/promises';
import type { Alert, NotificacaoConfig, NotificacaoEstado, NotificacaoPrefs } from '@3dfarm/shared';
import { CODIGOS_DE_ALERTA, CODIGOS_PADRAO } from '@3dfarm/shared';

import { config } from '../config.js';
import { getSetting, setSetting } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { acharAlerta, aoCriarAlerta } from './alerts.js';
import { criarTelegram, escaparHtml, TelegramError, type Telegram } from '../notificadores/telegram.js';

/**
 * Manda os alertas para fora da fazenda.
 *
 * O alerta continua sendo criado e publicado no SSE do mesmo jeito; isto é um
 * segundo inscrito, e uma falha aqui não pode afetar aquilo.
 */

const CHAVE_PREFS = 'notificacoes';
const CHAVE_ESTADO = 'notificacoes_estado';
const CHAVE_TOKEN = 'notificacoes_token';

/**
 * Janela de espera por alerta antes de mandar.
 *
 * Resolve duas coisas de uma vez. Um alerta com câmera é emitido duas vezes —
 * na hora, sem imagem, e de novo quando o JPEG chega ao disco — e sem a janela
 * cada um viraria duas mensagens no celular. E é a espera que permite mandar a
 * foto junto em vez de só texto. Dois segundos não custam nada num aviso destes.
 */
const JANELA_MS = 2_000;

/** O Telegram tolera ~1 mensagem por segundo por chat; a fazenda inteira cai junto. */
const ESPACAMENTO_MS = 1_200;

const MAX_TENTATIVAS = 3;
/** Lembrança do que já foi notificado, para saber o que avisar quando resolve. */
const VALIDADE_NOTIFICADO_MS = 24 * 60 * 60 * 1_000;

/**
 * Teto do `detalhe` dentro da mensagem.
 *
 * A legenda de uma foto no Telegram vale 1024 caracteres. Limitando aqui a
 * parte que pode crescer — `detalhe` carrega a mensagem crua do Klipper e a
 * resposta de G-code do sensor de filamento — a mensagem montada nunca chega
 * perto do limite, e o corte nunca cai em cima do link do rodapé.
 */
const MAX_DETALHE = 700;

const EMOJI: Record<string, string> = {
  critica: '🔴',
  alta: '🟠',
  media: '🟡',
  baixa: '⚪'
};

// ── preferências ────────────────────────────────────────────────────────────

function prefsPadrao(): NotificacaoPrefs {
  return {
    // o .env dá o valor inicial; o que for salvo na tela ganha dele, igual ao
    // intervalo global de backup
    ligado: !!config.telegramToken && !!config.telegramChatId,
    chatId: config.telegramChatId,
    codigos: [...CODIGOS_PADRAO],
    avisarResolucao: true,
    responderComandos: true
  };
}

export function prefs(): NotificacaoPrefs {
  const bruto = getSetting(CHAVE_PREFS);
  if (!bruto) return prefsPadrao();
  try {
    const salvo = JSON.parse(bruto) as Partial<NotificacaoPrefs>;
    const conhecidos = new Set(CODIGOS_DE_ALERTA.map((c) => c.codigo));
    return {
      ...prefsPadrao(),
      ...salvo,
      // um código que saiu do servidor não pode continuar ligado no banco
      codigos: (salvo.codigos ?? CODIGOS_PADRAO).filter((c) => conhecidos.has(c))
    };
  } catch {
    logger.warn('preferências de notificação ilegíveis no banco; usando o padrão');
    return prefsPadrao();
  }
}

export function salvarPrefs(novo: NotificacaoPrefs): void {
  setSetting(CHAVE_PREFS, JSON.stringify(novo));
}

/** O token vive no banco quando alguém o salvou pela tela; senão, vem do .env. */
export function token(): string {
  return getSetting(CHAVE_TOKEN) ?? config.telegramToken;
}

export function salvarToken(valor: string): void {
  setSetting(CHAVE_TOKEN, valor);
}

export function estado(): NotificacaoEstado {
  const bruto = getSetting(CHAVE_ESTADO);
  if (!bruto) return { ultimoEnvioEm: null, ultimoErro: null, ultimoErroEm: null };
  try {
    return JSON.parse(bruto) as NotificacaoEstado;
  } catch {
    return { ultimoEnvioEm: null, ultimoErro: null, ultimoErroEm: null };
  }
}

/**
 * Guardado no banco, e não só em memória: um token errado que derrubou o envio
 * de madrugada precisa continuar visível na tela de manhã.
 */
function registrarEstado(patch: Partial<NotificacaoEstado>): void {
  setSetting(CHAVE_ESTADO, JSON.stringify({ ...estado(), ...patch }));
}

export function configuracao(): NotificacaoConfig {
  return { prefs: prefs(), tokenDefinido: !!token(), estado: estado() };
}

// ── composição da mensagem ──────────────────────────────────────────────────

/**
 * As mensagens saem em português porque é o idioma em que o servidor escreve:
 * `titulo` e `detalhe` são montados em `alerts.ts`, e a tradução por código
 * vive só no front. Traduzir aqui exigiria mover esses textos para cá.
 */
export function compor(alerta: Alert, resolvido: boolean): string {
  const emoji = resolvido ? '✅' : (EMOJI[alerta.sev] ?? '⚪');
  const titulo = resolvido ? `Resolvido: ${alerta.titulo}` : alerta.titulo;

  const linhas = [`${emoji} <b>${escaparHtml(titulo)}</b> — ${escaparHtml(alerta.impressora)}`];
  if (!resolvido && alerta.detalhe.trim()) {
    const detalhe = alerta.detalhe.trim();
    linhas.push('', escaparHtml(detalhe.length > MAX_DETALHE ? `${detalhe.slice(0, MAX_DETALHE - 1)}…` : detalhe));
  }
  if (config.appBaseUrl) linhas.push('', `<a href="${config.appBaseUrl}/">Abrir o painel</a>`);
  return linhas.join('\n');
}

// ── fila de envio ───────────────────────────────────────────────────────────

type Item = { alerta: Alert; resolvido: boolean; tentativas: number };

const janelas = new Map<number, NodeJS.Timeout>();
const notificados = new Map<number, number>();
const fila: Item[] = [];
let processando = false;
/** Instante mais cedo em que o próximo envio pode sair. */
let proximoEnvioEm = 0;
/** Trocável nos testes por um duplo. */
let fabricaDeTelegram: (token: string, chatId: string) => Telegram = criarTelegram;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function enfileirar(item: Item): void {
  fila.push(item);
  void processar();
}

async function processar(): Promise<void> {
  if (processando) return;
  processando = true;
  try {
    while (fila.length > 0) {
      /*
       * A espera vem antes do envio, e é contra o relógio — não "durma depois
       * de mandar, se ainda houver fila".
       *
       * Oito impressoras caem no mesmo segundo e cada alerta chega aqui
       * sozinho: com a espera no fim, cada um encontrava a fila já vazia, saía
       * sem intervalo, e o espaçamento não valia nada justamente no caso para o
       * qual existe.
       */
      const faltam = proximoEnvioEm - Date.now();
      if (faltam > 0) await dormir(faltam);

      const item = fila.shift()!;
      proximoEnvioEm = Date.now() + (await enviar(item));
    }
  } finally {
    processando = false;
  }
}

/** Manda um item e devolve quanto esperar antes do próximo. */
async function enviar(item: Item): Promise<number> {
  const p = prefs();
  const tg = fabricaDeTelegram(token(), p.chatId);
  const texto = compor(item.alerta, item.resolvido);

  try {
    const jpeg = item.resolvido ? null : await lerFrame(item.alerta.id);
    if (jpeg) await tg.enviarFoto(jpeg, texto);
    else await tg.enviarTexto(texto);

    registrarEstado({ ultimoEnvioEm: new Date().toISOString() });
    return ESPACAMENTO_MS;
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    const telegram = err instanceof TelegramError ? err : null;

    if (telegram && !telegram.vaiMelhorarComRetry) {
      // token inválido, chat inexistente: repetir só gera log
      logger.error({ alerta: item.alerta.id }, `notificação recusada: ${motivo}`);
      registrarEstado({ ultimoErro: motivo, ultimoErroEm: new Date().toISOString() });
      return ESPACAMENTO_MS;
    }

    item.tentativas += 1;
    if (item.tentativas >= MAX_TENTATIVAS) {
      logger.error({ alerta: item.alerta.id }, `notificação desistiu após ${MAX_TENTATIVAS}: ${motivo}`);
      registrarEstado({ ultimoErro: motivo, ultimoErroEm: new Date().toISOString() });
      return ESPACAMENTO_MS;
    }

    logger.warn({ alerta: item.alerta.id }, `notificação falhou (${item.tentativas}/${MAX_TENTATIVAS}): ${motivo}`);
    fila.unshift(item);
    // num 429 o próprio Telegram diz quanto esperar; fora isso, backoff
    return telegram?.esperarSegundos != null
      ? telegram.esperarSegundos * 1_000
      : Math.min(2_000 * 2 ** item.tentativas, 30_000);
  }
}

async function lerFrame(alertaId: number): Promise<Buffer | null> {
  const caminho = acharAlerta(alertaId)?.framePath;
  if (!caminho) return null;
  try {
    return await fs.readFile(caminho);
  } catch {
    // o alerta vale mais que a foto: manda como texto
    return null;
  }
}

// ── entrada ─────────────────────────────────────────────────────────────────

function podarNotificados(): void {
  const limite = Date.now() - VALIDADE_NOTIFICADO_MS;
  for (const [id, quando] of notificados) if (quando < limite) notificados.delete(id);
}

/** Recebe cada alerta criado ou resolvido e decide se vira mensagem. */
export function aoAlerta(alerta: Alert): void {
  const p = prefs();
  if (!p.ligado || !token() || !p.chatId) return;

  if (alerta.resolvidoEm) {
    // só avisa que voltou quem foi avisado que caiu
    if (!p.avisarResolucao || !notificados.has(alerta.id)) return;
    notificados.delete(alerta.id);
    const janela = janelas.get(alerta.id);
    if (janela) {
      clearTimeout(janela);
      janelas.delete(alerta.id);
    }
    enfileirar({ alerta, resolvido: true, tentativas: 0 });
    return;
  }

  if (!p.codigos.includes(alerta.codigo)) return;
  if (notificados.has(alerta.id)) return; // já saiu; esta é a reemissão com o frame

  /*
   * Reinicia a janela a cada emissão do mesmo alerta: a última versão vista
   * dentro dela é a que vai — e é a que tem a foto.
   */
  const anterior = janelas.get(alerta.id);
  if (anterior) clearTimeout(anterior);

  const timer = setTimeout(() => {
    janelas.delete(alerta.id);
    podarNotificados();
    notificados.set(alerta.id, Date.now());
    enfileirar({ alerta, resolvido: false, tentativas: 0 });
  }, JANELA_MS);
  timer.unref();
  janelas.set(alerta.id, timer);
}

export function ligarNotificacoes(): void {
  aoCriarAlerta(aoAlerta);
  const p = prefs();
  if (p.ligado && token() && p.chatId) logger.info(`notificações por Telegram ligadas (chat ${p.chatId})`);
  else logger.info('notificações por Telegram desligadas');
}

/** Manda uma mensagem avulsa agora, sem fila. É o botão de teste da tela. */
export async function enviarTeste(tokenTeste: string, chatId: string): Promise<void> {
  await fabricaDeTelegram(tokenTeste, chatId).enviarTexto(
    '✅ <b>3D Printerboard</b>\n\nSe você está lendo isto, as notificações da fazenda estão funcionando.'
  );
}

/** Só para os testes: troca o cliente e limpa o estado entre casos. */
export function _usarFabrica(fn: typeof fabricaDeTelegram): void {
  fabricaDeTelegram = fn;
}

export function _limparEstado(): void {
  for (const t of janelas.values()) clearTimeout(t);
  janelas.clear();
  notificados.clear();
  fila.length = 0;
  processando = false;
  proximoEnvioEm = 0;
  fabricaDeTelegram = criarTelegram;
}
