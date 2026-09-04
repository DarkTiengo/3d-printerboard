import type { Printer } from '@3dfarm/shared';
import { alvo, duracao, semExtensao, temperatura } from '@3dfarm/shared';

import { logger } from '../lib/logger.js';
import { farm } from './farm.js';
import { cameras } from './cameras.js';
import { prefs, token } from './notificacoes.js';
import { criarTelegram, escaparHtml, POLL_S, type Atualizacao, type Telegram } from '../notificadores/telegram.js';

/**
 * Perguntar à fazenda pelo chat.
 *
 * Só leitura, de propósito. Um chat do Telegram não é uma sessão autenticada:
 * quem estiver com o celular na mão, ou qualquer pessoa do grupo, escreveria a
 * mensagem. Pausar ou cancelar uma impressão continua exigindo entrar no app,
 * onde há usuário, papel e registro de quem fez.
 */

const ESPERA_DESLIGADO_MS = 5_000;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
/** A câmera é opcional; se demorar, a resposta de texto vale mais que a foto. */
const FOTO_TIMEOUT_MS = 4_000;

const EMOJI_STATUS: Record<string, string> = {
  imprimindo: '🟢',
  pausada: '⏸',
  atenção: '🔴',
  cancelada: '⚪',
  ociosa: '⚪'
};

function emoji(p: Printer): string {
  if (!p.online) return '⚫';
  if (p.klippy !== 'ready') return '🔴';
  return EMOJI_STATUS[p.status] ?? '⚪';
}

function situacao(p: Printer): string {
  if (!p.online) return 'fora do ar';
  if (p.klippy !== 'ready') return 'Klipper parado';
  if (p.status === 'imprimindo') return `${p.pct}%`;
  return p.status;
}

// ── respostas ───────────────────────────────────────────────────────────────

/** Uma linha por máquina — é a visão que se quer ao perguntar do nada. */
export function resumoDaFazenda(printers: Printer[]): string {
  if (printers.length === 0) return 'Nenhuma impressora cadastrada.';

  const imprimindo = printers.filter((p) => p.online && p.status === 'imprimindo').length;
  const problemas = printers.filter((p) => !p.online || p.klippy !== 'ready' || p.status === 'atenção').length;

  const cabecalho =
    problemas > 0
      ? `🖨 <b>Fazenda</b> — ${imprimindo} imprimindo, ${problemas} com problema`
      : `🖨 <b>Fazenda</b> — ${imprimindo} imprimindo`;

  const linhas = printers.map((p) => {
    const partes = [escaparHtml(p.nome), situacao(p)];
    if (p.online && p.klippy === 'ready' && p.status === 'imprimindo') {
      partes.push(escaparHtml(semExtensao(p.job)));
      if (p.restanteSegundos != null) partes.push(`falta ${duracao(p.restanteSegundos)}`);
    }
    return `${emoji(p)} ${partes.join(' · ')}`;
  });

  return [cabecalho, '', ...linhas].join('\n');
}

/** Detalhe de uma máquina — é a legenda que acompanha a foto da câmera. */
export function detalheDaImpressora(p: Printer): string {
  const linhas = [`${emoji(p)} <b>${escaparHtml(p.nome)}</b>`, ''];

  if (!p.online) {
    linhas.push('A impressora está fora do ar: o host do Moonraker não responde.');
    return linhas.join('\n');
  }
  if (p.klippy !== 'ready') {
    linhas.push('O Klipper está parado.');
    if (p.mensagemKlippy) linhas.push('', escaparHtml(p.mensagemKlippy));
    linhas.push('', 'A máquina não aceita comandos até um FIRMWARE_RESTART.');
    return linhas.join('\n');
  }

  if (p.status === 'imprimindo' || p.status === 'pausada') {
    linhas.push(escaparHtml(semExtensao(p.job)));
    const progresso = [`${p.pct}%`, `camada ${p.camada}`];
    if (p.status === 'pausada') progresso.push('pausada');
    else if (p.restanteSegundos != null) progresso.push(`falta ${duracao(p.restanteSegundos)}`);
    linhas.push(progresso.join(' · '));
  } else {
    linhas.push(`Máquina ${p.status}.`);
  }

  const temps = p.temperaturas
    .map((t) => `${t.chave} ${temperatura(t.atual)} / ${alvo(t.alvo)}`)
    .join(' · ');
  if (temps) linhas.push(temps);

  return linhas.join('\n');
}

const AJUDA = [
  '🖨 <b>3D Printerboard</b>',
  '',
  '/status — como está a fazenda inteira',
  '/status &lt;impressora&gt; — uma máquina, com a foto da câmera',
  '/ajuda — esta lista',
  '',
  'A impressora pode ser pelo código (P05) ou por parte do nome (voron).'
].join('\n');

/**
 * Acha a máquina pelo que a pessoa escreveu: código exato primeiro, depois
 * pedaço do nome. Devolve a lista quando está ambíguo, para a resposta poder
 * pedir que escolha em vez de adivinhar.
 */
