import type { PrinterConfig } from '@3dfarm/shared';
import { MoonrakerClient, type EstadoBruto } from './client.js';
import { MoonrakerHttp, type ArquivoMoonraker, type MetadadosGcode } from './http.js';
import { criarPrinter, listarPrinters } from '../services/printers.repo.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Moonraker falso, com as oito impressoras do design (design/README.md § Estado
 * e o array `base` do .dc.html). Serve para percorrer as seis telas sem hardware
 * e é o que os testes usam.
 *
 * Substitui o MoonrakerClient inteiro em vez de simular o protocolo por WebSocket:
 * o que queremos exercitar é a UI e as regras de negócio, não o transporte.
 */

type Semente = {
  id: string;
  nome: string;
  job: string;
  pct: number;
  camadaAtual: number;
  camadaTotal: number;
  estado: 'printing' | 'paused' | 'standby' | 'error';
};

export const SEMENTES: Semente[] = [
  { id: 'P01', nome: 'Ender 3 V2 — A', job: 'suporte_camera_v3.gcode', pct: 72, camadaAtual: 84, camadaTotal: 210, estado: 'printing' },
  { id: 'P02', nome: 'Ender 3 V2 — B', job: 'clipe_cabo_x12.gcode', pct: 31, camadaAtual: 61, camadaTotal: 196, estado: 'printing' },
  { id: 'P03', nome: 'Bambu P1S', job: 'engrenagem_z_final.gcode', pct: 94, camadaAtual: 188, camadaTotal: 200, estado: 'printing' },
  { id: 'P04', nome: 'Prusa MK4', job: '', pct: 0, camadaAtual: 0, camadaTotal: 142, estado: 'standby' },
  { id: 'P05', nome: 'Voron 0.2', job: 'ventoinha_duto.gcode', pct: 48, camadaAtual: 96, camadaTotal: 204, estado: 'printing' },
  { id: 'P06', nome: 'Ender 5 Plus', job: 'bandeja_organizador.gcode', pct: 12, camadaAtual: 18, camadaTotal: 150, estado: 'error' },
  { id: 'P07', nome: 'Sovol SV06', job: 'pé_antivibração.gcode', pct: 66, camadaAtual: 58, camadaTotal: 88, estado: 'printing' },
  { id: 'P08', nome: 'Bambu A1 mini', job: 'chaveiro_lote_24.gcode', pct: 0, camadaAtual: 24, camadaTotal: 120, estado: 'paused' }
];

const MACROS = ['HOME_ALL', 'BED_MESH_CALIBRATE', 'PURGE_LINE', 'PARK_HEAD', 'LOAD_FILAMENT', 'UNLOAD_FILAMENT'];

const ARQUIVOS_FALSOS = [
  { nome: 'suporte_camera_v3.gcode', tempo: 15000, material: 'PLA', altura: 0.2, filamento: 28000 },
  { nome: 'clipe_cabo_x12.gcode', tempo: 15900, material: 'PETG', altura: 0.24, filamento: 17600 },
  { nome: 'engrenagem_z_final.gcode', tempo: 9600, material: 'PETG', altura: 0.16, filamento: 13400 },
  { nome: 'caixa_junction_v2.gcode', tempo: 6900, material: 'PLA', altura: 0.28, filamento: 20200 },
  { nome: 'ventoinha_duto.gcode', tempo: 11520, material: 'ABS', altura: 0.2, filamento: 15600 },
  { nome: 'pé_antivibração.gcode', tempo: 4800, material: 'TPU', altura: 0.2, filamento: 7200 },
  { nome: 'chaveiro_lote_24.gcode', tempo: 21900, material: 'PLA', altura: 0.2, filamento: 35800 }
];

class MockClient extends MoonrakerClient {
  private semente: Semente;
  private timer: NodeJS.Timeout | null = null;
  private progresso: number;
  private decorrido: number;
  private bico = { atual: 24, alvo: 0 };
  private mesa = { atual: 23, alvo: 0 };
  private pos = { x: 110, y: 110, z: 8.4 };

  constructor(cfg: PrinterConfig, semente: Semente) {
    super(cfg);
    this.semente = { ...semente };
    this.progresso = semente.pct / 100;
    // tempo decorrido coerente com o progresso, senão o ETA sai absurdo
    this.decorrido = this.progresso > 0 ? this.progresso * 4 * 3600 : 0;
    if (semente.estado === 'printing' || semente.estado === 'paused' || semente.estado === 'error') {
      this.bico = { atual: 210.4, alvo: 210 };
      this.mesa = { atual: 59.8, alvo: 60 };
    }
  }

