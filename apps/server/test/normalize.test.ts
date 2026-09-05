import { describe, expect, it } from 'vitest';
import type { PrinterConfig } from '@3dfarm/shared';
import { motivoDoKlipper, type EstadoBruto } from '../src/moonraker/client.js';
import { camadaDe, normalizar, progressoDe, restanteSegundos, statusDe, temperaturasDe } from '../src/moonraker/normalize.js';

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
    limites: {},
    ultimoErro: null,
    mensagemKlippy: null,
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
    // o shutdown durante a impressão costuma chegar já com print_stats em 'error'
    const jaEmErro = bruto({ klippy: 'shutdown' }, { print_stats: { state: 'error', filename: 'a.gcode' } });
    expect(statusDe(jaEmErro)).toBe('atenção');
  });

  it('não acusa atenção quando o Klipper cai com a máquina ociosa', () => {
    const semJob = bruto({ klippy: 'shutdown' }, { print_stats: { state: 'standby', filename: '' } });
    expect(statusDe(semJob)).toBe('ociosa');
  });

  it('não acusa atenção por causa do filename que sobra de uma impressão concluída', () => {
    // print_stats guarda o arquivo muito depois do fim; olhar só o filename
    // faria todo shutdown com a máquina parada virar "impressão interrompida"
    const depoisDeConcluir = bruto(
      { klippy: 'shutdown' },
      { print_stats: { state: 'complete', filename: 'a.gcode' } }
    );
    expect(statusDe(depoisDeConcluir)).toBe('ociosa');
  });

  it('não mostra imprimindo quando o Moonraker perde o Klipper', () => {
    // o socket com o Moonraker segue de pé, então print_stats congela em
    // 'printing'; repetir isso deixaria a tela com uma impressão que não anda
    const klipperCaido = bruto(
      { klippy: 'disconnected' },
      { print_stats: { state: 'printing', filename: 'a.gcode' } }
    );
    expect(statusDe(klipperCaido)).toBe('atenção');
    expect(normalizar(cfg, klipperCaido).restanteSegundos).toBeNull();
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
      { chave: 'extruder', rotulo: null, tipo: 'aquecedor', atual: 210.42, alvo: 210, min: null, max: null },
      { chave: 'heater_bed', rotulo: null, tipo: 'aquecedor', atual: 59.81, alvo: 60, min: null, max: null }
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

describe('temperaturasDe', () => {
  const cheia = bruto(
    {
      limites: {
        extruder: { min: 0, max: 300 },
        heater_bed: { min: 0, max: 120 },
        'heater_generic chamber': { min: 0, max: 60 }
      }
    },
    {
      extruder: { temperature: 210.4, target: 210 },
      heater_bed: { temperature: 59.8, target: 60 },
      'heater_generic Chamber': { temperature: 44.2, target: 45 },
      'temperature_fan exhaust': { temperature: 41, target: 40 },
      'temperature_sensor MCU': { temperature: 38.2 },
      'temperature_sensor Raspberry Pi': { temperature: 46.5 }
    }
  );

  it('acha os sensores extras da máquina, e não só bico e mesa', () => {
    expect(temperaturasDe(cheia).map((t) => t.chave)).toEqual([
      'extruder',
      'heater_bed',
      'heater_generic Chamber',
      'temperature_fan exhaust',
      'temperature_sensor MCU',
      'temperature_sensor Raspberry Pi'
    ]);
  });

  it('separa quem aquece de quem só mede', () => {
    const por = new Map(temperaturasDe(cheia).map((t) => [t.chave, t]));
    expect(por.get('heater_generic Chamber')).toMatchObject({ tipo: 'aquecedor', alvo: 45, rotulo: 'Chamber' });
    expect(por.get('temperature_fan exhaust')).toMatchObject({ tipo: 'ventoinha', alvo: 40, rotulo: 'exhaust' });
    // sensor de leitura não tem alvo nenhum: mostrar 0 sugeriria "desligado"
    expect(por.get('temperature_sensor MCU')).toMatchObject({
      tipo: 'sensor',
      atual: 38.2,
      alvo: null,
      rotulo: 'MCU'
    });
  });

  it('casa a faixa do printer.cfg mesmo com a seção em outra caixa', () => {
    // o Klipper devolve as seções de configfile.settings em minúsculas, e o
    // objeto com o nome como a pessoa escreveu
    const camara = temperaturasDe(cheia).find((t) => t.chave === 'heater_generic Chamber');
    expect(camara).toMatchObject({ min: 0, max: 60 });
  });

  it('deixa a faixa em null quando a impressora não informou', () => {
    const semLimites = bruto({}, { extruder: { temperature: 24, target: 0 } });
    expect(temperaturasDe(semLimites)[0]).toMatchObject({ chave: 'extruder', min: null, max: null });
  });

  it('põe as extrusoras em ordem, antes da mesa', () => {
    const dupla = bruto(
      {},
      {
        extruder: { temperature: 200, target: 200 },
        extruder1: { temperature: 190, target: 190 },
        heater_bed: { temperature: 60, target: 60 }
      }
    );
    expect(temperaturasDe(dupla).map((t) => t.chave)).toEqual(['extruder', 'extruder1', 'heater_bed']);
  });

  it('ignora os objetos que não são sensores', () => {
    const chaves = temperaturasDe(cheia).map((t) => t.chave);
    expect(chaves).not.toContain('print_stats');
    expect(chaves).not.toContain('display_status');
  });
});

describe('motivoDoKlipper', () => {
  it('fica só com a primeira linha — o resto é a instrução genérica do Klipper', () => {
    const bruta =
      "MCU 'mcu' shutdown: Lost communication with MCU 'mcu'\n" +
      'Once the underlying issue is corrected, use the "FIRMWARE_RESTART" command to reset the firmware.';
    expect(motivoDoKlipper('shutdown', bruta)).toBe("MCU 'mcu' shutdown: Lost communication with MCU 'mcu'");
  });

  it('ignora a mensagem quando o Klipper está pronto — lá ela é só "Printer is ready"', () => {
    expect(motivoDoKlipper('ready', 'Printer is ready')).toBeNull();
  });

  it('devolve null quando não veio mensagem nenhuma', () => {
    expect(motivoDoKlipper('shutdown', undefined)).toBeNull();
    expect(motivoDoKlipper('shutdown', '   \n  ')).toBeNull();
  });
});
