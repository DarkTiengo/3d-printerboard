import { EventEmitter } from 'node:events';
import { MjpegDemuxer } from '../lib/mjpeg.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { acharPrinter } from './printers.repo.js';
import { agenteDaFazenda } from '../lib/http-agent.js';

type Assinante = {
  fps: number;
  ultimoEnvio: number;
  onFrame: (jpeg: Buffer) => void;
};

type Fonte = {
  url: string;
  abort: AbortController | null;
  demux: MjpegDemuxer;
  assinantes: Set<Assinante>;
  ultimoFrame: Buffer | null;
  ultimoFrameEm: number;
  online: boolean;
  reconectarEm: NodeJS.Timeout | null;
  tentativas: number;
  lingerEm: NodeJS.Timeout | null;
  /** quando a última tentativa de conexão falhou; 0 se ainda não falhou nenhuma */
  ultimaFalhaEm: number;
  /** última vez que alguém pediu esta câmera — por assinatura ou por snapshot */
  ultimoPedidoEm: number;
};

/**
 * Quanto tempo a fonte sobrevive sem ninguém pedindo nada.
 *
 * Vale para as duas pontas: o assinante que sai não derruba a câmera na hora,
 * e a câmera que caiu continua tentando voltar enquanto os snapshots da parede
 * ainda estiverem chegando dentro desta janela.
 */
const LINGER_MS = 10_000;

/**
 * Teto para o primeiro quadro de uma conexão nova.
 *
 * Uma câmera pendurada — o host aceita o TCP e nunca responde, que é o que se
 * vê quando o switch cai ou o firewall passa a dropar — só estouraria no
 * `headersTimeout` de 30 s do agente. Até lá a fonte não é marcada como falha,
 * e cada snapshot da parede continua esperando o timeout inteiro. Com este
 * relógio a falha é registrada em 10 s e todo pedido seguinte é respondido na
 * hora.
 */
const ESPERA_PRIMEIRO_QUADRO_MS = 10_000;

/**
 * Uma única conexão upstream por câmera, com fan-out para todos os assinantes.
 *
 * É isto que resolve o alerta do handoff sobre oito streams derrubarem a rede:
 * a parede de câmeras pede fps baixo, a impressora selecionada pede taxa cheia,
 * e o host da câmera vê uma conexão só por câmera, não uma por aba aberta.
 *
 * Emite 'offline'/'online' (printerId) — é a origem do alerta "Câmera offline".
 */
class CameraHub extends EventEmitter {
  private fontes = new Map<string, Fonte>();

  /** Assina o fluxo de uma câmera. Devolve a função de cancelamento. */
  assinar(printerId: string, fps: number, onFrame: (jpeg: Buffer) => void): (() => void) | null {
    const fonte = this.garantirFonte(printerId);
    if (!fonte) return null;

    fonte.ultimoPedidoEm = Date.now();
    const assinante: Assinante = { fps: Math.max(0.2, Math.min(fps, 30)), ultimoEnvio: 0, onFrame };
    fonte.assinantes.add(assinante);

    if (fonte.lingerEm) {
      clearTimeout(fonte.lingerEm);
      fonte.lingerEm = null;
    }
    this.conectar(printerId, fonte);

    /*
     * Primeiro quadro imediato, para o tile pintar sem esperar o próximo ciclo.
     *
     * Sai num microtask de propósito: entregue de forma síncrona, o callback
     * rodaria *antes* de `assinar` retornar — ou seja, antes de quem chamou ter
     * a função de cancelamento em mãos. Foi exatamente essa reentrância que
     * travou o snapshot (veja `capturar`).
     */
    if (fonte.ultimoFrame) {
      const primeiro = fonte.ultimoFrame;
      assinante.ultimoEnvio = Date.now();
      queueMicrotask(() => {
        if (!fonte.assinantes.has(assinante)) return;
        try {
          onFrame(primeiro);
        } catch (err) {
          logger.debug(`câmera ${printerId}: assinante falhou ao receber o primeiro quadro: ${err}`);
          fonte.assinantes.delete(assinante);
        }
      });
    }

    return () => {
      fonte.assinantes.delete(assinante);
      if (fonte.assinantes.size === 0) this.agendarDesligamento(printerId, fonte);
    };
  }

  /** Último quadro recebido — usado no snapshot e no frame do alerta. */
  ultimoFrame(printerId: string): Buffer | null {
    return this.fontes.get(printerId)?.ultimoFrame ?? null;
  }