  override iniciar(): void {
    this.emitir();
    this.timer = setInterval(() => this.tick(), 1_000);
    this.timer.unref();
  }

  override parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  override getEstado(): EstadoBruto {
    return {
      conectado: true,
      klippy: 'ready',
      macros: MACROS,
      ultimoErro: null,
      objetos: {
        print_stats: {
          state: this.semente.estado,
          filename: this.semente.job,
          print_duration: this.decorrido,
          info: { current_layer: this.semente.camadaAtual, total_layer: this.semente.camadaTotal }
        },
        display_status: { progress: this.progresso },
        virtual_sdcard: { progress: this.progresso },
        extruder: { temperature: this.bico.atual, target: this.bico.alvo },
        heater_bed: { temperature: this.mesa.atual, target: this.mesa.alvo },
        toolhead: { position: [this.pos.x, this.pos.y, this.pos.z, 0] },
        gcode_move: { gcode_position: [this.pos.x, this.pos.y, this.pos.z, 0] }
      }
    };
  }

  private tick(): void {
    if (this.semente.estado === 'printing') {
      // 4 h de impressão em tempo real seria inútil para testar; 40× é o suficiente
      this.decorrido += 40;
      this.progresso = Math.min(1, this.progresso + 40 / (4 * 3600));
      this.semente.camadaAtual = Math.min(
        this.semente.camadaTotal,
        Math.round(this.progresso * this.semente.camadaTotal)
      );
      this.pos.x = 110 + Math.sin(Date.now() / 900) * 60;
      this.pos.y = 110 + Math.cos(Date.now() / 1100) * 60;
      this.pos.z = Number((this.semente.camadaAtual * 0.2).toFixed(2));
      this.bico.atual = 210 + Math.sin(Date.now() / 3000) * 0.6;
      this.mesa.atual = 60 + Math.sin(Date.now() / 5000) * 0.4;

      if (this.progresso >= 1) {
        this.semente.estado = 'standby';
        this.progresso = 0;
        this.decorrido = 0;
        this.bico.alvo = 0;
        this.mesa.alvo = 0;
      }
    }
    this.emitir();
  }

  private emitir(): void {
    this.emit('estado', this.getEstado());
  }

  // ── comandos ──────────────────────────────────────────────────────────────

  override async pausar(): Promise<void> {
    this.semente.estado = 'paused';
    this.emitir();
  }
  override async continuar(): Promise<void> {
    this.semente.estado = 'printing';
    this.emitir();
  }
  override async cancelar(): Promise<void> {
    this.semente.estado = 'standby';
    this.semente.job = '';
    this.progresso = 0;
    this.decorrido = 0;
    this.bico.alvo = 0;
    this.mesa.alvo = 0;
    this.emitir();
  }
  override async paradaEmergencia(): Promise<void> {
    this.semente.estado = 'error';
    logger.warn(`[mock ${this.id}] PARADA DE EMERGÊNCIA`);
    this.emitir();
  }
  override async gcode(script: string): Promise<void> {
    logger.info(`[mock ${this.id}] gcode: ${script.replace(/\n/g, ' | ')}`);
    const jog = /G1 ([XYZ])(-?[\d.]+)/.exec(script);
    if (jog) {
      const eixo = jog[1].toLowerCase() as 'x' | 'y' | 'z';
      this.pos[eixo] = Number((this.pos[eixo] + Number(jog[2])).toFixed(2));
    }
    if (script.includes('G28')) this.pos = { x: 0, y: 0, z: 0 };
    this.emitir();
  }
  override async iniciarImpressao(filename: string): Promise<void> {
    this.semente.job = filename;
    this.semente.estado = 'printing';
    this.progresso = 0;
    this.decorrido = 0;
    this.semente.camadaAtual = 0;
    this.bico = { atual: 180, alvo: 210 };
    this.mesa = { atual: 45, alvo: 60 };
    logger.info(`[mock ${this.id}] iniciando ${filename}`);
    this.emitir();
  }

  override async chamar<T = any>(metodo: string): Promise<T> {
    logger.debug(`[mock ${this.id}] chamada ignorada: ${metodo}`);
    return {} as T;
  }
}

/** Cadastra as oito impressoras do design se o banco estiver vazio. */
export function semearImpressoras(): void {
  if (listarPrinters().length > 0) return;
  for (const [i, s] of SEMENTES.entries()) {
    criarPrinter({
      id: s.id,
      nome: s.nome,
      moonrakerUrl: `http://mock-${s.id.toLowerCase()}.local:7125`,
      apiKey: null,
      // a câmera falsa é servida por este mesmo processo, então o proxy MJPEG
      // roda pelo caminho real; `fase` desencontra a animação entre os tiles
      cameraUrl: `http://127.0.0.1:${config.port}/api/mock-camera?fase=${i}`,
      backupEnabled: true
    });
  }
  logger.info('MOCK_PRINTERS: 8 impressoras do design cadastradas');
}

