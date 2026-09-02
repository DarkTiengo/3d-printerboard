import { EventEmitter } from 'node:events';
import { MjpegDemuxer } from '../lib/mjpeg.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { acharPrinter } from './printers.repo.js';

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
};

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
      lingerEm: null
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
    }, 10_000);
  }

  private conectar(printerId: string, fonte: Fonte): void {
    if (fonte.abort || fonte.reconectarEm) return;

    const abort = new AbortController();
    fonte.abort = abort;
    fonte.demux.reset();

    void (async () => {
      try {
        const res = await fetch(fonte.url, { signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(`câmera respondeu ${res.status}`);

        fonte.tentativas = 0;
        if (!fonte.online) {
          fonte.online = true;
          this.emit('online', printerId);
        }

        for await (const pedaco of res.body as unknown as AsyncIterable<Uint8Array>) {
          const quadros = fonte.demux.push(Buffer.from(pedaco));
          for (const jpeg of quadros) this.distribuir(fonte, jpeg);
        }
        throw new Error('fluxo encerrado pela câmera');
      } catch (err) {
        if (abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`câmera ${printerId}: ${msg}`);
        if (fonte.online) {
          fonte.online = false;
          this.emit('offline', printerId, msg);
        }
        fonte.abort = null;
        if (fonte.assinantes.size > 0) this.agendarReconexao(printerId, fonte);
      }
    })();
  }

  private agendarReconexao(printerId: string, fonte: Fonte): void {
    if (fonte.reconectarEm) return;
    const espera = Math.min(2_000 * 2 ** fonte.tentativas, 30_000);
    fonte.tentativas = Math.min(fonte.tentativas + 1, 8);
    fonte.reconectarEm = setTimeout(() => {
      fonte.reconectarEm = null;
      if (fonte.assinantes.size > 0) this.conectar(printerId, fonte);
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