  /**
   * Um quadro só. Reaproveita o último recebido quando ele é recente o
   * bastante — é o que faz a parede de câmeras por polling custar quase nada:
   * oito tiles pedindo 2 vezes por segundo compartilham a mesma conexão
   * upstream, que o linger mantém aberta entre as requisições.
   */
  async capturar(printerId: string, maxIdadeMs = 5_000, timeoutMs = 8_000): Promise<Buffer | null> {
    const existente = this.ultimoFrame(printerId);
    const fonte = this.fontes.get(printerId);
    if (existente && fonte && Date.now() - fonte.ultimoFrameEm < maxIdadeMs) return existente;

    /*
     * Câmera que já falhou e ainda não voltou: responde agora, com o mesmo que
     * responderíamos depois de esperar — o último quadro conhecido, ou null.
     *
     * Sem isto, cada tile da parede segura uma requisição pelo timeout inteiro
     * enquanto a câmera está fora. Como o navegador só dá 6 conexões por
     * origem, oito tiles pendurados empurram as chamadas da API para trás da
     * fila: medimos a mediana de /api/printers saindo de ~5 ms para 7 s. Numa
     * tela que serve para pausar e cancelar impressão, isso é o que importa.
     *
     * Continuamos tentando reconectar por baixo — quem chamou não espera, mas
     * a câmera volta sozinha assim que puder.
     */
    if (fonte && !fonte.online && fonte.ultimaFalhaEm > 0) {
      fonte.ultimoPedidoEm = Date.now();
      this.garantirTentativa(printerId, fonte);
      return fonte.ultimoFrame;
    }

    return new Promise((resolve) => {
      /*
       * Um único ponto de saída, com tudo declarado antes de qualquer callback
       * poder rodar. A versão anterior chamava clearTimeout(timer) de dentro do
       * callback do assinante, que disparava antes de `const timer` existir: o
       * ReferenceError da zona morta temporal era engolido pelo try/catch da
       * entrega, a flag "pronto" já tinha virado true, e o timeout de 8 s então
       * desistia sem resolver. A promessa nunca assentava, a resposta HTTP
       * nunca era enviada, e o soquete ficava preso — seis desses e o navegador
       * fica sem conexões para qualquer outra chamada.
       */
      let encerrado = false;
      let cancelar: (() => void) | null = null;

      const timer = setTimeout(() => terminar(this.ultimoFrame(printerId)), timeoutMs);

      function terminar(jpeg: Buffer | null): void {
        if (encerrado) return;
        encerrado = true;
        clearTimeout(timer);
        cancelar?.();
        resolve(jpeg);
      }

      cancelar = this.assinar(printerId, 30, terminar);
      if (!cancelar) terminar(null);
      // se o quadro chegou antes de `cancelar` existir, cancelamos agora
      else if (encerrado) cancelar();
    });
  }

  estaOnline(printerId: string): boolean {
    return this.fontes.get(printerId)?.online ?? false;
  }

