import { describe, expect, it } from 'vitest';
import type { PrinterConfig } from '@3dfarm/shared';
import { EXTRUSAO_MAX_MM, EXTRUSAO_MM_S, rotacaoValida, ROTACOES } from '@3dfarm/shared';
import { MoonrakerClient, type EstadoBruto } from '../src/moonraker/client.js';
import { normalizar } from '../src/moonraker/normalize.js';
import { criarClienteMock } from '../src/moonraker/mock.js';

/**
 * Dois controles que dependem de config, não de estado: a extrusão manual —
 * que só é liberada com o bico acima do `min_extrude_temp` — e a rotação da
 * câmera, que é como a webcam foi parafusada e não algo que a máquina saiba.
 */

const cfg: PrinterConfig = {
  id: 'P01',
  nome: 'Ender 3 V2 — A',
  moonrakerUrl: 'http://p01.local:7125',
  apiKey: null,
  cameraUrl: 'http://p01.local/webcam',
  cameraRotacao: 0,
  backupEnabled: true,
  ordem: 0
};

function bruto(patch: Partial<EstadoBruto> = {}, objetos: Record<string, unknown> = {}): EstadoBruto {
  return {
    conectado: true,
    klippy: 'ready',
    macros: [],
    limites: {},
    minExtrusao: null,
    ultimoErro: null,
    mensagemKlippy: null,
    objetos: { print_stats: { state: 'standby', filename: '' }, ...objetos },
    ...patch
  };
}

describe('comando de extrusão', () => {
  it('vai em relativo e devolve o modo que estava valendo', async () => {
    const cliente = new MoonrakerClient(cfg);
    const enviados: string[] = [];
    cliente.gcode = async (script: string) => void enviados.push(script);

    await cliente.extrudar(10, EXTRUSAO_MM_S);

    expect(enviados[0].split('\n')).toEqual([
      'SAVE_GCODE_STATE NAME=extrusao_painel',
      'M83',
      'G1 E10.0 F300',
      'RESTORE_GCODE_STATE NAME=extrusao_painel'
    ]);
  });

  it('mm negativo retrai, e a velocidade vira mm/min', async () => {
    const cliente = new MoonrakerClient(cfg);
    const enviados: string[] = [];
    cliente.gcode = async (script: string) => void enviados.push(script);

    await cliente.extrudar(-5, 2);

    expect(enviados[0]).toContain('G1 E-5.0 F120');
  });

  it('o teto de um clique cabe no caminho do acoplador até o bico', () => {
    expect(EXTRUSAO_MAX_MM).toBeGreaterThanOrEqual(100);
  });
});

describe('mínimo para extrudar', () => {
  it('chega ao snapshot para a tela poder explicar o botão apagado', () => {
    expect(normalizar(cfg, bruto({ minExtrusao: 185 })).minExtrusao).toBe(185);
  });

  it('é null quando a máquina não informou — aí quem recusa é o Klipper', () => {
    expect(normalizar(cfg, bruto()).minExtrusao).toBeNull();
  });

  it('o simulador traz o padrão do Klipper, senão o painel liberaria com o bico frio', () => {
    const mock = criarClienteMock(cfg);
    expect(mock.getEstado().minExtrusao).toBe(170);
  });
});

describe('rotação da câmera', () => {
  it('aceita os quatro quartos de volta e recusa o resto', () => {
    for (const g of ROTACOES) expect(rotacaoValida(g)).toBe(g);
    for (const ruim of [45, -90, 360, 1.5, 'noventa', null, undefined, {}]) {
      expect(rotacaoValida(ruim)).toBe(0);
    }
  });

  it('número em texto passa: é assim que o SQLite e o JSON devolvem', () => {
    expect(rotacaoValida('180')).toBe(180);
  });

  it('vai da config para o snapshot — quem desenha o feed é a tela', () => {
    expect(normalizar({ ...cfg, cameraRotacao: 270 }, bruto()).cameraRotacao).toBe(270);
    expect(normalizar(cfg, bruto()).cameraRotacao).toBe(0);
  });
});
