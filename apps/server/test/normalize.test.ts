import { describe, expect, it } from 'vitest';
import type { PrinterConfig } from '@3dfarm/shared';
import type { EstadoBruto } from '../src/moonraker/client.js';
import { camadaDe, normalizar, progressoDe, restanteSegundos, statusDe } from '../src/moonraker/normalize.js';

const cfg: PrinterConfig = {
  id: 'P01',
  nome: 'Ender 3 V2 — A',
  moonrakerUrl: 'http://p01.local:7125',
  apiKey: null,
  cameraUrl: 'http://p01.local:8080/stream',
  backupEnabled: true,
  ordem: 0
};

function bruto(patch: Partial<EstadoBruto> = {}, objetos: Record<string, any> = {}): EstadoBruto {
  return {
    conectado: true,
    klippy: 'ready',
    macros: [],
    ultimoErro: null,
    ...patch,
    objetos: {
      print_stats: { state: 'standby', filename: '', print_duration: 0, info: {} },
      display_status: { progress: 0 },
      ...objetos
    }
  };
}

describe('statusDe', () => {
  it('mapeia os estados do Klipper para o vocabulário do design', () => {
    expect(statusDe(bruto({}, { print_stats: { state: 'printing' } }))).toBe('imprimindo');
    expect(statusDe(bruto({}, { print_stats: { state: 'paused' } }))).toBe('pausada');
    expect(statusDe(bruto({}, { print_stats: { state: 'cancelled' } }))).toBe('cancelada');
    expect(statusDe(bruto({}, { print_stats: { state: 'complete' } }))).toBe('ociosa');
    expect(statusDe(bruto({}, { print_stats: { state: 'standby' } }))).toBe('ociosa');
    expect(statusDe(bruto({}, { print_stats: { state: 'error' } }))).toBe('atenção');
  });

  it('vira atenção quando o Klipper cai com um trabalho aberto', () => {
    const comJob = bruto({ klippy: 'shutdown' }, { print_stats: { state: 'printing', filename: 'a.gcode' } });
    expect(statusDe(comJob)).toBe('atenção');
  });

  it('não acusa atenção quando o Klipper cai com a máquina ociosa', () => {
    const semJob = bruto({ klippy: 'shutdown' }, { print_stats: { state: 'standby', filename: '' } });
    expect(statusDe(semJob)).toBe('ociosa');
  });

  it('trata desconectado como ociosa — quem sinaliza a queda é o campo online', () => {
    expect(statusDe(bruto({ conectado: false }, { print_stats: { state: 'printing' } }))).toBe('ociosa');
  });
});

describe('progressoDe', () => {
  it('prefere display_status e cai para virtual_sdcard', () => {
    expect(progressoDe(bruto({}, { display_status: { progress: 0.72 } }))).toBe(72);
    const semDisplay = bruto({}, { display_status: {}, virtual_sdcard: { progress: 0.31 } });
    expect(progressoDe(semDisplay)).toBe(31);
  });

  it('trava entre 0 e 100 mesmo com valor absurdo', () => {
    expect(progressoDe(bruto({}, { display_status: { progress: 1.4 } }))).toBe(100);
    expect(progressoDe(bruto({}, { display_status: { progress: -0.2 } }))).toBe(0);
  });
});

describe('restanteSegundos', () => {
  it('extrapola pelo tempo já impresso', () => {
    // 50 % em 1 h → falta 1 h
    const e = bruto({}, { display_status: { progress: 0.5 }, print_stats: { state: 'printing', print_duration: 3600 } });
    expect(restanteSegundos(e)).toBeCloseTo(3600, 0);
  });

  it('não estima abaixo de 1% — o número seria ficção', () => {
    const e = bruto({}, { display_status: { progress: 0.005 }, print_stats: { state: 'printing', print_duration: 30 } });
    expect(restanteSegundos(e)).toBeNull();
  });
});

describe('camadaDe', () => {
  it('formata camada atual sobre total', () => {
    const e = bruto({}, { print_stats: { state: 'printing', info: { current_layer: 84, total_layer: 210 } } });
    expect(camadaDe(e)).toBe('84/210');
  });

  it('devolve travessão quando o fatiador não informou', () => {
    expect(camadaDe(bruto())).toBe('—');
  });
});

describe('normalizar', () => {
  it('produz a Printer que a UI consome', () => {
    const e = bruto(
      { macros: ['HOME_ALL'] },
      {
        print_stats: {
          state: 'printing',
          filename: 'suporte_camera_v3.gcode',
          print_duration: 3600,
          info: { current_layer: 84, total_layer: 210 }
        },
        display_status: { progress: 0.72 },
        extruder: { temperature: 210.42, target: 210 },
        heater_bed: { temperature: 59.81, target: 60 },
        gcode_move: { gcode_position: [110, 92.5, 16.8, 0] }
      }
    );
    const p = normalizar(cfg, e);

    expect(p).toMatchObject({
      id: 'P01',
      nome: 'Ender 3 V2 — A',
      job: 'suporte_camera_v3.gcode',
      pct: 72,
      camada: '84/210',
      status: 'imprimindo',
      online: true,
      temTaCamera: true
    });
    // números crus: o front é quem escolhe vírgula ou ponto
    expect(p.temperaturas).toEqual([
      { chave: 'bico', atual: 210.42, alvo: 210 },
      { chave: 'mesa', atual: 59.81, alvo: 60 }
    ]);
    expect(p.posicao).toEqual({ x: 110, y: 92.5, z: 16.8 });
  });

  it('zera o progresso quando cancelada ou ociosa, como no design', () => {
    const cancelada = bruto({}, { print_stats: { state: 'cancelled', filename: 'x.gcode' }, display_status: { progress: 0.44 } });
    expect(normalizar(cfg, cancelada)).toMatchObject({ pct: 0, status: 'cancelada' });
  });

  it('só estima tempo restante quando está de fato imprimindo', () => {
    // fora do estado "imprimindo" o rótulo vem do próprio status, no front
    const pausada = bruto({}, { print_stats: { state: 'paused', filename: 'x.gcode' }, display_status: { progress: 0.2 } });
    expect(normalizar(cfg, pausada).restanteSegundos).toBeNull();

    const offline = bruto({ conectado: false });
    expect(normalizar(cfg, offline).restanteSegundos).toBeNull();

    const imprimindo = bruto(
      {},
      { print_stats: { state: 'printing', print_duration: 3600 }, display_status: { progress: 0.5 } }
    );
    expect(normalizar(cfg, imprimindo).restanteSegundos).toBeCloseTo(3600, 0);
  });
});
