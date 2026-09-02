import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Printer } from '@3dfarm/shared';

// escolherImpressora consulta a ordem cadastrada da fazenda
const ordemFake = vi.hoisted(() => ({ ids: ['P01', 'P02', 'P03'] }));
vi.mock('../src/services/printers.repo.js', () => ({
  listarPrinters: () => ordemFake.ids.map((id, i) => ({ id, nome: id, ordem: i })),
  acharPrinter: (id: string) => ({ id, nome: id })
}));
vi.mock('../src/db/index.js', () => ({ getDb: () => ({}) }));
vi.mock('../src/services/farm.js', () => ({ farm: { printers: () => [], http: () => null, clienteVivo: () => null } }));
vi.mock('../src/services/files.js', () => ({ listarArquivos: async () => [], invalidarCache: () => {} }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const { escolherImpressora } = await import('../src/services/queue.js');

function printer(id: string, patch: Partial<Printer> = {}): Printer {
  return {
    id,
    nome: id,
    job: '',
    pct: 0,
    restante: '—',
    camada: '—',
    status: 'ociosa',
    online: true,
    temTaCamera: false,
    temperaturas: [],
    posicao: null,
    macros: [],
    ...patch
  };
}

const job = (destino: string | null) => ({
  id: 1,
  arquivo: 'a.gcode',
  destino,
  destinoNome: destino ?? 'próxima livre',
  tempo: '1h 00m',
  status: 'pendente' as const,
  printerId: null,
  criadoEm: new Date().toISOString(),
  erro: null
});

describe('escolherImpressora', () => {
  beforeEach(() => {
    ordemFake.ids = ['P01', 'P02', 'P03'];
  });

  it('respeita o destino fixo quando ele está livre', () => {
    const printers = [printer('P01'), printer('P02')];
    expect(escolherImpressora(job('P02'), printers, new Set())?.id).toBe('P02');
  });

  it('não desvia para outra máquina quando o destino fixo está ocupado', () => {
    const printers = [printer('P01'), printer('P02', { status: 'imprimindo' })];
    expect(escolherImpressora(job('P02'), printers, new Set())).toBeNull();
  });

  it('"próxima livre" segue a ordem cadastrada da fazenda, não a ordem do array', () => {
    // P01 ocupada, então deve sair P02 mesmo com P03 aparecendo antes na lista
    const printers = [printer('P03'), printer('P02'), printer('P01', { status: 'imprimindo' })];
    expect(escolherImpressora(job(null), printers, new Set())?.id).toBe('P02');
  });

  it('pula máquinas offline', () => {
    const printers = [printer('P01', { online: false }), printer('P02')];
    expect(escolherImpressora(job(null), printers, new Set())?.id).toBe('P02');
  });

  it('pula máquinas já reservadas neste mesmo tick', () => {
    const printers = [printer('P01'), printer('P02')];
    expect(escolherImpressora(job(null), printers, new Set(['P01']))?.id).toBe('P02');
  });

  it('devolve null quando a fazenda inteira está ocupada', () => {
    const printers = [printer('P01', { status: 'imprimindo' }), printer('P02', { status: 'pausada' })];
    expect(escolherImpressora(job(null), printers, new Set())).toBeNull();
  });

  it('não despacha para máquina em atenção', () => {
    const printers = [printer('P01', { status: 'atenção' }), printer('P02')];
    expect(escolherImpressora(job(null), printers, new Set())?.id).toBe('P02');
  });
});
