import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Printer } from '@gridfarm/shared';

/**
 * O acumulador da detecção de falha pela câmera.
 *
 * O que motivou o arquivo: um classificador treinado em fotos limpas dá nota
 * alta para o bico passando na frente da lente, para um quadro borrado no meio
 * de um movimento rápido e para a luz mudando quando alguém acende a oficina.
 * Agir na primeira amostra suspeita transformaria isso em impressão pausada de
 * madrugada sem motivo. O que se testa aqui, então, não é reconhecer espaguete
 * — é a regra que decide *quando* uma suspeita vira ação, e tudo o que precisa
 * zerar a contagem para que a evidência seja mesmo contínua.
 *
 * A inferência não entra: o classificador é injetado, e a suíte roda em
 * milissegundos sem carregar 11 MB de WebAssembly.
 */

const banco = vi.hoisted(() => ({ prefs: new Map<string, any>(), alertas: [] as any[] }));

vi.mock('../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (...args: any[]) => {
        if (sql.includes('FROM deteccao_prefs')) return banco.prefs.get(args[0]);
        return undefined;
      },
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
  /** o que cada impressora recebeu de comando, na ordem */
  comandos: [] as string[],
  falharPausa: false
}));

const farmFalso = vi.hoisted(() => ({
  lista: [] as any[],
  on: () => {},
  printers: () => farmFalso.lista,
  printer: (id: string) => farmFalso.lista.find((p: any) => p.id === id) ?? null,
  clienteVivo: (id: string) => ({
    pausar: async () => {
      if (clientes.falharPausa) throw new Error('Klipper recusou');
      clientes.comandos.push(`pausar:${id}`);
    },
    cancelar: async () => void clientes.comandos.push(`cancelar:${id}`)
  })
}));
vi.mock('../src/services/farm.js', () => ({ farm: farmFalso }));

const camerasFalsas = vi.hoisted(() => ({
  /** null simula câmera fora do ar */
  quadro: Buffer.from('jpeg-de-mentira') as Buffer | null
}));
vi.mock('../src/services/cameras.js', () => ({
  cameras: { on: () => {}, capturar: async () => camerasFalsas.quadro }
}));

