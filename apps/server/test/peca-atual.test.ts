import { describe, expect, it } from 'vitest';
import type { PrinterConfig } from '@3dfarm/shared';
import { MoonrakerClient } from '../src/moonraker/client.js';
import { normalizar } from '../src/moonraker/normalize.js';
import { criarClienteMock } from '../src/moonraker/mock.js';

/**
 * Excluir da impressão a peça que está sendo feita agora.
 *
 * Do `exclude_object` do Klipper entra no snapshot só `current_object`: a mesa
 * inteira, com o polígono de cada peça, seriam uns 8 KB por máquina republicados
 * a 4 Hz. O que o botão precisa cabe num nome.
 */

const cfg: PrinterConfig = {
  id: 'P02',
  nome: 'Ender 3 V2 — B',
  moonrakerUrl: 'http://p02.local:7125',
  apiKey: null,
  cameraUrl: null,
  backupEnabled: true,
  ordem: 0
};

function bruto(excludeObject: unknown) {
  return {
    conectado: true,
    klippy: 'ready' as const,
    macros: [],
    limites: {},
    ultimoErro: null,
    mensagemKlippy: null,
    objetos: {
      print_stats: { state: 'printing', filename: 'clipe_cabo_x12.gcode' },
      display_status: { progress: 0.31 },
      ...(excludeObject === undefined ? {} : { exclude_object: excludeObject })
    }
  };
}

describe('pecaAtual no snapshot', () => {
  it('sai o nome quando a máquina tem exclude_object e o arquivo tem rótulo', () => {
    const p = normalizar(cfg, bruto({ current_object: 'clipe_cabo id:3' }));
    expect(p.pecaAtual).toBe('clipe_cabo id:3');
  });

  it('máquina sem exclude_object não tem peça — é a maioria', () => {
    expect(normalizar(cfg, bruto(undefined)).pecaAtual).toBeNull();
  });

  it("o '' entre uma peça e outra vale como não ter", () => {
    // o Klipper manda string vazia, não null, e um '' na tela acenderia o botão
    expect(normalizar(cfg, bruto({ current_object: '' })).pecaAtual).toBeNull();
  });

  it('não carrega a mesa inteira para o front', () => {
    const p = normalizar(
      cfg,
      bruto({
        current_object: 'clipe_cabo id:3',
        objects: Array.from({ length: 20 }, (_, i) => ({ name: `clipe_cabo id:${i}`, polygon: [[0, 0]] })),
        excluded_objects: ['clipe_cabo id:1']
      })
    );
    const json = JSON.stringify(p);
    expect(json).not.toContain('polygon');
    expect(json).not.toContain('excluded_objects');
  });
});

describe('excluirPecaAtual', () => {
  it('pergunta pela atual em vez de mandar o nome', async () => {
    // o nome do fatiador tem espaço no meio, e parâmetro de G-code quebra ali
    const cliente = new MoonrakerClient(cfg);
    const enviados: string[] = [];
    cliente.gcode = async (script: string) => void enviados.push(script);

    await cliente.excluirPecaAtual();
    expect(enviados).toEqual(['EXCLUDE_OBJECT CURRENT=1']);
  });
});

describe('simulador', () => {
  it('a placa de várias peças tem uma em curso, e excluir passa para a seguinte', async () => {
    const cliente = criarClienteMock(cfg);

    const antes = normalizar(cfg, cliente.getEstado()).pecaAtual;
    expect(antes).toMatch(/^clipe_cabo id:\d+$/);

    await cliente.excluirPecaAtual();
    const depois = normalizar(cfg, cliente.getEstado()).pecaAtual;
    expect(depois).not.toBe(antes);
    expect(depois).toMatch(/^clipe_cabo id:\d+$/);
  });

  it('máquina de peça única segue sem peça nenhuma', () => {
    const p01: PrinterConfig = { ...cfg, id: 'P01' };
    expect(normalizar(p01, criarClienteMock(p01).getEstado()).pecaAtual).toBeNull();
  });

  it('excluir todas encerra a impressão, como no Klipper', async () => {
    const cliente = criarClienteMock(cfg);
    for (let i = 0; i < 12; i++) await cliente.excluirPecaAtual();

    const p = normalizar(cfg, cliente.getEstado());
    expect(p.pecaAtual).toBeNull();
    expect(p.status).toBe('ociosa');
  });
});
