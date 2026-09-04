import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { lookupComMdns } from '../lib/mdns.js';
import type { EstadoKlippy, PrinterConfig } from '@3dfarm/shared';

export type { EstadoKlippy };

/** Objetos que assinamos no Klipper. É daqui que sai tudo que a UI mostra. */
export const OBJETOS_ASSINADOS: Record<string, null> = {
  /*
   * `webhooks` é o único objeto que carrega o diagnóstico: `state` e o
   * `state_message` onde o Klipper escreve por que parou. Sem ele, um shutdown
   * de MCU chega como um estado sem motivo.
   */
  webhooks: null,
  print_stats: null,
  display_status: null,
  extruder: null,
  heater_bed: null,
  toolhead: null,
  virtual_sdcard: null,
  gcode_move: null
};

/** Snapshot cru do Klipper, antes de normalizar. */
export type EstadoBruto = {
  conectado: boolean;
  klippy: EstadoKlippy;
  objetos: Record<string, any>;
  macros: string[];
  /** Falha de transporte: socket, DNS, timeout. Nada a ver com o Klipper. */
  ultimoErro: string | null;
  /** Motivo do Klipper para não estar 'ready'. Null quando está tudo bem. */
  mensagemKlippy: string | null;
};

/**
 * O `state_message` do Klipper vem em várias linhas: a primeira é o motivo, o
 * resto é a instrução genérica de rodar FIRMWARE_RESTART. Só a primeira
 * interessa — a instrução nós mesmos damos, traduzida.
 */
export function motivoDoKlipper(estado: EstadoKlippy, mensagem: unknown): string | null {
  if (estado === 'ready') return null; // aqui o texto é só "Printer is ready"
  const linha = String(mensagem ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return linha ? linha.slice(0, 200) : null;
}

type Pendente = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RPC_TIMEOUT_MS = 10_000;
/*
 * `machine.reboot` e `machine.shutdown` respondem "ok", mas o host começa a
 * cair no mesmo instante: a resposta perde a corrida com frequência. A espera
 * é curta porque o que interessa é dar tempo de o Moonraker *recusar* —
 * recusas (rodando em container, sem sudo) voltam na hora.
 */
const MAQUINA_TIMEOUT_MS = 3_000;

/** Chamada que não voltou a tempo. Distinta de "voltou com erro". */
export class TimeoutRpc extends Error {
  constructor(metodo: string) {
    super(`timeout em ${metodo}`);
    this.name = 'TimeoutRpc';
  }
}

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
    ultimoErro: null,
    mensagemKlippy: null
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

    // `lookup` próprio: nomes .local não resolvem pela libc da imagem
    const ws = new WebSocket(url, { headers, handshakeTimeout: 8_000, lookup: lookupComMdns });
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
      const info = await this.chamar<{ state: EstadoKlippy; state_message?: string }>('printer.info');
      const klippy = info.state ?? 'ready';
      this.definirEstado({ klippy, mensagemKlippy: motivoDoKlipper(klippy, info.state_message) });

      if (klippy !== 'ready') {
        // Com o Klipper parado, subscribe e objects.list respondem erro. O que
        // importava — o motivo — já veio no state_message acima.
        this.emit('log', 'warn', `[${this.id}] Klipper em ${klippy}: ${this.estado.mensagemKlippy ?? 'sem motivo'}`);
        return;
      }

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
      this.definirEstado({ klippy: 'error', ultimoErro: msg });
      this.emit('log', 'warn', `[${this.id}] handshake falhou: ${msg}`);
    }
  }

  // ── JSON-RPC ──────────────────────────────────────────────────────────────

  chamar<T = any>(metodo: string, params?: Record<string, unknown>, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`impressora ${this.id} offline`));
    }
    const id = this.proximoId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', method: metodo, params: params ?? {}, id });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new TimeoutRpc(metodo));
      }, timeoutMs);
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
        this.definirEstado({ klippy: 'ready', ultimoErro: null, mensagemKlippy: null });
        void this.aposConectar();
        break;
      case 'notify_klippy_shutdown':
        // A notificação não traz motivo; o subscribe de `webhooks` costuma
        // trazer, mas não é garantido que chegue — perguntamos direto.
        this.definirEstado({ klippy: 'shutdown' });
        void this.buscarMotivo();
        break;
      case 'notify_klippy_disconnected':
        // O Moonraker perdeu o socket do Klipper: não há a quem perguntar.
        this.definirEstado({ klippy: 'disconnected', mensagemKlippy: null });
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

    const patch: Partial<EstadoBruto> = { objetos };
    // `webhooks` é a fonte mais rápida e completa: chega junto com a mudança
    // e já traz o motivo, sem uma volta extra de RPC.
    const wh = parcial.webhooks;
    if (wh && typeof wh.state === 'string') {
      const klippy = wh.state as EstadoKlippy;
      patch.klippy = klippy;
      patch.mensagemKlippy = motivoDoKlipper(klippy, wh.state_message);
    }
    this.definirEstado(patch);
  }

  /** Pergunta ao Moonraker por que o Klipper parou. Silencioso se falhar. */
  private async buscarMotivo(): Promise<void> {
    try {
      const info = await this.chamar<{ state: EstadoKlippy; state_message?: string }>('printer.info');
      const klippy = info.state ?? this.estado.klippy;
      this.definirEstado({ klippy, mensagemKlippy: motivoDoKlipper(klippy, info.state_message) });
    } catch {
      // sem motivo é melhor que motivo errado: o alerta sai com o texto genérico
    }
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

  /**
   * Reinicia o host (o Raspberry, não o Klipper).
   *
   * É um comando do Moonraker, não do Klipper: continua funcionando com o
   * firmware caído — que é justamente quando alguém quer usá-lo.
   */
  reiniciarMaquina() {
    return this.comandoDeMaquina('machine.reboot');
  }

  /** Desliga o host. Só volta com alguém apertando o botão na máquina. */
  desligarMaquina() {
    return this.comandoDeMaquina('machine.shutdown');
  }

  /**
   * O silêncio aqui é sucesso: o host caiu antes de responder. O que não pode
   * passar por sucesso é uma recusa explícita — o Moonraker nega estes dois
   * quando roda dentro de um container ou sem permissão de sudo, e sem isto a
   * tela diria "desligando" com a máquina intacta.
   */
  private async comandoDeMaquina(metodo: string): Promise<void> {
    try {
      await this.chamar(metodo, {}, MAQUINA_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof TimeoutRpc) return;
      throw err;
    }
  }
}
