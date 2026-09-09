import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Printer } from '@gridfarm/shared';
import { CODIGOS_DE_ALERTA, CODIGOS_PADRAO } from '@gridfarm/shared';

/**
 * O que a detecção faz com a máquina depois de confirmar a falha.
 *
 * O que motivou o arquivo: parar uma impressão é a única coisa que este
 * projeto faz sozinho, sem alguém clicando. Então as três ações precisam ser
 * exatamente o que foram configuradas a ser — e, principalmente, o alerta
 * precisa sair *mesmo quando a ação falha*: uma máquina que recusou o pause é
 * a hora em que mais se precisa do aviso, e engolir o erro deixaria o espaguete
 * crescendo em silêncio com a foto guardada em lugar nenhum.
 *
 * O quadro que vai no alerta é o mesmo que convenceu o detector, e não um
 * recapturado depois: com a impressão já pausada o bico está estacionado noutro
 * canto, e a foto explicaria menos do que a que motivou a decisão.
 */

const banco = vi.hoisted(() => ({ prefs: new Map<string, any>() }));

vi.mock('../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (...args: any[]) => (sql.includes('FROM deteccao_prefs') ? banco.prefs.get(args[0]) : undefined),
      all: () => [],
      run: (...args: any[]) => {
        if (sql.includes('INSERT INTO deteccao_prefs')) {
          const [printer_id, ligado, limiar, acao] = args;
          banco.prefs.set(printer_id, { printer_id, ligado, limiar, acao });
        }
        return {};
      }
    })
  })
}));

const clientes = vi.hoisted(() => ({
  comandos: [] as string[],
  falhar: null as string | null,
  /** null simula a máquina tendo saído da rede entre a decisão e o comando */
  vivo: true
}));

const farmFalso = vi.hoisted(() => ({
  lista: [] as any[],
  on: () => {},
  printers: () => farmFalso.lista,
  printer: (id: string) => farmFalso.lista.find((p: any) => p.id === id) ?? null,
  clienteVivo: (id: string) =>
    clientes.vivo
      ? {
          pausar: async () => {
            if (clientes.falhar) throw new Error(clientes.falhar);
            clientes.comandos.push(`pausar:${id}`);
          },
          cancelar: async () => {
            if (clientes.falhar) throw new Error(clientes.falhar);
            clientes.comandos.push(`cancelar:${id}`);
          }
        }
      : null
}));
vi.mock('../src/services/farm.js', () => ({ farm: farmFalso }));

const QUADRO = Buffer.from('o-quadro-que-convenceu');
vi.mock('../src/services/cameras.js', () => ({
  cameras: { on: () => {}, capturar: async () => QUADRO }
}));

