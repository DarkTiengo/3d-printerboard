import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Printer, Status } from '@3dfarm/shared';

/**
 * A agenda é a única camada que decide *quando* um backup pode acontecer.
 * O que estes testes protegem é a regra central: só se copia impressora ociosa.
 */

const mundo = vi.hoisted(() => ({
  printers: new Map<string, any>(),
  configs: new Map<string, any>(),
  ultimoBackup: new Map<string, string | null>(),
  intervalos: new Map<string, number>(),
  copiadas: [] as string[]
}));

vi.mock('../src/services/farm.js', () => ({
  farm: {
    printer: (id: string) => mundo.printers.get(id) ?? null,
    on: () => {}
  }
}));
vi.mock('../src/services/printers.repo.js', () => ({
  acharPrinter: (id: string) => mundo.configs.get(id) ?? null,
  listarPrinters: () => [...mundo.configs.values()]
}));
vi.mock('../src/services/backup.js', () => ({
  rodarBackup: async (id: string) => {
    mundo.copiadas.push(id);
    return { id: 1, printerId: id };
  },
  ultimoBackupUtilEm: (id: string) => mundo.ultimoBackup.get(id) ?? null,
  backupVencido: (ultimo: string | null, horas: number, agora = Date.now()) =>
    !ultimo || agora - new Date(ultimo).getTime() >= horas * 3_600_000,
  intervaloBackupHoras: (id?: string) => (id && mundo.intervalos.has(id) ? mundo.intervalos.get(id)! : 24),
  registrarCiclo: () => {},
  coletarLixo: async () => 0,
  definirVerificadorDePendencia: () => {}
}));
vi.mock('../src/services/alerts.js', () => ({ criarAlerta: async () => null }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const { pedirBackup, podeCopiarAgora, rodarCicloCompleto, estaPendente, idsPendentes, _limparEstado } =
  await import('../src/services/backup-agenda.js');

function cadastrar(id: string, status: Status, opcoes: { online?: boolean; backupEnabled?: boolean } = {}) {
  const printer: Printer = {
    id,
    nome: id,
    job: '',
    pct: 0,
    restante: '—',
    camada: '—',
    status,
    online: opcoes.online ?? true,
    temTaCamera: false,
    temperaturas: [],
    posicao: null,
    macros: []
  };
  mundo.printers.set(id, printer);
  mundo.configs.set(id, { id, nome: id, backupEnabled: opcoes.backupEnabled ?? true, ordem: 0 });
  return printer;
}

beforeEach(() => {
  mundo.printers.clear();
  mundo.configs.clear();
  mundo.ultimoBackup.clear();
  mundo.intervalos.clear();
  mundo.copiadas = [];
  _limparEstado();
});

describe('podeCopiarAgora', () => {
  it('só aceita ociosa e online', () => {
    expect(podeCopiarAgora(cadastrar('P01', 'ociosa'))).toBe(true);
  });

  it.each<Status>(['imprimindo', 'pausada', 'atenção', 'cancelada'])('recusa status %s', (status) => {
    expect(podeCopiarAgora(cadastrar('P01', status))).toBe(false);
  });

  it('recusa ociosa mas offline', () => {
    expect(podeCopiarAgora(cadastrar('P01', 'ociosa', { online: false }))).toBe(false);
  });

  it('recusa nulo', () => {
    expect(podeCopiarAgora(null)).toBe(false);
  });
});

describe('pedirBackup', () => {
  it('inicia quando a impressora está ociosa', () => {
    cadastrar('P01', 'ociosa');
    expect(pedirBackup('P01', 'manual')).toBe('iniciado');
  });

  it('adia quando está imprimindo, e a deixa na fila', () => {
    cadastrar('P01', 'imprimindo');
    expect(pedirBackup('P01', 'ciclo')).toBe('adiado');
    expect(estaPendente('P01')).toBe(true);
  });

  it('adia quando está pausada — pausada não é ociosa', () => {
    cadastrar('P01', 'pausada');
    expect(pedirBackup('P01', 'manual')).toBe('adiado');
  });

  it('adia quando está em atenção: a máquina pode retomar a qualquer momento', () => {
    cadastrar('P01', 'atenção');
    expect(pedirBackup('P01', 'recuperacao')).toBe('adiado');
  });

  it('não enfileira impressora offline — nem adianta esperar', () => {
    cadastrar('P01', 'ociosa', { online: false });
    expect(pedirBackup('P01', 'ciclo')).toBe('offline');
    expect(estaPendente('P01')).toBe(false);
  });

  it('ignora impressora com backup desligado no ciclo automático', () => {
    cadastrar('P01', 'ociosa', { backupEnabled: false });
    expect(pedirBackup('P01', 'ciclo')).toBe('desligado');
  });

  it('mas o pedido manual vale mesmo com o backup diário desligado', () => {
    cadastrar('P01', 'ociosa', { backupEnabled: false });
    expect(pedirBackup('P01', 'manual')).toBe('iniciado');
  });

  it('não duplica a entrada na fila quando pedido duas vezes', () => {
    cadastrar('P01', 'imprimindo');
    pedirBackup('P01', 'ciclo');
    pedirBackup('P01', 'manual');
    expect(idsPendentes()).toEqual(['P01']);
  });

  it('impressora inexistente não vira pendência', () => {
    expect(pedirBackup('P99', 'manual')).toBe('offline');
    expect(idsPendentes()).toEqual([]);
  });
});

describe('rodarCicloCompleto', () => {
  it('separa quem começa agora de quem fica para depois', () => {
    cadastrar('P01', 'ociosa');
    cadastrar('P02', 'imprimindo');
    cadastrar('P03', 'pausada');
    cadastrar('P04', 'ociosa', { online: false });

    const r = rodarCicloCompleto('ciclo');

    expect(r.iniciados).toEqual(['P01']);
    expect(r.adiados.sort()).toEqual(['P02', 'P03']);
    expect(r.offline).toEqual(['P04']);
  });

  it('a fazenda inteira imprimindo não copia ninguém, mas ninguém se perde', () => {
    cadastrar('P01', 'imprimindo');
    cadastrar('P02', 'imprimindo');

    const r = rodarCicloCompleto('ciclo');

    expect(r.iniciados).toEqual([]);
    expect(idsPendentes().sort()).toEqual(['P01', 'P02']);
  });

  it('respeita o intervalo de cada impressora: quem está em dia não é copiada', () => {
    cadastrar('P01', 'ociosa');
    cadastrar('P02', 'ociosa');
    // P02 pede backup semanal e foi copiada ontem; P01 é diária e venceu
    mundo.intervalos.set('P02', 168);
    mundo.ultimoBackup.set('P01', new Date(Date.now() - 30 * 3_600_000).toISOString());
    mundo.ultimoBackup.set('P02', new Date(Date.now() - 24 * 3_600_000).toISOString());

    const r = rodarCicloCompleto('ciclo');

    expect(r.iniciados).toEqual(['P01']);
    expect(r.emDia).toEqual(['P02']);
  });

  it('mas o pedido manual copia todo mundo, esteja em dia ou não', () => {
    cadastrar('P01', 'ociosa');
    mundo.intervalos.set('P01', 168);
    mundo.ultimoBackup.set('P01', new Date().toISOString());

    const r = rodarCicloCompleto('manual');

    expect(r.iniciados).toEqual(['P01']);
    expect(r.emDia).toEqual([]);
  });

  it('pula quem está com o backup desligado', () => {
    cadastrar('P01', 'ociosa');
    cadastrar('P02', 'ociosa', { backupEnabled: false });

    const r = rodarCicloCompleto('ciclo');

    expect(r.iniciados).toEqual(['P01']);
    expect(r.adiados).toEqual([]);
    expect(r.offline).toEqual([]);
  });
});