const alertasFalsos = vi.hoisted(() => ({ criados: [] as any[] }));
vi.mock('../src/services/alerts.js', () => ({
  criarAlerta: async (a: any) => {
    alertasFalsos.criados.push(a);
    return { ...a, id: alertasFalsos.criados.length };
  },
  // o detector avisa o gerador de que esta pausa partiu daqui; quem testa isso
  // é deteccao-acao.test.ts, aqui só não pode faltar
  marcarPausaAutomatica: () => {}
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

/**
 * Roda N ciclos. Cada um só analisa se já passou o intervalo desde o anterior,
 * então o relógio anda junto — é assim que o serviço funciona de verdade.
 */
async function ciclos(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    vi.setSystemTime(Date.now() + config.deteccaoIntervaloS * 1_000);
    await deteccao._tique();
  }
}

/**
 * Passa a espera inicial sem gastar análises.
 *
 * O primeiro tique é o que registra a impressão — a contagem começa quando o
 * detector *vê* a máquina imprimindo, não numa data que o Moonraker informe —
 * então é preciso um ciclo antes de adiantar o relógio. Vale também depois de
 * um restart do servidor no meio de uma impressão: espera-se de novo, o que é
 * o comportamento certo, já que ninguém sabe o que passou enquanto ele esteve
 * fora.
 */
async function passarEsperaInicial(): Promise<void> {
  await deteccao._tique();
  vi.setSystemTime(Date.now() + config.deteccaoEsperaInicialS * 1_000 + 1_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-09T03:00:00Z'));
  banco.prefs.clear();
  alertasFalsos.criados.length = 0;
  clientes.comandos.length = 0;
  clientes.falharPausa = false;
  camerasFalsas.quadro = Buffer.from('jpeg-de-mentira');
  deteccao._limparDeteccao();
  deteccao._modeloPronto(true);
  farmFalso.lista = [impressora()];
  // ligada e pausando, que é o padrão de fábrica de uma máquina vigiada
  deteccao.salvarPrefs('P05', { ligado: true, acao: 'pausar' });
});

describe('acumulador da detecção', () => {
  it('uma suspeita isolada não faz nada', async () => {
    deteccao._usarClassificador(async () => 0.9);
    await passarEsperaInicial();

    await ciclos(1);

    expect(clientes.comandos).toEqual([]);
    expect(alertasFalsos.criados).toEqual([]);
  });

  it('três suspeitas seguidas pausam a impressão e criam o alerta', async () => {
    deteccao._usarClassificador(async () => 0.9);
    await passarEsperaInicial();

    await ciclos(config.deteccaoConfirmacoes);

    expect(clientes.comandos).toEqual(['pausar:P05']);
    expect(alertasFalsos.criados).toHaveLength(1);
    expect(alertasFalsos.criados[0].codigo).toBe('falha_detectada');
    expect(alertasFalsos.criados[0].sev).toBe('alta');
  });

  it('um quadro limpo no meio zera a contagem', async () => {
    // suspeito, suspeito, limpo, suspeito, suspeito: nunca chega a três seguidos
    const notas = [0.9, 0.9, 0.1, 0.9, 0.9];
    let i = 0;
    deteccao._usarClassificador(async () => notas[i++] ?? 0);
    await passarEsperaInicial();

    await ciclos(notas.length);

    expect(clientes.comandos).toEqual([]);
  });

  it('confiança abaixo do limiar da impressora não conta', async () => {
    deteccao.salvarPrefs('P05', { ligado: true, acao: 'pausar', limiar: 0.9 });
    deteccao._usarClassificador(async () => 0.6);
    await passarEsperaInicial();

    await ciclos(5);

    expect(clientes.comandos).toEqual([]);
  });

  it('age uma vez só por impressão, mesmo com a suspeita continuando', async () => {
    deteccao._usarClassificador(async () => 0.9);
    await passarEsperaInicial();

    await ciclos(config.deteccaoConfirmacoes + 4);

    expect(clientes.comandos).toEqual(['pausar:P05']);
    expect(alertasFalsos.criados).toHaveLength(1);
  });

  it('trocar de impressão zera tudo, inclusive o já-agiu', async () => {
    deteccao._usarClassificador(async () => 0.9);
    await passarEsperaInicial();
    await ciclos(config.deteccaoConfirmacoes);
    expect(clientes.comandos).toEqual(['pausar:P05']);

    // outra peça na mesma máquina: é outra impressão, e merece ser vigiada
    farmFalso.lista = [impressora({ job: 'outra-peca.gcode' })];
    await passarEsperaInicial();
    await ciclos(config.deteccaoConfirmacoes);

    expect(clientes.comandos).toEqual(['pausar:P05', 'pausar:P05']);
    expect(alertasFalsos.criados).toHaveLength(2);
  });

  it('a evidência precisa ser contínua: uma pausa no meio zera a contagem', async () => {
    deteccao._usarClassificador(async () => 0.9);
    await passarEsperaInicial();
    await ciclos(config.deteccaoConfirmacoes - 1);

    // alguém pausou na mão, e depois retomou
    farmFalso.lista = [impressora({ status: 'pausada' })];
    await ciclos(1);
    farmFalso.lista = [impressora()];
    await ciclos(1);

    expect(clientes.comandos).toEqual([]);
  });
});

describe('quem fica de fora', () => {
  const casos: [string, Partial<Printer>][] = [
    ['máquina ociosa', { status: 'ociosa' }],
    ['máquina pausada', { status: 'pausada' }],
    ['máquina fora da rede', { online: false }],
    ['Klipper que não está pronto', { klippy: 'shutdown' }],
    ['impressora sem câmera', { temTaCamera: false }]
  ];

  for (const [nome, patch] of casos) {
    it(`${nome} não é analisada`, async () => {
      deteccao._usarClassificador(async () => 0.9);
      farmFalso.lista = [impressora(patch)];
      await passarEsperaInicial();

      await ciclos(config.deteccaoConfirmacoes + 2);

      expect(clientes.comandos).toEqual([]);
      expect(alertasFalsos.criados).toEqual([]);
    });
  }

  it('impressora não vigiada não é analisada', async () => {
    banco.prefs.clear(); // sem linha = desligada, que é o padrão
    deteccao._usarClassificador(async () => 0.9);
    await passarEsperaInicial();

    await ciclos(config.deteccaoConfirmacoes + 2);

    expect(clientes.comandos).toEqual([]);
  });

  it('a espera inicial protege a linha de purga e a saia', async () => {
    deteccao._usarClassificador(async () => 0.9);
    // sem passar a espera: a impressão acabou de começar

    await ciclos(config.deteccaoConfirmacoes + 2);

    expect(clientes.comandos).toEqual([]);
  });

  it('câmera que não responde não conta como quadro limpo nem como suspeito', async () => {
    deteccao._usarClassificador(async () => 0.9);
    camerasFalsas.quadro = null;
    await passarEsperaInicial();

    await ciclos(config.deteccaoConfirmacoes + 2);

    expect(clientes.comandos).toEqual([]);
  });

  it('sem o modelo no disco nada é analisado', async () => {
    deteccao._modeloPronto(false);
    deteccao._usarClassificador(async () => 0.9);
    await passarEsperaInicial();

    // _modeloPronto(false) faz o tique conferir o disco, que nos testes não tem nada
    await ciclos(config.deteccaoConfirmacoes + 2);

    expect(clientes.comandos).toEqual([]);
  });
});
