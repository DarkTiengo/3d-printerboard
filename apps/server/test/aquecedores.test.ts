import { describe, expect, it } from 'vitest';
import type { PrinterConfig } from '@3dfarm/shared';
import { MoonrakerClient, nomeDoSensor, sensoresDaLista } from '../src/moonraker/client.js';

const cfg: PrinterConfig = {
  id: 'P05',
  nome: 'Voron 0.2',
  moonrakerUrl: 'http://p05.local:7125',
  apiKey: null,
  cameraUrl: null,
  backupEnabled: true,
  ordem: 0
};

/** Um cliente que não conecta: só registra o G-code que teria enviado. */
function clienteDeMentira() {
  const cliente = new MoonrakerClient(cfg);
  const enviados: string[] = [];
  cliente.gcode = async (script: string) => {
    enviados.push(script);
  };
  return { cliente, enviados };
}

describe('sensoresDaLista', () => {
  const lista = [
    'webhooks',
    'configfile',
    'extruder',
    'extruder1',
    'heater_bed',
    'heater_generic chamber',
    'temperature_fan exhaust',
    'temperature_sensor MCU',
    'temperature_sensor Raspberry Pi',
    'gcode_macro PURGE_LINE',
    'fan',
    'toolhead'
  ];

  it('assina o que carrega temperatura e não está na base', () => {
    expect(sensoresDaLista(lista)).toEqual([
      'extruder1',
      'heater_generic chamber',
      'temperature_fan exhaust',
      'temperature_sensor MCU',
      'temperature_sensor Raspberry Pi'
    ]);
  });

  it('não repete o que a base já assina', () => {
    // extruder e heater_bed entram por OBJETOS_BASE; duplicá-los aqui não
    // quebraria o subscribe, mas esconderia de onde eles vêm
    const achados = sensoresDaLista(lista);
    expect(achados).not.toContain('extruder');
    expect(achados).not.toContain('heater_bed');
  });

  it('deixa de fora o que não é sensor, por mais parecido que o nome seja', () => {
    expect(sensoresDaLista(['fan', 'fan_generic aux', 'heater_fan hotend', 'controller_fan mcu'])).toEqual([]);
  });
});

describe('nomeDoSensor', () => {
  it('tira o prefixo da seção — é o que o G-code endereça', () => {
    expect(nomeDoSensor('heater_generic chamber')).toBe('chamber');
    expect(nomeDoSensor('temperature_fan exhaust')).toBe('exhaust');
  });

  it('deixa intactos os objetos sem prefixo', () => {
    expect(nomeDoSensor('extruder')).toBe('extruder');
    expect(nomeDoSensor('heater_bed')).toBe('heater_bed');
  });
});

describe('definirAlvo', () => {
  it('manda SET_HEATER_TEMPERATURE para bico, mesa e câmara', async () => {
    const { cliente, enviados } = clienteDeMentira();
    await cliente.definirAlvo('extruder', 'aquecedor', 215);
    await cliente.definirAlvo('heater_bed', 'aquecedor', 60);
    await cliente.definirAlvo('heater_generic chamber', 'aquecedor', 45);
    expect(enviados).toEqual([
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=215',
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60',
      'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=45'
    ]);
  });

  it('a ventoinha por temperatura tem comando próprio', async () => {
    const { cliente, enviados } = clienteDeMentira();
    await cliente.definirAlvo('temperature_fan exhaust', 'ventoinha', 40);
    expect(enviados).toEqual(['SET_TEMPERATURE_FAN_TARGET TEMPERATURE_FAN=exhaust TARGET=40']);
  });

  it('não põe aspas no nome — o Klipper não as remove dos parâmetros', async () => {
    const { cliente, enviados } = clienteDeMentira();
    await cliente.definirAlvo('heater_generic chamber', 'aquecedor', 0);
    expect(enviados[0]).not.toContain('"');
  });

  it('zerar é desligar, e sai como qualquer outro alvo', async () => {
    const { cliente, enviados } = clienteDeMentira();
    await cliente.definirAlvo('extruder', 'aquecedor', 0);
    expect(enviados).toEqual(['SET_HEATER_TEMPERATURE HEATER=extruder TARGET=0']);
  });

  it('desligar todos é um comando só', async () => {
    const { cliente, enviados } = clienteDeMentira();
    await cliente.desligarAquecedores();
    expect(enviados).toEqual(['TURN_OFF_HEATERS']);
  });
});

/**
 * O simulador é o que a maioria vê primeiro (MOCK_PRINTERS=true), e é o único
 * lugar onde dá para exercitar câmara e MCU sem uma máquina fechada na mesa.
 */
describe('simulador', () => {
  const voron: PrinterConfig = { ...cfg, id: 'P05' };

  it('a máquina fechada traz câmara, exaustão e a eletrônica', async () => {
    const { criarClienteMock } = await import('../src/moonraker/mock.js');
    const { temperaturasDe } = await import('../src/moonraker/normalize.js');
    const cliente = criarClienteMock(voron);

    const temps = temperaturasDe(cliente.getEstado());
    expect(temps.map((t) => t.chave)).toEqual([
      'extruder',
      'heater_bed',
      'heater_generic chamber',
      'temperature_fan exhaust',
      'temperature_sensor MCU',
      'temperature_sensor Raspberry Pi'
    ]);
    // a faixa chega junto: é ela que limita o campo de alvo na tela
    expect(temps[0]).toMatchObject({ tipo: 'aquecedor', min: 0, max: 300 });
    expect(temps[4]).toMatchObject({ tipo: 'sensor', alvo: null });
  });

  it('aceita o alvo que a rota mandaria, e o mostra no estado seguinte', async () => {
    const { criarClienteMock } = await import('../src/moonraker/mock.js');
    const { temperaturasDe } = await import('../src/moonraker/normalize.js');
    const cliente = criarClienteMock(voron);

    await cliente.definirAlvo('heater_generic chamber', 'aquecedor', 50);
    const camara = temperaturasDe(cliente.getEstado()).find((t) => t.chave === 'heater_generic chamber');
    expect(camara?.alvo).toBe(50);

    await cliente.desligarAquecedores();
    const depois = temperaturasDe(cliente.getEstado());
    expect(depois.filter((t) => t.tipo === 'aquecedor').map((t) => t.alvo)).toEqual([0, 0, 0]);
  });
});
