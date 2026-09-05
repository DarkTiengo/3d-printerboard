import { describe, expect, it } from 'vitest';
import type { PrinterConfig } from '@3dfarm/shared';
import { MoonrakerClient, nomeDePecaValido, paraParametro } from '../src/moonraker/client.js';
import { mesaDePecas, normalizar } from '../src/moonraker/normalize.js';
import { criarClienteMock } from '../src/moonraker/mock.js';

/**
 * O mapa da mesa — a fase 2 do `[exclude_object]`.
 *
 * A geometria não entra no snapshot: sai daqui, sob demanda. E o nome que volta
 * para o G-code é sempre o que a impressora reportou, nunca o que o navegador
 * pediu — é por isso que a rota casa um com o outro antes de mandar.
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

function bruto(objetos: Record<string, unknown>) {
  return {
    conectado: true,
    klippy: 'ready' as const,
    macros: [],
    limites: {},
    ultimoErro: null,
    mensagemKlippy: null,
    objetos: { print_stats: { state: 'printing', filename: 'a.gcode' }, ...objetos }
  };
}

const TRES_PECAS = {
  objects: [
    { name: 'clipe id:0', center: [30, 40], polygon: [[20, 30], [40, 30], [40, 50], [20, 50]] },
    { name: 'clipe id:1', center: [80, 40] },
    { name: 'clipe id:2', center: [130, 40], polygon: [[120, 30], [140, 30], [140, 50]] }
  ],
  excluded_objects: ['clipe id:0'],
  current_object: 'clipe id:1'
};

describe('mesaDePecas', () => {
  it('traz nome, geometria e quem já saiu', () => {
    const mesa = mesaDePecas(bruto({ exclude_object: TRES_PECAS }));

    expect(mesa.pecas.map((p) => p.nome)).toEqual(['clipe id:0', 'clipe id:1', 'clipe id:2']);
    expect(mesa.pecas[0]).toMatchObject({ centro: [30, 40], excluida: true, atual: false });
    expect(mesa.pecas[0].contorno).toHaveLength(4);
    expect(mesa.pecas[1]).toMatchObject({ excluida: false, atual: true });
  });

  it('peça sem polígono continua na lista — dá para excluir sem saber desenhar', () => {
    const semDesenho = mesaDePecas(bruto({ exclude_object: TRES_PECAS })).pecas[1];
    expect(semDesenho.contorno).toEqual([]);
    expect(semDesenho.centro).toEqual([80, 40]);
  });

  it('os limites da mesa vêm do toolhead, que já está assinado', () => {
    const mesa = mesaDePecas(
      bruto({ exclude_object: TRES_PECAS, toolhead: { axis_minimum: [0, 0, 0, 0], axis_maximum: [220, 220, 250, 0] } })
    );
    expect(mesa.limites).toEqual({ minX: 0, minY: 0, maxX: 220, maxY: 220 });
  });

  it('sem toolhead não inventa limites — o mapa se acerta pelas peças', () => {
    expect(mesaDePecas(bruto({ exclude_object: TRES_PECAS })).limites).toBeNull();
  });

  it('máquina sem exclude_object devolve mesa vazia, e não um erro', () => {
    expect(mesaDePecas(bruto({}))).toEqual({ limites: null, pecas: [] });
  });

  it('entrada sem nome é descartada: sem nome não há como excluir', () => {
    const mesa = mesaDePecas(bruto({ exclude_object: { objects: [{ polygon: [[0, 0]] }, { name: 'ok' }] } }));
    expect(mesa.pecas.map((p) => p.nome)).toEqual(['ok']);
  });
});

describe('temPecas no snapshot', () => {
  it('é verdadeiro com a mesa rotulada, mesmo no vão entre duas peças', () => {
    const p = normalizar(cfg, bruto({ exclude_object: { objects: [{ name: 'a' }], current_object: '' } }));
    expect(p.temPecas).toBe(true);
    expect(p.pecaAtual).toBeNull();
  });

  it('é falso quando o arquivo não tem rótulo nenhum', () => {
    expect(normalizar(cfg, bruto({ exclude_object: { objects: [] } })).temPecas).toBe(false);
    expect(normalizar(cfg, bruto({})).temPecas).toBe(false);
  });

  it('a geometria continua fora do snapshot', () => {
    const json = JSON.stringify(normalizar(cfg, bruto({ exclude_object: TRES_PECAS })));
    expect(json).not.toContain('polygon');
    expect(json).not.toContain('20,30');
  });
});

describe('nome de peça no G-code', () => {
  it('nome de uma palavra vai cru, como no HEATER=', () => {
    expect(paraParametro('chaveiro')).toBe('chaveiro');
  });

  it('nome com espaço vai entre aspas — senão o parâmetro terminaria no espaço', () => {
    expect(paraParametro('Shape-Box id:0 copy 1')).toBe('"Shape-Box id:0 copy 1"');
  });

  it('aspa dentro do nome é escapada, não deixada solta', () => {
    expect(paraParametro('peça "boa" 2')).toBe('"peça \\"boa\\" 2"');
  });

  it('recusa o que não cabe numa linha de G-code', () => {
    expect(nomeDePecaValido('clipe id:3')).toBe(true);
    for (const ruim of ['a;b', 'a#b', 'a*b', 'a\nb', '  ']) expect(nomeDePecaValido(ruim)).toBe(false);
  });

  it('excluirPeca manda o NAME=, e excluirPecaAtual segue no CURRENT=1', async () => {
    const cliente = new MoonrakerClient(cfg);
    const enviados: string[] = [];
    cliente.gcode = async (script: string) => void enviados.push(script);

    await cliente.excluirPeca('clipe id:3');
    await cliente.excluirPecaAtual();
    expect(enviados).toEqual(['EXCLUDE_OBJECT NAME="clipe id:3"', 'EXCLUDE_OBJECT CURRENT=1']);
  });
});

describe('simulador', () => {
  it('a mesa falsa tem geometria e limites, senão o mapa não teria o que desenhar', () => {
    const mesa = mesaDePecas(criarClienteMock(cfg).getEstado());

    expect(mesa.pecas).toHaveLength(12);
    expect(mesa.limites).toEqual({ minX: 0, minY: 0, maxX: 220, maxY: 220 });
    expect(mesa.pecas.every((p) => p.contorno.length === 4 && p.centro)).toBe(true);
    expect(mesa.pecas.filter((p) => p.atual)).toHaveLength(1);
  });

  it('excluir pelo nome tira aquela peça e deixa a em curso onde estava', async () => {
    const cliente = criarClienteMock(cfg);
    const antes = mesaDePecas(cliente.getEstado());
    const atual = antes.pecas.find((p) => p.atual)!.nome;
    // uma peça depois da atual: no simulador a em curso anda pelo índice das
    // vivas, e tirar uma de trás não a desloca — como no Klipper de verdade
    const outra = antes.pecas[antes.pecas.length - 1].nome;
    expect(outra).not.toBe(atual);

    await cliente.excluirPeca(outra);

    const depois = mesaDePecas(cliente.getEstado());
    expect(depois.pecas.find((p) => p.nome === outra)!.excluida).toBe(true);
    expect(depois.pecas.find((p) => p.atual)!.nome).toBe(atual);
  });

  it('nome que não está na mesa não exclui nada', async () => {
    const cliente = criarClienteMock(cfg);
    await cliente.excluirPeca('peça que não existe');
    expect(mesaDePecas(cliente.getEstado()).pecas.some((p) => p.excluida)).toBe(false);
  });
});
