import { describe, expect, it, vi, afterEach } from 'vitest';
import type { LinhaConsole, PrinterConfig } from '@3dfarm/shared';
import { CONSOLE_MAX_LINHAS, tomDaLinha } from '@3dfarm/shared';
import { MoonrakerClient, type EstadoBruto } from '../src/moonraker/client.js';
import { historicoDeTemperatura } from '../src/moonraker/normalize.js';

/**
 * Console e gráfico de aquecimento.
 *
 * As duas coisas que a tela não tinha: ler o que a máquina diz, e ver o
 * aquecimento como curva em vez de número. As duas ficam fora do snapshot do
 * SSE — uma por evento próprio, a outra sob demanda — e é isso que estes
 * testes protegem, junto do recorte que cada uma faz.
 */

const CFG: PrinterConfig = {
  id: 'P01',
  nome: 'Ender',
  moonrakerUrl: 'http://impressora.local:7125',
  apiKey: null,
  cameraUrl: null,
  cameraRotacao: 0,
  backupEnabled: false,
  ordem: 0
};

/** Um cliente que não abre socket: as chamadas RPC vêm de `respostas`. */
class ClienteDeTeste extends MoonrakerClient {
  respostas: Record<string, unknown> = {};

  override async chamar<T = any>(metodo: string): Promise<T> {
    if (metodo in this.respostas) return this.respostas[metodo] as T;
    throw new Error(`sem resposta para ${metodo}`);
  }

  /** O que o Moonraker notificaria — o caminho normal das falas da máquina. */
  notificar(metodo: string, params: unknown[]): void {
    (this as any).aoNotificar(metodo, params);
  }

  semear(): Promise<void> {
    return (this as any).semearConsole();
  }
}

afterEach(() => vi.useRealTimers());

describe('o tom de cada linha', () => {
  const linha = (texto: string, tipo: LinhaConsole['tipo'] = 'resposta'): LinhaConsole => ({
    em: 1,
    tipo,
    texto
  });

  it('separa o que o Klipper marcou como erro', () => {
    expect(tomDaLinha(linha('!! Move out of range'))).toBe('erro');
  });

  it('trata `//` como informação, que é o que as macros usam', () => {
    expect(tomDaLinha(linha('// Mesh Bed Leveling Complete'))).toBe('aviso');
  });

  it('resposta sem marca é resposta comum', () => {
    expect(tomDaLinha(linha('ok T:210.4 /210.0'))).toBe('normal');
  });

  it('o que saiu daqui é comando, mesmo parecendo resposta', () => {
    expect(tomDaLinha(linha('!! isto foi digitado', 'comando'))).toBe('comando');
  });
});

describe('o anel do console', () => {
  it('quebra o script em linhas e ignora o que está em branco', () => {
    const c = new ClienteDeTeste(CFG);
    c.registrarEnvio('SAVE_GCODE_STATE NAME=jog\n\n  G28  \n');
    expect(c.linhasDoConsole().map((l) => l.texto)).toEqual(['SAVE_GCODE_STATE NAME=jog', 'G28']);
    expect(c.linhasDoConsole().every((l) => l.tipo === 'comando')).toBe(true);
  });

  it('guarda o que a máquina fala pela notificação do Moonraker', () => {
    const c = new ClienteDeTeste(CFG);
    c.notificar('notify_gcode_response', ['!! Extrude below minimum temp']);
    expect(c.linhasDoConsole()).toHaveLength(1);
    expect(c.linhasDoConsole()[0]).toMatchObject({
      tipo: 'resposta',
      texto: '!! Extrude below minimum temp'
    });
  });

  it('não passa do teto: uma máquina falante joga fora as linhas velhas', () => {
    const c = new ClienteDeTeste(CFG);
    for (let i = 0; i < CONSOLE_MAX_LINHAS + 40; i++) c.registrarEnvio(`M117 ${i}`);
    const linhas = c.linhasDoConsole();
    expect(linhas).toHaveLength(CONSOLE_MAX_LINHAS);
    // as que ficaram são as últimas, não as primeiras
    expect(linhas[linhas.length - 1].texto).toBe(`M117 ${CONSOLE_MAX_LINHAS + 39}`);
  });

  it('junta a rajada num evento só, em vez de um por linha', () => {
    vi.useFakeTimers();
    const c = new ClienteDeTeste(CFG);
    const rajadas: LinhaConsole[][] = [];
    c.on('console', (linhas: LinhaConsole[]) => rajadas.push(linhas));

    c.notificar('notify_gcode_response', ['// linha 1']);
    c.notificar('notify_gcode_response', ['// linha 2']);
    expect(rajadas).toHaveLength(0); // ainda dentro da janela

    vi.advanceTimersByTime(300);
    expect(rajadas).toHaveLength(1);
    expect(rajadas[0].map((l) => l.texto)).toEqual(['// linha 1', '// linha 2']);
  });
});

