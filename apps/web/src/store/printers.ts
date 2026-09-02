import { create } from 'zustand';
import type { Alert, BackupCard, BackupResumo, Printer, QueueJob, Status, StreamEvent } from '@3dfarm/shared';

/**
 * Espelho local do estado da fazenda, alimentado pelo SSE.
 *
 * Fora daqui, react-query cuida dos recursos que não são tempo real
 * (arquivos, snapshots de backup, usuários).
 */

type Override = { status: Status; ate: number };

/**
 * Pausar/continuar/cancelar levam alguns segundos para aparecer no Moonraker.
 * Até lá mostramos o status otimista; quando o servidor confirma — ou quando o
 * prazo estoura — o override cai e a verdade volta a ser a do Klipper.
 */
const TTL_OVERRIDE_MS = 12_000;

type Estado = {
  printers: Printer[];
  overrides: Record<string, Override>;
  fila: QueueJob[];
  alertas: Alert[];
  backupResumo: BackupResumo | null;
  backupCards: BackupCard[];
  conectado: boolean;

  aplicarEvento: (e: StreamEvent) => void;
  definirPrinters: (p: Printer[]) => void;
  definirFila: (f: QueueJob[]) => void;
  definirAlertas: (a: Alert[]) => void;
  definirConectado: (c: boolean) => void;
  otimista: (id: string, status: Status) => void;
};

export const usePrinters = create<Estado>((set) => ({
  printers: [],
  overrides: {},
  fila: [],
  alertas: [],
  backupResumo: null,
  backupCards: [],
  conectado: false,

  aplicarEvento: (e) =>
    set((s) => {
      switch (e.tipo) {
        case 'printers':
          return { printers: e.printers, overrides: limpar(s.overrides, e.printers) };
        case 'printer': {
          const printers = s.printers.some((p) => p.id === e.printer.id)
            ? s.printers.map((p) => (p.id === e.printer.id ? e.printer : p))
            : [...s.printers, e.printer];
          return { printers, overrides: limpar(s.overrides, printers) };
        }
        case 'fila':
          return { fila: e.fila };
        case 'alerta': {
          const sem = s.alertas.filter((a) => a.id !== e.alerta.id);
          // resolvido some da lista de abertos; novo entra no topo
          return { alertas: e.alerta.resolvidoEm ? sem : [e.alerta, ...sem] };
        }
        case 'backup':
          return { backupResumo: e.resumo, backupCards: e.cards };
        default:
          return {};
      }
    }),

  definirPrinters: (printers) => set((s) => ({ printers, overrides: limpar(s.overrides, printers) })),
  definirFila: (fila) => set({ fila }),
  definirAlertas: (alertas) => set({ alertas }),
  definirConectado: (conectado) => set({ conectado }),

  otimista: (id, status) =>
    set((s) => ({ overrides: { ...s.overrides, [id]: { status, ate: Date.now() + TTL_OVERRIDE_MS } } }))
}));

/** Descarta overrides que o servidor já confirmou ou que expiraram. */
function limpar(overrides: Record<string, Override>, printers: Printer[]): Record<string, Override> {
  const agora = Date.now();
  const out: Record<string, Override> = {};
  for (const [id, o] of Object.entries(overrides)) {
    if (o.ate < agora) continue;
    const real = printers.find((p) => p.id === id);
    if (real && real.status === o.status) continue; // servidor confirmou
    out[id] = o;
  }
  return out;
}

/** Printers com o status otimista já aplicado — é o que as telas consomem. */
export function usePrintersVisiveis(): Printer[] {
  const printers = usePrinters((s) => s.printers);
  const overrides = usePrinters((s) => s.overrides);
  if (Object.keys(overrides).length === 0) return printers;

  return printers.map((p) => {
    const o = overrides[p.id];
    if (!o || o.ate < Date.now()) return p;
    return {
      ...p,
      status: o.status,
      pct: o.status === 'cancelada' || o.status === 'ociosa' ? 0 : p.pct,
      // sem estimativa enquanto não voltar a imprimir; o rótulo sai do status
      restanteSegundos: o.status === 'imprimindo' ? p.restanteSegundos : null
    };
  });
}

export function usePrinter(id: string | null): Printer | null {
  const printers = usePrintersVisiveis();
  return id ? (printers.find((p) => p.id === id) ?? null) : null;
}