  parar(): void {
    for (const [id, fonte] of this.fontes) {
      fonte.abort?.abort();
      if (fonte.reconectarEm) clearTimeout(fonte.reconectarEm);
      if (fonte.lingerEm) clearTimeout(fonte.lingerEm);
      this.fontes.delete(id);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private garantirFonte(printerId: string): Fonte | null {
    const cfg = acharPrinter(printerId);
    if (!cfg?.cameraUrl) return null;

    const atual = this.fontes.get(printerId);
    if (atual && atual.url === cfg.cameraUrl) return atual;

    // URL mudou: derruba a antiga
    if (atual) {
      atual.abort?.abort();
      if (atual.reconectarEm) clearTimeout(atual.reconectarEm);
    }
    const fonte: Fonte = {
      url: cfg.cameraUrl,
      abort: null,
      demux: new MjpegDemuxer(),
      assinantes: atual?.assinantes ?? new Set(),
      ultimoFrame: null,
      ultimoFrameEm: 0,
      online: false,
      reconectarEm: null,
      tentativas: 0,
      lingerEm: null,
      ultimaFalhaEm: 0,
      ultimoPedidoEm: Date.now()
    };
    this.fontes.set(printerId, fonte);
    return fonte;
  }

  private agendarDesligamento(printerId: string, fonte: Fonte): void {
    if (fonte.lingerEm) return;
    // linger curto: trocar de aba ou de tela não deve derrubar e reabrir a câmera
    fonte.lingerEm = setTimeout(() => {
      fonte.lingerEm = null;
      if (fonte.assinantes.size > 0) return;
      fonte.abort?.abort();
      fonte.abort = null;
      if (fonte.reconectarEm) {
        clearTimeout(fonte.reconectarEm);
        fonte.reconectarEm = null;
      }
      logger.debug(`câmera ${printerId}: sem assinantes, upstream fechado`);
    }, LINGER_MS);
  }

  private conectar(printerId: string, fonte: Fonte): void {
    if (fonte.abort || fonte.reconectarEm) return;

    const abort = new AbortController();
    fonte.abort = abort;
    fonte.demux.reset();

    void (async () => {
      // desarmado no primeiro quadro; até lá, é ele que impede a fonte de ficar
      // pendurada sem nunca ser marcada como falha
      let estourou = false;
      let esperandoPrimeiro = true;
      const relogio = setTimeout(() => {
        estourou = true;
        abort.abort();
      }, ESPERA_PRIMEIRO_QUADRO_MS);

      try {
        const res = await fetch(fonte.url, { signal: abort.signal, dispatcher: agenteDaFazenda });
        if (!res.ok || !res.body) throw new Error(`câmera respondeu ${res.status}`);

        fonte.tentativas = 0;
        if (!fonte.online) {
          fonte.online = true;
          this.emit('online', printerId);
        }

        for await (const pedaco of res.body as unknown as AsyncIterable<Uint8Array>) {
          const quadros = fonte.demux.push(Buffer.from(pedaco));
          for (const jpeg of quadros) this.distribuir(fonte, jpeg);
          if (esperandoPrimeiro && quadros.length > 0) {
            esperandoPrimeiro = false;
            clearTimeout(relogio);
            // a câmera está de fato entregando: o atalho de `capturar` sai de cena
            fonte.ultimaFalhaEm = 0;
          }
        }
        throw new Error('fluxo encerrado pela câmera');
      } catch (err) {
        clearTimeout(relogio);
        // abortos nossos — troca de URL, desligamento — não são falha da câmera;
        // o do relógio é
        if (abort.signal.aborted && !estourou) return;

        const msg = estourou
          ? `sem quadro em ${ESPERA_PRIMEIRO_QUADRO_MS / 1000}s`
          : err instanceof Error
            ? err.message
            : String(err);
        logger.warn(`câmera ${printerId}: ${msg}`);
        fonte.ultimaFalhaEm = Date.now();
        if (fonte.online) {
          fonte.online = false;
          this.emit('offline', printerId, msg);
        }
        fonte.abort = null;
        if (this.aindaInteressa(fonte)) this.agendarReconexao(printerId, fonte);
      }
    })();
  }

  /**
   * Alguém ainda quer esta câmera?
   *
   * Um assinante vivo conta, e um snapshot recente também: a parede não assina
   * nada — pede um quadro e sai. Sem esta segunda metade, a câmera que caiu
   * pararia de tentar voltar assim que o último assinante saísse, e ficaria
   * morta para sempre mesmo depois de a rede se recuperar.
   */
  private aindaInteressa(fonte: Fonte): boolean {
    return fonte.assinantes.size > 0 || Date.now() - fonte.ultimoPedidoEm < LINGER_MS;
  }

  /** Garante que há uma tentativa de reconexão a caminho, sem duplicar. */
  private garantirTentativa(printerId: string, fonte: Fonte): void {
    if (fonte.abort || fonte.reconectarEm) return;
    this.agendarReconexao(printerId, fonte);
  }

  private agendarReconexao(printerId: string, fonte: Fonte): void {
    if (fonte.reconectarEm) return;
    const espera = Math.min(2_000 * 2 ** fonte.tentativas, 30_000);
    fonte.tentativas = Math.min(fonte.tentativas + 1, 8);
    fonte.reconectarEm = setTimeout(() => {
      fonte.reconectarEm = null;
      if (this.aindaInteressa(fonte)) this.conectar(printerId, fonte);
    }, espera);
  }

  private distribuir(fonte: Fonte, jpeg: Buffer): void {
    fonte.ultimoFrame = jpeg;
    fonte.ultimoFrameEm = Date.now();
    const agora = Date.now();
    for (const a of fonte.assinantes) {
      const intervalo = 1000 / a.fps;
      if (agora - a.ultimoEnvio < intervalo) continue; // descarta: é aqui que a banda é economizada
      a.ultimoEnvio = agora;
      try {
        a.onFrame(jpeg);
      } catch (err) {
        // não engolir calado: já escondeu um bug que travava o snapshot
        logger.debug(`assinante de câmera removido após erro na entrega: ${err}`);
        fonte.assinantes.delete(a);
      }
    }
  }

  /** Câmeras que pararam de mandar quadro — vira alerta de severidade média. */
  verificarSilenciosas(): string[] {
    const mortas: string[] = [];
    const agora = Date.now();
    for (const [id, fonte] of this.fontes) {
      if (fonte.assinantes.size === 0) continue;
      if (fonte.ultimoFrameEm > 0 && agora - fonte.ultimoFrameEm > config.cameraTimeoutMs) {
        mortas.push(id);
      }
    }
    return mortas;
  }
}

export const cameras = new CameraHub();