describe('o passado que o Moonraker guardava', () => {
  const loja = (linhas: [number, string, string][]) => ({
    gcode_store: linhas.map(([time, type, message]) => ({ time, type, message }))
  });

  it('traz o que a máquina disse antes de este app subir', async () => {
    const c = new ClienteDeTeste(CFG);
    c.respostas['server.gcode_store'] = loja([
      [1_000, 'command', 'BED_MESH_CALIBRATE'],
      [1_001, 'response', '// Mesh Bed Leveling Complete']
    ]);
    await c.semear();

    expect(c.linhasDoConsole()).toEqual([
      { em: 1_000_000, tipo: 'comando', texto: 'BED_MESH_CALIBRATE' },
      { em: 1_001_000, tipo: 'resposta', texto: '// Mesh Bed Leveling Complete' }
    ]);
  });

  it('reconectar não duplica o histórico: só entra o que é mais novo', async () => {
    const c = new ClienteDeTeste(CFG);
    c.respostas['server.gcode_store'] = loja([[1_000, 'response', '// primeira']]);
    await c.semear();

    c.respostas['server.gcode_store'] = loja([
      [1_000, 'response', '// primeira'],
      [1_002, 'response', '// segunda']
    ]);
    await c.semear();

    expect(c.linhasDoConsole().map((l) => l.texto)).toEqual(['// primeira', '// segunda']);
  });

  it('máquina sem histórico não derruba o handshake', async () => {
    const c = new ClienteDeTeste(CFG);
    await expect(c.semear()).resolves.toBeUndefined();
    expect(c.linhasDoConsole()).toEqual([]);
  });
});

// ── o gráfico ───────────────────────────────────────────────────────────────

/** Um estado cru com bico, mesa e o MCU — que é só leitura. */
function estadoCom(objetos: Record<string, unknown>): EstadoBruto {
  return {
    conectado: true,
    klippy: 'ready',
    objetos,
    macros: [],
    limites: {},
    minExtrusao: 170,
    desligamento: null,
    ultimoErro: null,
    mensagemKlippy: null
  };
}

const SERIE = (n: number, valor: number) => Array.from({ length: n }, () => valor);

describe('o histórico de temperatura', () => {
  const bruto = estadoCom({
    extruder: { temperature: 210, target: 210 },
    heater_bed: { temperature: 60, target: 60 },
    'temperature_sensor MCU': { temperature: 38 }
  });

  it('deixa de fora quem só mede: o MCU não tem aquecimento para mostrar', () => {
    const h = historicoDeTemperatura(bruto, {
      extruder: { temperatures: SERIE(60, 210), targets: SERIE(60, 210) },
      heater_bed: { temperatures: SERIE(60, 60), targets: SERIE(60, 60) },
      'temperature_sensor mcu': { temperatures: SERIE(60, 38) }
    });
    expect(h.series.map((s) => s.chave)).toEqual(['extruder', 'heater_bed']);
  });

  it('casa a chave mesmo com a caixa diferente da do printer.cfg', () => {
    const comCamara = estadoCom({
      extruder: { temperature: 210, target: 210 },
      'heater_generic Chamber': { temperature: 45, target: 45 }
    });
    const h = historicoDeTemperatura(comCamara, {
      extruder: { temperatures: SERIE(30, 210) },
      'heater_generic chamber': { temperatures: SERIE(30, 45) }
    });
    // a chave que sai é a do snapshot, que é a que a tela usa para casar
    expect(h.series.map((s) => s.chave)).toEqual(['extruder', 'heater_generic Chamber']);
  });

  it('reamostra com um passo só, para o índice valer o mesmo instante em todas', () => {
    const h = historicoDeTemperatura(
      bruto,
      {
        extruder: { temperatures: SERIE(600, 210) },
        heater_bed: { temperatures: SERIE(600, 60) }
      },
      600,
      150
    );
    expect(h.intervalo).toBe(4);
    expect(h.series[0].atuais).toHaveLength(150);
    expect(h.series[1].atuais).toHaveLength(150);
  });

  it('alinha pela direita: uma série mais curta ganha buraco no começo', () => {
    const h = historicoDeTemperatura(
      bruto,
      {
        extruder: { temperatures: SERIE(10, 210) },
        heater_bed: { temperatures: SERIE(4, 60) }
      },
      600,
      150
    );
    const mesa = h.series.find((s) => s.chave === 'heater_bed')!;
    expect(mesa.atuais).toHaveLength(10);
    // o último ponto é agora nas duas; o que falta é passado que não existiu
    expect(mesa.atuais.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(mesa.atuais.slice(6)).toEqual([60, 60, 60, 60]);
  });

  it('sem alvo guardado, a curva tracejada simplesmente não existe', () => {
    const h = historicoDeTemperatura(bruto, { extruder: { temperatures: SERIE(5, 210) } });
    expect(h.series[0].alvos).toBeNull();
  });

  it('máquina sem nada guardado devolve gráfico vazio, não um erro', () => {
    expect(historicoDeTemperatura(bruto, {}).series).toEqual([]);
  });

  it('arredonda para uma casa: é o que um termistor resolve', () => {
    const h = historicoDeTemperatura(bruto, { extruder: { temperatures: [209.87654] } });
    expect(h.series[0].atuais).toEqual([209.9]);
  });
});
