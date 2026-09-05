import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { lookupComMdns } from '../lib/mdns.js';
import type { EstadoKlippy, PrinterConfig, TipoSensor } from '@3dfarm/shared';

export type { EstadoKlippy };

/**
 * Objetos que toda impressora tem, e que assinamos sempre. Os sensores extras
 * — câmara, MCU, Raspberry, ventoinha por temperatura — variam de máquina para
 * máquina e entram por descoberta, em `sensoresDaLista`.
 */
export const OBJETOS_BASE: Record<string, null> = {
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

/**
 * Prefixo de objeto do Klipper → o que a tela pode fazer com ele.
 *
 * `heater_generic` é a câmara aquecida e afins: aquece de verdade e aceita
 * alvo. `temperature_fan` também tem alvo, mas por outro comando.
 * `temperature_sensor` é só leitura — é onde moram o MCU e o Raspberry, que
 * é o que se quer vigiar sem poder mexer.
 */
export const PREFIXOS_DE_SENSOR: [prefixo: string, tipo: TipoSensor][] = [
  ['heater_generic ', 'aquecedor'],
  ['temperature_fan ', 'ventoinha'],
  ['temperature_sensor ', 'sensor']
];

/**
 * O objeto que a máquina só tem quando `[exclude_object]` está no printer.cfg.
 * É ele que sabe qual peça da mesa o bico está fazendo agora.
 */
export const OBJETO_PECAS = 'exclude_object';

/** Extrusoras além da primeira: 'extruder1', 'extruder2'. */
const EXTRUSORA_EXTRA = /^extruder\d+$/;

/**
 * O que, de `printer.objects.list`, carrega temperatura e ainda não está na
 * base. Ordenado para a assinatura sair determinística.
 */
export function sensoresDaLista(objetos: string[]): string[] {
  return objetos
    .filter((o) => EXTRUSORA_EXTRA.test(o) || PREFIXOS_DE_SENSOR.some(([p]) => o.startsWith(p)))
    .sort();
}

/**
 * Nome do sensor para o G-code: o que vem depois do prefixo.
 * 'heater_generic chamber' → 'chamber'; 'extruder' continua 'extruder'.
 */
export function nomeDoSensor(objeto: string): string {
  const espaco = objeto.indexOf(' ');
  return espaco < 0 ? objeto : objeto.slice(espaco + 1);
}

/**
 * Caracteres que encerram uma linha de G-code antes da hora: `;` e `#` abrem
 * comentário, `*` abre checksum, e uma quebra de linha vira outro comando. Um
 * nome de peça com qualquer um deles não tem como virar parâmetro — e como o
 * nome vem do fatiador, é melhor recusar do que mandar a linha cortada.
 */
const NOME_IMPOSSIVEL = /[;#*\r\n]/;

/** O nome cabe numa linha de G-code? */
export function nomeDePecaValido(nome: string): boolean {
  return nome.trim() !== '' && !NOME_IMPOSSIVEL.test(nome);
}

/**
 * Nome de peça → valor de parâmetro do `EXCLUDE_OBJECT NAME=`.
 *
 * Sem espaço nem aspas, vai cru: é o mesmo caminho do `HEATER=` e do
 * `TEMPERATURE_FAN=`, que funcionam há tempo. Com espaço não há escolha — o
 * fatiador escreve "Shape-Box id:0 copy 1" e sem aspas o parâmetro terminaria
 * no primeiro espaço, excluindo a peça errada ou nenhuma. Aí vale que o Klipper
 * lê os parâmetros de comando estendido com shlex, que entende as aspas e as
 * remove; a barra invertida escapa aspa dentro de aspa pela mesma regra.
 */
export function paraParametro(nome: string): string {
  if (!/[\s'"]/.test(nome)) return nome;
  return `"${nome.replace(/([\\"])/g, '\\$1')}"`;
}

/** Snapshot cru do Klipper, antes de normalizar. */
export type EstadoBruto = {
  conectado: boolean;
  klippy: EstadoKlippy;
  objetos: Record<string, any>;
  macros: string[];
  /**
   * min_temp/max_temp por objeto de aquecedor, lidos do printer.cfg uma vez no
   * handshake. A chave vem em minúsculas porque é assim que o Klipper devolve
   * as seções em `configfile.settings` — o objeto em si preserva o que a
   * pessoa escreveu.
   */
  limites: Record<string, { min: number | null; max: number | null }>;
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
    limites: {},
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

      /*
       * A lista vem antes da assinatura porque é ela que diz quais sensores
       * esta máquina tem. Uma câmara aquecida e o termistor do MCU são objetos
       * com nome livre no printer.cfg: sem perguntar, não há como assiná-los.
       */
      const lista = await this.chamar<{ objects: string[] }>('printer.objects.list');
      const objetos = lista.objects ?? [];
      const macros = objetos
        .filter((o) => o.startsWith('gcode_macro '))
        .map((o) => o.slice('gcode_macro '.length))
        // macros internas do Klipper começam com _ por convenção
        .filter((m) => !m.startsWith('_'))
        .sort();
      const sensores = sensoresDaLista(objetos);
      this.definirEstado({ macros });

      // exclude_object entra pela mesma porta dos sensores: existe ou não existe
      const pecas = objetos.includes(OBJETO_PECAS) ? { [OBJETO_PECAS]: null } : {};

      const sub = await this.chamar<{ status: Record<string, any> }>('printer.objects.subscribe', {
        objects: { ...OBJETOS_BASE, ...Object.fromEntries(sensores.map((n) => [n, null])), ...pecas }
      });
      /*
       * O subscribe devolve o estado inteiro do que foi assinado, então aqui
       * trocamos o mapa em vez de mesclar: agora que o conjunto é descoberto,
       * um sensor tirado do printer.cfg ficaria para sempre no painel com o
       * último valor lido. As duas linhas são síncronas — ninguém chega a ver
       * o mapa vazio.
       */
      this.definirEstado({ objetos: {} });
      this.mesclarObjetos(sub.status ?? {});

      // depois do subscribe: a faixa de cada aquecedor só muda com a config,
      // e falhar aqui não pode custar as temperaturas em si
      await this.buscarLimites();
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

  /**
   * min_temp/max_temp de cada aquecedor, do printer.cfg.
   *
   * É o que permite recusar "400 °C" antes de mandar, em vez de deixar o
   * Klipper responder com um erro de G-code. Uma leitura só, no handshake: a
   * config não muda sem um restart, que traz outro handshake junto. Silencioso
   * quando falha — sem faixa, o campo de alvo fica sem limite e quem valida
   * volta a ser o Klipper.
   */
  private async buscarLimites(): Promise<void> {
    try {
      const r = await this.chamar<{ status?: { configfile?: { settings?: Record<string, any> } } }>(
        'printer.objects.query',
        { objects: { configfile: ['settings'] } }
      );
      const settings = r.status?.configfile?.settings ?? {};
      const limites: EstadoBruto['limites'] = {};
      for (const [secao, valores] of Object.entries(settings)) {
        const min = (valores as any)?.min_temp;
        const max = (valores as any)?.max_temp;
        if (!Number.isFinite(min) && !Number.isFinite(max)) continue;
        limites[secao] = {
          min: Number.isFinite(min) ? min : null,
          max: Number.isFinite(max) ? max : null
        };
      }
      this.definirEstado({ limites });
    } catch (err) {
      this.emit('log', 'warn', `[${this.id}] sem faixa de temperatura: ${err instanceof Error ? err.message : err}`);
    }
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
   * Alvo de um aquecedor, em °C. 0 desliga.
   *
   * O comando quer o nome dado no printer.cfg, não o objeto inteiro: a câmara
   * é `heater_generic chamber` como objeto e `chamber` como HEATER. Sem aspas
   * de propósito — o Klipper não as remove dos parâmetros, e `HEATER="chamber"`
   * viraria a busca por um aquecedor chamado `"chamber"`.
   */
  definirAlvo(objeto: string, tipo: TipoSensor, alvo: number) {
    const nome = nomeDoSensor(objeto);
    const comando =
      tipo === 'ventoinha'
        ? `SET_TEMPERATURE_FAN_TARGET TEMPERATURE_FAN=${nome} TARGET=${alvo}`
        : `SET_HEATER_TEMPERATURE HEATER=${nome} TARGET=${alvo}`;
    return this.gcode(comando);
  }

  /** Zera todos os alvos de uma vez — a saída rápida quando algo vai mal. */
  desligarAquecedores() {
    return this.gcode('TURN_OFF_HEATERS');
  }

  /**
   * Tira da impressão a peça que está sendo feita agora. As outras seguem.
   *
   * `CURRENT=1` e não `NAME=`: o nome vem do fatiador e costuma ter espaço no
   * meio — "Shape-Box id:0 copy 1" —, e parâmetro de G-code quebra no espaço.
   * Perguntar pela atual evita o problema em vez de tentar escapá-lo.
   */
  excluirPecaAtual() {
    return this.gcode('EXCLUDE_OBJECT CURRENT=1');
  }

  /**
   * Tira da impressão uma peça escolhida no mapa da mesa, que pode não ser a
   * que está sendo feita agora.
   *
   * O nome precisa vir da própria impressora — a rota casa o que o navegador
   * pediu com a lista que o Klipper reportou e passa a string reportada, nunca
   * a digitada. Aqui é o último trecho: transformar esse nome em parâmetro.
   */
  excluirPeca(nome: string) {
    return this.gcode(`EXCLUDE_OBJECT NAME=${paraParametro(nome)}`);
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
