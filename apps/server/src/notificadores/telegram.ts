import { config } from '../config.js';
import { descreverFalha } from '../moonraker/http.js';

/**
 * Cliente do Bot API do Telegram. Não sabe nada sobre alertas — recebe texto e
 * bytes e devolve sucesso ou erro. Quem decide o que mandar é `notificacoes.ts`.
 *
 * Não usa o `agenteDaFazenda` de propósito: aquele agente tem `bodyTimeout: 0`
 * e resolução por mDNS, afinados para streams de câmera na LAN. Aqui o destino
 * é a internet e o que se quer é o oposto — desistir rápido.
 */

const TIMEOUT_MS = 15_000;
/**
 * Espera do lado do Telegram no long polling. O HTTP precisa de folga em cima
 * dela, senão abortaríamos a chamada justo quando ela está funcionando.
 */
export const POLL_S = 30;
const POLL_TIMEOUT_MS = (POLL_S + 15) * 1_000;
/** A legenda de uma foto é limitada a 1024 caracteres; o texto solto, a 4096. */
const MAX_LEGENDA = 1024;
const MAX_TEXTO = 4096;

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Segundos que o Telegram pediu para esperar, num 429. */
    readonly esperarSegundos?: number
  ) {
    super(message);
    this.name = 'TelegramError';
  }

  /**
   * 4xx que não é 429 quer dizer pedido errado — token inválido, chat que não
   * existe. Repetir só gera log. Vale a mesma regra do cliente do Moonraker:
   * "URL quebrada não melhora com retry".
   */
  get vaiMelhorarComRetry(): boolean {
    if (this.status == null) return true; // falha de rede
    if (this.status === 429) return true;
    return this.status >= 500;
  }
}

/** Escapa o mínimo que o `parse_mode: HTML` do Telegram exige. */
export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Corte de emergência. Quem compõe a mensagem é que garante o tamanho; isto é
 * a rede de segurança — e ela precisa ser consciente de HTML, porque cortar no
 * meio de `<a href="…` faz o Telegram recusar a mensagem inteira com
 * "can't parse entities", trocando um aviso truncado por aviso nenhum.
 */
function cortar(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  return `${texto.slice(0, limite - 1).replace(/<[^>]*$/, '')}…`;
}

/** Só o que usamos de uma atualização; o Telegram manda muito mais. */
export type Atualizacao = {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
    from?: { username?: string; first_name?: string };
  };
};

export type Telegram = {
  enviarTexto(texto: string): Promise<void>;
  enviarFoto(jpeg: Buffer, legenda: string): Promise<void>;
  /**
   * Long polling. É assim, e não por webhook, porque webhook exige um endereço
   * público com HTTPS — e a fazenda vive atrás de um NAT, em http:// na LAN.
   * O polling sai de dentro para fora e não precisa de nada aberto.
   *
   * `offset` confirma tudo que veio antes dele. Passar -1 com limite 1 e espera
   * zero devolve só a última atualização — é como se descarta, no boot, a fila
   * que se acumulou enquanto o servidor estava fora.
   */
  receberAtualizacoes(offset: number | null, esperaS: number, limite?: number): Promise<Atualizacao[]>;
};

export function criarTelegram(token: string, chatId: string, apiBase = config.telegramApiBase): Telegram {
  async function chamar<T = void>(
    metodo: string,
    corpo: FormData | Record<string, unknown>,
    timeoutMs = TIMEOUT_MS
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const ehForm = corpo instanceof FormData;
      const res = await fetch(`${apiBase}/bot${token}/${metodo}`, {
        method: 'POST',
        headers: ehForm ? undefined : { 'Content-Type': 'application/json' },
        body: ehForm ? corpo : JSON.stringify(corpo),
        signal: ctrl.signal
      });

      if (res.ok) {
        const corpoOk = (await res.json().catch(() => null)) as { result?: T } | null;
        return corpoOk?.result as T;
      }

      /*
       * O Telegram descreve a recusa no corpo (`description`), e num 429 diz em
       * `parameters.retry_after` quantos segundos esperar. Sem ler isso, o
       * diagnóstico na tela seria só "respondeu 400".
       */
      const detalhe = (await res.json().catch(() => null)) as {
        description?: string;
        parameters?: { retry_after?: number };
      } | null;
      const motivo = detalhe?.description ?? `${metodo} respondeu ${res.status}`;
      throw new TelegramError(motivo, res.status, detalhe?.parameters?.retry_after);
    } catch (err) {
      if (err instanceof TelegramError) throw err;
      throw new TelegramError(`${metodo}: ${descreverFalha(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async enviarTexto(texto) {
      await chamar('sendMessage', {
        chat_id: chatId,
        text: cortar(texto, MAX_TEXTO),
        parse_mode: 'HTML',
        // a prévia do link do painel roubaria a atenção da mensagem
        link_preview_options: { is_disabled: true }
      });
    },

    async enviarFoto(jpeg, legenda) {
      const form = new FormData();
      form.set('chat_id', chatId);
      form.set('caption', cortar(legenda, MAX_LEGENDA));
      form.set('parse_mode', 'HTML');
      form.set('photo', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'alerta.jpg');
      await chamar('sendPhoto', form);
    },

    async receberAtualizacoes(offset, esperaS, limite) {
      const res = await chamar<Atualizacao[]>(
        'getUpdates',
        {
          ...(offset == null ? {} : { offset }),
          ...(limite == null ? {} : { limit: limite }),
          timeout: esperaS,
          // mensagens bastam; sem isto viriam edições, callbacks e mais
          allowed_updates: ['message']
        },
        esperaS === 0 ? TIMEOUT_MS : POLL_TIMEOUT_MS
      );
      return res ?? [];
    }
  };
}
