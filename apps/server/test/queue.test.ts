import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Printer } from '@3dfarm/shared';

// escolherImpressora consulta a ordem cadastrada da fazenda
const ordemFake = vi.hoisted(() => ({ ids: ['P01', 'P02', 'P03'] }));
vi.mock('../src/services/printers.repo.js', () => ({
  listarPrinters: () => ordemFake.ids.map((id, i) => ({ id, nome: id, ordem: i })),
  acharPrinter: (id: string) => ({ id, nome: id })
}));
const fazenda = vi.hoisted(() => ({
  printers: new Map<string, any>(),
  iniciadas: [] as { printer: string; arquivo: string }[]
}));
vi.mock('../src/services/farm.js', () => ({
  farm: {
    printers: () => [...fazenda.printers.values()],
    printer: (id: string) => fazenda.printers.get(id) ?? null,
    http: () => ({ listarArquivos: async () => [{ path: 'a.gcode', modified: 0, size: 1 }] }),
    clienteVivo: (id: string) =>
      fazenda.printers.get(id)?.online
        ? {
            iniciarImpressao: async (arquivo: string) => {
              fazenda.iniciadas.push({ printer: id, arquivo });
            }
          }
        : null
  }
}));
vi.mock('../src/services/files.js', () => ({ listarArquivos: async () => [], invalidarCache: () => {} }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

// a fila desta suíte é uma tabela em memória, para exercitar as guardas de despacho
const banco = vi.hoisted(() => ({ jobs: new Map<number, any>() }));
vi.mock('../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (id: number) => banco.jobs.get(id),
      run: (...args: any[]) => {
        const id = args[args.length - 1];
        const job = banco.jobs.get(id);
        if (!job) return { changes: 0 };
        if (sql.includes("'atribuido'")) {
          job.status = 'atribuido';
          job.printer_id = args[0];
        } else if (sql.includes("'imprimindo'")) job.status = 'imprimindo';
        else if (sql.includes("'falhou'")) {
          job.status = 'falhou';
          job.erro = args[0];
        }
        return { changes: 1 };
      },
      all: () => [...banco.jobs.values()]
    })
  })
}));

const { escolherImpressora, despacharJob, filaDaImpressora } = await import('../src/services/queue.js');

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
    pecaAtual: null,
    temPecas: false,
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

// ── autorização: nada começa sozinho ────────────────────────────────────────

function cadastrarNaFazenda(id: string, status: Printer['status'], online = true) {
  fazenda.printers.set(id, { ...printer(id, { status, online }) });
}

function enfileirarNoBanco(id: number, arquivo: string, destino: string | null) {
  banco.jobs.set(id, {
    id,
    filename: arquivo,
    target_printer_id: destino,
    status: 'pendente',
    printer_id: null,
    tempo: '1h 00m',
    erro: null,
    created_at: '2026-09-02 12:00:00'
  });
}

describe('despacharJob — o único caminho que dá partida', () => {
  beforeEach(() => {
    banco.jobs.clear();
    fazenda.printers.clear();
    fazenda.iniciadas = [];
  });

  it('inicia quando a impressora está ociosa e online', async () => {
    cadastrarNaFazenda('P01', 'ociosa');
    enfileirarNoBanco(1, 'a.gcode', 'P01');

    await despacharJob(1, 'P01');

    expect(fazenda.iniciadas).toEqual([{ printer: 'P01', arquivo: 'a.gcode' }]);
    expect(banco.jobs.get(1).status).toBe('imprimindo');
  });

  it('recusa quando a impressora ainda está imprimindo', async () => {
    cadastrarNaFazenda('P01', 'imprimindo');
    enfileirarNoBanco(1, 'a.gcode', 'P01');

    await expect(despacharJob(1, 'P01')).rejects.toThrow(/não está ociosa/);
    expect(fazenda.iniciadas).toEqual([]);
  });

  it('recusa quando a máquina está pausada — pausada não é ociosa', async () => {
    cadastrarNaFazenda('P01', 'pausada');
    enfileirarNoBanco(1, 'a.gcode', 'P01');
    await expect(despacharJob(1, 'P01')).rejects.toThrow(/não está ociosa/);
  });

  it('recusa impressora offline', async () => {
    cadastrarNaFazenda('P01', 'ociosa', false);
    enfileirarNoBanco(1, 'a.gcode', 'P01');
    await expect(despacharJob(1, 'P01')).rejects.toThrow(/offline/);
  });

  it('recusa mandar para uma máquina diferente da endereçada', async () => {
    cadastrarNaFazenda('P02', 'ociosa');
    enfileirarNoBanco(1, 'a.gcode', 'P01');
    await expect(despacharJob(1, 'P02')).rejects.toThrow(/outra impressora/);
  });

  it('aceita qualquer máquina quando o trabalho não tem destino', async () => {
    cadastrarNaFazenda('P05', 'ociosa');
    enfileirarNoBanco(1, 'a.gcode', null);
    await despacharJob(1, 'P05');
    expect(fazenda.iniciadas).toEqual([{ printer: 'P05', arquivo: 'a.gcode' }]);
  });

  it('não inicia duas vezes o mesmo trabalho', async () => {
    cadastrarNaFazenda('P01', 'ociosa');
    enfileirarNoBanco(1, 'a.gcode', 'P01');
    await despacharJob(1, 'P01');
    await expect(despacharJob(1, 'P01')).rejects.toThrow(/já saiu da fila/);
  });
});

describe('filaDaImpressora', () => {
  beforeEach(() => banco.jobs.clear());

  it('põe os endereçados a ela na frente dos sem destino', () => {
    enfileirarNoBanco(1, 'livre.gcode', null);
    enfileirarNoBanco(2, 'minha.gcode', 'P01');

    expect(filaDaImpressora('P01').map((j) => j.arquivo)).toEqual(['minha.gcode', 'livre.gcode']);
  });

  it('não mostra o que é de outra máquina', () => {
    enfileirarNoBanco(1, 'de-outra.gcode', 'P02');
    expect(filaDaImpressora('P01')).toEqual([]);
  });
});
