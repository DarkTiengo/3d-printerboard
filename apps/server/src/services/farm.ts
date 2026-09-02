import { EventEmitter } from 'node:events';
import type { Printer, PrinterConfig } from '@3dfarm/shared';
import { MoonrakerClient } from '../moonraker/client.js';
import { MoonrakerHttp } from '../moonraker/http.js';
import { normalizar } from '../moonraker/normalize.js';
import { listarPrinters } from './printers.repo.js';
import { logger } from '../lib/logger.js';

/**
 * Registro vivo da fazenda: um MoonrakerClient por impressora cadastrada,
 * o snapshot normalizado de cada uma e um único ponto de emissão para o SSE.
 *
 * Emite 'printer' (Printer) sempre que algo muda, com coalescência de ~250 ms:
 * o Klipper manda dezenas de updates de temperatura por segundo e não faz
 * sentido acordar todos os navegadores para cada um.
 */
export class Farm extends EventEmitter {
  private clientes = new Map<string, MoonrakerClient>();
  private snapshots = new Map<string, Printer>();
  private pendentes = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;

  /** Substituíveis pelo simulador em MOCK_PRINTERS. */
  criarCliente: (cfg: PrinterConfig) => MoonrakerClient = (cfg) => new MoonrakerClient(cfg);
  criarHttp: (cfg: PrinterConfig) => MoonrakerHttp = (cfg) => new MoonrakerHttp(cfg);

  iniciar(): void {
    this.sincronizar();
  }

  parar(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const c of this.clientes.values()) c.parar();
    this.clientes.clear();
    this.snapshots.clear();
  }

  /** Reconcilia os clientes vivos com o que está no banco. */
  sincronizar(): void {
    const configs = listarPrinters();
    const idsDesejados = new Set(configs.map((c) => c.id));

    for (const [id, cliente] of this.clientes) {
      if (!idsDesejados.has(id)) {
        cliente.parar();
        this.clientes.delete(id);
        this.snapshots.delete(id);
        this.emit('removida', id);
      }
    }

    for (const cfg of configs) {
      const existente = this.clientes.get(cfg.id);
      if (existente) {
        existente.atualizarConfig(cfg);
        this.marcar(cfg.id);
        continue;
      }
      const cliente = this.criarCliente(cfg);
      cliente.on('estado', () => this.marcar(cfg.id));
      cliente.on('evento', (metodo: string, params: unknown) => this.emit('evento', cfg.id, metodo, params));
      cliente.on('log', (nivel: 'info' | 'warn' | 'error', msg: string) => logger[nivel](msg));
      this.clientes.set(cfg.id, cliente);
      cliente.iniciar();
      this.marcar(cfg.id);
    }
  }

  cliente(id: string): MoonrakerClient | null {
    return this.clientes.get(id) ?? null;
  }

  /** Precisa existir e estar conectada — quem chama devolve 503 quando null. */
  clienteVivo(id: string): MoonrakerClient | null {
    const c = this.clientes.get(id);
    return c?.getEstado().conectado ? c : null;
  }

  http(id: string): MoonrakerHttp | null {
    const c = this.clientes.get(id);
    return c ? this.criarHttp(c.config) : null;
  }

  clientes_(): MoonrakerClient[] {
    return [...this.clientes.values()];
  }

  printer(id: string): Printer | null {
    return this.snapshots.get(id) ?? null;
  }

  printers(): Printer[] {
    const ordem = listarPrinters().map((c) => c.id);
    return ordem.map((id) => this.snapshots.get(id)).filter((p): p is Printer => !!p);
  }

  // ── coalescência ──────────────────────────────────────────────────────────

  private marcar(id: string): void {
    this.pendentes.add(id);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.descarregar();
    }, 250);
  }

  private descarregar(): void {
    const ids = [...this.pendentes];
    this.pendentes.clear();
    for (const id of ids) {
      const cliente = this.clientes.get(id);
      if (!cliente) continue;
      const printer = normalizar(cliente.config, cliente.getEstado());
      const anterior = this.snapshots.get(id);
      this.snapshots.set(id, printer);
      if (!anterior || JSON.stringify(anterior) !== JSON.stringify(printer)) {
        this.emit('printer', printer, anterior ?? null);
      }
    }
  }
}

export const farm = new Farm();