export function acharImpressora(printers: Printer[], alvoTexto: string): Printer[] {
  const busca = alvoTexto.trim().toLowerCase();
  if (!busca) return [];
  const porId = printers.find((p) => p.id.toLowerCase() === busca);
  if (porId) return [porId];
  return printers.filter((p) => p.nome.toLowerCase().includes(busca));
}

// ── laço ────────────────────────────────────────────────────────────────────

let parado = true;
let offset: number | null = null;
let tentativas = 0;
let fabricaDeTelegram: (token: string, chatId: string) => Telegram = criarTelegram;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Só o chat configurado é atendido, e o resto é ignorado em silêncio.
 *
 * Qualquer pessoa acha o bot pelo nome e escreve para ele. Responder — mesmo
 * que fosse "sem permissão" — já confirmaria a um estranho que existe uma
 * fazenda atrás dele.
 */
function autorizado(u: Atualizacao, chatId: string): boolean {
  return String(u.message?.chat?.id ?? '') === String(chatId);
}

export async function responder(tg: Telegram, texto: string): Promise<void> {
  const comando = texto.trim().split(/\s+/);
  // num grupo o Telegram entrega "/status@meubot"
  const verbo = (comando[0] ?? '').split('@')[0].toLowerCase();
  const resto = comando.slice(1).join(' ');

  if (verbo === '/ajuda' || verbo === '/start' || verbo === '/help') {
    await tg.enviarTexto(AJUDA);
    return;
  }

  if (verbo !== '/status') {
    await tg.enviarTexto(AJUDA);
    return;
  }

  const printers = farm.printers();

  if (!resto) {
    await tg.enviarTexto(resumoDaFazenda(printers));
    return;
  }

  const achadas = acharImpressora(printers, resto);
  if (achadas.length === 0) {
    const ids = printers.map((p) => `${p.id} (${p.nome})`).join('\n');
    await tg.enviarTexto(
      `Não achei "${escaparHtml(resto)}".${ids ? `\n\nAs impressoras são:\n${escaparHtml(ids)}` : ''}`
    );
    return;
  }
  if (achadas.length > 1) {
    const lista = achadas.map((p) => `${p.id} (${p.nome})`).join('\n');
    await tg.enviarTexto(`"${escaparHtml(resto)}" combina com mais de uma:\n\n${escaparHtml(lista)}`);
    return;
  }

  const p = achadas[0];
  const legenda = detalheDaImpressora(p);
  const jpeg = p.temTaCamera ? await cameras.capturar(p.id, FOTO_TIMEOUT_MS).catch(() => null) : null;
  if (jpeg) await tg.enviarFoto(jpeg, legenda);
  else await tg.enviarTexto(legenda);
}

async function umaVolta(): Promise<void> {
  const p = prefs();
  const tok = token();
  if (!p.responderComandos || !tok || !p.chatId) {
    // desligado: nem abre conexão. Ao voltar, o offset zerado descarta a fila.
    offset = null;
    await dormir(ESPERA_DESLIGADO_MS);
    return;
  }

  const tg = fabricaDeTelegram(tok, p.chatId);

  if (offset == null) {
    /*
     * Primeira volta: joga fora o que chegou enquanto o servidor estava fora.
     * "/status" é uma pergunta sobre agora — responder a uma de seis horas
     * atrás só produziria confusão.
     */
    const ultimas = await tg.receberAtualizacoes(-1, 0, 1);
    offset = ultimas.length > 0 ? ultimas[ultimas.length - 1].update_id + 1 : 0;
    tentativas = 0;
    return;
  }

  const atualizacoes = await tg.receberAtualizacoes(offset, POLL_S);
  tentativas = 0;

  for (const u of atualizacoes) {
    offset = u.update_id + 1;
    const texto = u.message?.text;
    if (!texto) continue;
    if (!autorizado(u, p.chatId)) {
      logger.warn({ chat: u.message?.chat?.id }, 'mensagem no bot vinda de um chat não configurado; ignorada');
      continue;
    }
    try {
      await responder(tg, texto);
    } catch (err) {
      logger.warn(`falha ao responder "${texto}": ${err}`);
    }
  }
}

async function laco(): Promise<void> {
  while (!parado) {
    try {
      await umaVolta();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      /*
       * 409 é o Telegram dizendo que outro alguém já está lendo este bot —
       * uma segunda instância do app, ou um webhook configurado. Vale um erro
       * visível, porque o sintoma (comandos que não respondem) não denuncia
       * sozinho a causa.
       */
      if (/conflict/i.test(msg)) logger.error(`bot do Telegram: outro processo já está lendo este bot (${msg})`);
      else logger.warn(`bot do Telegram: ${msg}`);

      tentativas = Math.min(tentativas + 1, 10);
      offset = null;
      await dormir(Math.min(BACKOFF_MIN_MS * 2 ** tentativas, BACKOFF_MAX_MS));
    }
  }
}

export function ligarBot(): void {
  if (!parado) return;
  parado = false;
  offset = null;
  tentativas = 0;
  void laco();
}

export function pararBot(): void {
  parado = true;
}

/** Só para os testes. */
export function _usarFabrica(fn: typeof fabricaDeTelegram): void {
  fabricaDeTelegram = fn;
}
