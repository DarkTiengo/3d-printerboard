import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { PrinterConfig } from '@3dfarm/shared';

/** Objetos que assinamos no Klipper. É daqui que sai tudo que a UI mostra. */
export const OBJETOS_ASSINADOS: Record<string, null> = {
  print_stats: null,
  display_status: null,
  extruder: null,
  heater_bed: null,
  toolhead: null,
  virtual_sdcard: null,
  gcode_move: null
};

export type EstadoKlippy = 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected';

/** Snapshot cru do Klipper, antes de normalizar. */
export type EstadoBruto = {
  conectado: boolean;
  klippy: EstadoKlippy;
  objetos: Record<string, any>;
  macros: string[];
  ultimoErro: string | null;
};

type Pendente = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RPC_TIMEOUT_MS = 10_000;

/**
 * Uma conexão persistente com um host Moonraker.
 *
 * Emite:
 *  - 'estado'  (EstadoBruto)  a cada mudança relevante
 *  - 'evento'  (metodo, params) para notificações do Moonraker
 *  - 'log'     (nivel, msg)
 */
export class MoonrakerClient extends EventEmitter {
  readonly id: string;
  private cfg: PrinterConfig;
  private ws: WebSocket | null = null;
  private proximoId = 1;
  private pendentes = new Map<number, Pendente>();
  private tentativas = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private parado = false;

  private estado: EstadoBruto = {
    conectado: false,
    klippy: 'disconnected',
    objetos: {},
    macros: [],
    ultimoErro: null
  };

  constructor(cfg: PrinterConfig) {
    super();
    this.id = cfg.id;
    this.cfg = cfg;
  }

  get config(): PrinterConfig {
    return this.cfg;
  }

  getEstado(): EstadoBruto {
    return this.estado;
  }

  /** Troca a config sem derrubar a conexão, a não ser que a URL tenha mudado. */
  atualizarConfig(cfg: PrinterConfig): void {
    const precisaReconectar = cfg.moonrakerUrl !== this.cfg.moonrakerUrl || cfg.apiKey !== this.cfg.apiKey;
    this.cfg = cfg;
    if (precisaReconectar) {
      this.ws?.close();
    }
  }

  iniciar(): void {
    this.parado = false;
    this.conectar();
  }

  parar(): void {
    this.parado = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.rejeitarPendentes(new Error('cliente parado'));
  }

  // ── conexão ───────────────────────────────────────────────────────────────