const alertasFalsos = vi.hoisted(() => ({ criados: [] as any[], pausasMarcadas: [] as string[] }));
vi.mock('../src/services/alerts.js', () => ({
  criarAlerta: async (a: any) => {
    alertasFalsos.criados.push(a);
    return { ...a, id: alertasFalsos.criados.length };
  },
  marcarPausaAutomatica: (id: string) => void alertasFalsos.pausasMarcadas.push(id)
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const { config } = await import('../src/config.js');
const deteccao = await import('../src/services/deteccao.js');

function impressora(patch: Partial<Printer> = {}): Printer {
  return {
    id: 'P05',
    nome: 'Voron 0.2',
    job: 'suporte.gcode',
    concluiuComSucesso: false,
    pct: 42,
    restanteSegundos: 1_800,
    camada: '84/210',
    status: 'imprimindo',
    online: true,
    desligamento: null,
    klippy: 'ready',
    mensagemKlippy: null,
    temTaCamera: true,
    pecaAtual: null,
    minExtrusao: null,
    temPecas: false,
    cameraRotacao: 0,
    temperaturas: [],
    posicao: null,
    macros: [],
    ...patch
  };
}

/** Leva a impressora de P05 até a falha confirmada. */
async function ateConfirmar(): Promise<void> {
  deteccao._usarClassificador(async () => 0.92);
  await deteccao._tique(); // registra a impressão
  vi.setSystemTime(Date.now() + config.deteccaoEsperaInicialS * 1_000 + 1_000);
  for (let i = 0; i < config.deteccaoConfirmacoes; i++) {
    vi.setSystemTime(Date.now() + config.deteccaoIntervaloS * 1_000);
    await deteccao._tique();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-09T03:00:00Z'));
  banco.prefs.clear();
  alertasFalsos.criados.length = 0;
  alertasFalsos.pausasMarcadas.length = 0;
  clientes.comandos.length = 0;
  clientes.falhar = null;
  clientes.vivo = true;
  deteccao._limparDeteccao();
  deteccao._modeloPronto(true);
  farmFalso.lista = [impressora()];
});

describe('a ação configurada', () => {
  it('pausar manda o pause para a máquina certa', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'pausar' });
    await ateConfirmar();

    expect(clientes.comandos).toEqual(['pausar:P05']);
    expect(alertasFalsos.criados[0].detalhe).toContain('pausada');
  });

  it('a pausa é marcada como nossa, para o celular não tocar duas vezes', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'pausar' });
    await ateConfirmar();

    // sem isto, a transição para 'pausada' geraria um "impressão pausada"
    // logo atrás deste alerta, dizendo menos e chegando depois
    expect(alertasFalsos.pausasMarcadas).toEqual(['P05']);
  });

  it('cancelar não marca pausa nenhuma', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'cancelar' });
    await ateConfirmar();

    expect(alertasFalsos.pausasMarcadas).toEqual([]);
  });

  it('cancelar encerra o trabalho', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'cancelar' });
    await ateConfirmar();

    expect(clientes.comandos).toEqual(['cancelar:P05']);
    expect(alertasFalsos.criados[0].detalhe).toContain('cancelada');
  });

  it('alertar não toca na máquina', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'alertar' });
    await ateConfirmar();

    expect(clientes.comandos).toEqual([]);
    expect(alertasFalsos.criados).toHaveLength(1);
    expect(alertasFalsos.criados[0].detalhe).toContain('Nenhuma ação automática');
  });

  it('sem ação escolhida vale o padrão do servidor', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: null });
    await ateConfirmar();

    expect(clientes.comandos).toEqual([`${deteccao.padroesDeteccao().acao}:P05`]);
  });
});

describe('quando a ação não dá certo', () => {
  it('a recusa da máquina não engole o alerta, e vai no detalhe', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'pausar' });
    clientes.falhar = 'Klipper não está pronto';
    await ateConfirmar();

    expect(clientes.comandos).toEqual([]);
    expect(alertasFalsos.criados).toHaveLength(1);
    expect(alertasFalsos.criados[0].detalhe).toContain('Klipper não está pronto');
  });

  it('máquina que saiu da rede entre a decisão e o comando ainda alerta', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'pausar' });
    clientes.vivo = false;
    await ateConfirmar();

    expect(alertasFalsos.criados).toHaveLength(1);
    expect(alertasFalsos.criados[0].detalhe).toContain('saiu da rede');
  });
});

describe('o alerta que sai', () => {
  it('leva o quadro que convenceu, e não um recapturado depois', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'pausar' });
    await ateConfirmar();

    const a = alertasFalsos.criados[0];
    expect(a.capturarFrame).toBe(true);
    expect(a.frame).toBe(QUADRO);
    expect(a.frameLabel).toBe('CAM P05');
  });

  it('a chave de dedupe é por impressão, para não repetir o aviso', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'pausar' });
    await ateConfirmar();

    expect(alertasFalsos.criados[0].dedupeKey).toBe('falha:P05:suporte.gcode');
  });

  it('diz o nome do arquivo e a confiança, que é o que se olha na foto', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'pausar' });
    await ateConfirmar();

    const detalhe = alertasFalsos.criados[0].detalhe as string;
    expect(detalhe).toContain('suporte.gcode');
    expect(detalhe).toContain('0.92');
  });

  it('o código está registrado e notifica por padrão', () => {
    expect(CODIGOS_DE_ALERTA.map((c) => c.codigo)).toContain('falha_detectada');
    expect(CODIGOS_PADRAO).toContain('falha_detectada');
    expect(CODIGOS_DE_ALERTA.find((c) => c.codigo === 'falha_detectada')!.sev).toBe('alta');
  });
});