export function criarClienteMock(cfg: PrinterConfig): MoonrakerClient {
  const semente = SEMENTES.find((s) => s.id === cfg.id) ?? {
    ...SEMENTES[3],
    id: cfg.id,
    nome: cfg.nome
  };
  return new MockClient(cfg, { ...semente, nome: cfg.nome });
}

/**
 * Lado HTTP do simulador. Sem isso as telas de Arquivos e Backups ficariam
 * vazias no mock — elas não passam pelo WebSocket, e é justamente Backups que
 * queremos poder exercitar sem hardware.
 */
class MockHttp extends MoonrakerHttp {
  constructor(private cfgMock: PrinterConfig) {
    super(cfgMock);
  }

  override async testar() {
    return { ok: true as const, versao: 'v0.12.0-mock', hostname: `mock-${this.cfgMock.id.toLowerCase()}` };
  }

  override async listarArquivos(root: 'gcodes' | 'config' | 'logs'): Promise<ArquivoMoonraker[]> {
    const agora = Math.floor(Date.now() / 1000);
    if (root === 'config') {
      return [
        { path: 'printer.cfg', modified: agora - 86400, size: 8_412 },
        { path: 'moonraker.conf', modified: agora - 86400 * 6, size: 1_204 },
        { path: 'macros.cfg', modified: agora - 3600 * 5, size: 3_980 },
        { path: 'mainsail.cfg', modified: agora - 86400 * 30, size: 2_110 }
      ];
    }
    if (root === 'logs') return [];
    return ARQUIVOS_FALSOS.map((a, i) => ({
      path: a.nome,
      modified: agora - i * 3600,
      size: Math.round(a.filamento * 6.2)
    }));
  }

  override async metadados(filename: string): Promise<MetadadosGcode> {
    const nome = filename.split('/').pop() ?? filename;
    const a = ARQUIVOS_FALSOS.find((x) => x.nome === nome);
    if (!a) return {};
    return {
      filename: a.nome,
      estimated_time: a.tempo,
      filament_total: a.filamento,
      filament_type: a.material,
      layer_height: a.altura,
      slicer: 'PrusaSlicer',
      thumbnails: []
    };
  }

  override async baixar(root: string, caminho: string): Promise<Buffer> {
    if (root === 'config') {
      return Buffer.from(
        `# ${caminho} — gerado pelo simulador de ${this.cfgMock.nome}\n` +
          `[printer]\nkinematics: cartesian\nmax_velocity: 300\n`,
        'utf8'
      );
    }
    // G-code falso, com tamanho plausível e conteúdo determinístico por arquivo
    const a = ARQUIVOS_FALSOS.find((x) => x.nome === caminho.split('/').pop());
    const linhas = Math.max(200, Math.round((a?.filamento ?? 10_000) / 40));
    const corpo = Array.from({ length: linhas }, (_, i) => `G1 X${i % 200} Y${(i * 7) % 200} E${(i * 0.01).toFixed(3)}`);
    return Buffer.from(`; ${caminho}\n${corpo.join('\n')}\n`, 'utf8');
  }

  override async thumbnail(): Promise<Buffer> {
    throw new Error('simulador não gera miniatura');
  }

  override async listarNamespaces() {
    return { namespaces: ['mainsail', 'fluidd', 'moonraker', 'gcode_metadata'] };
  }

  override async itemBanco(namespace: string) {
    return {
      namespace,
      value: { simulador: true, impressora: this.cfgMock.id, perfis: ['PLA 0.20', 'PETG 0.24', 'ABS 0.20'] }
    };
  }

  override async infoSistema() {
    return {
      system_info: {
        cpu_info: { cpu_count: 4, model: 'ARMv8 (simulado)' },
        distribution: { name: 'Debian GNU/Linux 12 (bookworm)' }
      }
    };
  }

  override async statusAtualizacao() {
    return { version_info: { klipper: { version: 'v0.12.0-mock' }, moonraker: { version: 'v0.9.3-mock' } } };
  }

  override async enviar(root: string, caminho: string): Promise<void> {
    logger.info(`[mock ${this.cfgMock.id}] recebeu ${root}/${caminho}`);
  }
}

export function criarHttpMock(cfg: PrinterConfig): MoonrakerHttp {
  return new MockHttp(cfg);
}