  private wsUrl(): string {
    const base = this.cfg.moonrakerUrl.replace(/\/+$/, '');
    const url = new URL(base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/websocket`;
    if (this.cfg.apiKey) url.searchParams.set('token', this.cfg.apiKey);
    return url.toString();
  }

  private conectar(): void {
    if (this.parado) return;
    let url: string;
    try {
      url = this.wsUrl();
    } catch {
      this.definirEstado({ ultimoErro: `URL inválida: ${this.cfg.moonrakerUrl}` });
      return; // URL quebrada não melhora com retry
    }

    const headers: Record<string, string> = {};
    if (this.cfg.apiKey) headers['X-Api-Key'] = this.cfg.apiKey;

    const ws = new WebSocket(url, { headers, handshakeTimeout: 8_000 });
    this.ws = ws;

    ws.on('open', () => {
      this.tentativas = 0;
      this.definirEstado({ conectado: true, ultimoErro: null });
      this.emit('log', 'info', `[${this.id}] conectado a ${this.cfg.moonrakerUrl}`);
      void this.aposConectar();
    });

    ws.on('message', (raw) => this.aoReceber(raw.toString()));

    ws.on('error', (err) => {
      this.definirEstado({ ultimoErro: err.message });
      this.emit('log', 'warn', `[${this.id}] erro no socket: ${err.message}`);
    });

    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
      this.rejeitarPendentes(new Error('conexão fechada'));
      this.definirEstado({ conectado: false, klippy: 'disconnected' });
      this.agendarReconexao();
    });
  }

  private agendarReconexao(): void {
    if (this.parado || this.reconnectTimer) return;
    // backoff exponencial com jitter, teto de 30 s
    const base = Math.min(RECONNECT_MIN_MS * 2 ** this.tentativas, RECONNECT_MAX_MS);
    const espera = base / 2 + Math.random() * (base / 2);
    this.tentativas = Math.min(this.tentativas + 1, 10);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.conectar();
    }, espera);
  }

  private async aposConectar(): Promise<void> {
    try {
      const info = await this.chamar<{ state: EstadoKlippy }>('printer.info');
      this.definirEstado({ klippy: info.state ?? 'ready' });

      const sub = await this.chamar<{ status: Record<string, any> }>('printer.objects.subscribe', {
        objects: OBJETOS_ASSINADOS
      });
      this.mesclarObjetos(sub.status ?? {});

      const lista = await this.chamar<{ objects: string[] }>('printer.objects.list');
      const macros = (lista.objects ?? [])
        .filter((o) => o.startsWith('gcode_macro '))
        .map((o) => o.slice('gcode_macro '.length))
        // macros internas do Klipper começam com _ por convenção
        .filter((m) => !m.startsWith('_'))
        .sort();
      this.definirEstado({ macros });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Klipper em shutdown responde erro no printer.info — não é falha de rede.
      this.definirEstado({ klippy: 'error', ultimoErro: msg });
      this.emit('log', 'warn', `[${this.id}] handshake falhou: ${msg}`);
    }
  }

  // ── JSON-RPC ──────────────────────────────────────────────────────────────

  chamar<T = any>(metodo: string, params?: Record<string, unknown>): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`impressora ${this.id} offline`));
    }
    const id = this.proximoId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', method: metodo, params: params ?? {}, id });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new Error(`timeout em ${metodo}`));
      }, RPC_TIMEOUT_MS);
      this.pendentes.set(id, { resolve, reject, timer });
      ws.send(msg, (err) => {
        if (err) {
          const p = this.pendentes.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pendentes.delete(id);
            reject(err);
          }
        }
      });
    });
  }

  private aoReceber(texto: string): void {
    let msg: any;
    try {
      msg = JSON.parse(texto);
    } catch {
      return;
    }

    if (msg.id != null && this.pendentes.has(msg.id)) {
      const p = this.pendentes.get(msg.id)!;
      clearTimeout(p.timer);
      this.pendentes.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'erro do Moonraker'));
      else p.resolve(msg.result);
      return;
    }

    if (typeof msg.method !== 'string') return;
    this.aoNotificar(msg.method, msg.params);
  }

  private aoNotificar(metodo: string, params: any): void {
    switch (metodo) {
      case 'notify_status_update':
        this.mesclarObjetos(params?.[0] ?? {});
        break;
      case 'notify_klippy_ready':
        this.definirEstado({ klippy: 'ready', ultimoErro: null });
        void this.aposConectar();
        break;
      case 'notify_klippy_shutdown':
        this.definirEstado({ klippy: 'shutdown' });
        break;
      case 'notify_klippy_disconnected':
        this.definirEstado({ klippy: 'disconnected' });
        break;
    }
    this.emit('evento', metodo, params);
  }

  /** O Moonraker manda só o que mudou; o merge é por objeto, um nível. */
  private mesclarObjetos(parcial: Record<string, any>): void {
    const objetos = { ...this.estado.objetos };
    for (const [nome, valor] of Object.entries(parcial)) {
      objetos[nome] = { ...(objetos[nome] ?? {}), ...(valor ?? {}) };
    }
    this.definirEstado({ objetos });
  }

  private definirEstado(patch: Partial<EstadoBruto>): void {
    this.estado = { ...this.estado, ...patch };
    this.emit('estado', this.estado);
  }

  private rejeitarPendentes(erro: Error): void {
    for (const [, p] of this.pendentes) {
      clearTimeout(p.timer);
      p.reject(erro);
    }
    this.pendentes.clear();
  }

  // ── comandos ──────────────────────────────────────────────────────────────

  pausar() {
    return this.chamar('printer.print.pause');
  }
  continuar() {
    return this.chamar('printer.print.resume');
  }
  cancelar() {
    return this.chamar('printer.print.cancel');
  }
  paradaEmergencia() {
    return this.chamar('printer.emergency_stop');
  }
  gcode(script: string) {
    return this.chamar('printer.gcode.script', { script });
  }
  iniciarImpressao(filename: string) {
    return this.chamar('printer.print.start', { filename });
  }
}
