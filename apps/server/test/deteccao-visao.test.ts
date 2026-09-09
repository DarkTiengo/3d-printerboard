import { describe, expect, it, vi } from 'vitest';
import jpeg from 'jpeg-js';

/**
 * O preparo do quadro e a leitura da saída do modelo.
 *
 * O que motivou o arquivo: os dois são o tipo de código que erra em silêncio.
 * Ler o eixo trocado na saída do YOLO devolve 0 para sempre, e a detecção
 * simplesmente nunca dispara — sem log, sem erro, sem nada que denuncie. Girar
 * para o lado errado é pior ainda: o modelo continua respondendo, só que sobre
 * uma cena de cabeça para baixo, e a nota cai sem explicação.
 *
 * A rotação importa aqui porque no GridFarm ela é só CSS no navegador: os
 * quadros que chegam ao servidor vêm sempre como a câmera mandou, e é este
 * arquivo que a aplica antes do modelo ver a cena.
 */

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const { maiorConfianca, preparar } = await import('../src/lib/visao.js');

const LADO = 320;

/** Um pixel do tensor CHW que `preparar` devolve. */
function amostra(t: Float32Array, x: number, y: number, canal = 0): number {
  return t[canal * LADO * LADO + y * LADO + x];
}

/**
 * 64×32 com o quadrante superior esquerdo branco e o resto preto.
 *
 * Assimétrico de propósito: um quadro simétrico passaria em qualquer rotação,
 * inclusive na errada.
 */
function quadroDeTeste(): Buffer {
  const w = 64;
  const h = 32;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const claro = x < w / 2 && y < h / 2;
      const v = claro ? 255 : 0;
      const o = (y * w + x) * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  return jpeg.encode({ data: rgba, width: w, height: h }, 100).data;
}

describe('preparo do quadro', () => {
  const jpegBuf = quadroDeTeste();

  it('sem rotação, a mancha clara fica em cima e à esquerda', () => {
    const t = preparar(jpegBuf, 0);

    // 64×32 numa caixa de 320: ocupa a largura toda, com 80 de borda em cima
    expect(amostra(t, 40, 100)).toBeGreaterThan(0.8);
    expect(amostra(t, 280, 100)).toBeLessThan(0.2);
    expect(amostra(t, 40, 220)).toBeLessThan(0.2);
  });

  it('a borda do letterbox é o cinza do Ultralytics, não preto', () => {
    const t = preparar(jpegBuf, 0);

    // preto vira 0 e falsearia "fundo"; 114/255 é o que o modelo viu no treino
    expect(amostra(t, 160, 10)).toBeCloseTo(114 / 255, 2);
    expect(amostra(t, 160, 310)).toBeCloseTo(114 / 255, 2);
  });

  it('90° gira no sentido horário, igual ao CSS da tela', () => {
    const t = preparar(jpegBuf, 90);

    // deitado vira em pé: a mancha sai do canto superior esquerdo para o direito
    expect(amostra(t, 200, 80)).toBeGreaterThan(0.8);
    expect(amostra(t, 110, 80)).toBeLessThan(0.2);
    expect(amostra(t, 200, 240)).toBeLessThan(0.2);
  });

  it('180° põe a mancha embaixo e à direita', () => {
    const t = preparar(jpegBuf, 180);

    expect(amostra(t, 280, 220)).toBeGreaterThan(0.8);
    expect(amostra(t, 40, 100)).toBeLessThan(0.2);
  });

  it('270° é o contrário de 90°', () => {
    const t = preparar(jpegBuf, 270);

    expect(amostra(t, 110, 240)).toBeGreaterThan(0.8);
    expect(amostra(t, 200, 80)).toBeLessThan(0.2);
  });

  it('devolve os três canais no formato que o modelo espera', () => {
    const t = preparar(jpegBuf, 0);

    expect(t).toHaveLength(3 * LADO * LADO);
    // a mancha é branca: os três canais concordam
    expect(amostra(t, 40, 100, 1)).toBeGreaterThan(0.8);
    expect(amostra(t, 40, 100, 2)).toBeGreaterThan(0.8);
  });
});

describe('leitura da saída do modelo', () => {
  const ANCORAS = 2100;
  const CANAIS = 7; // 4 da caixa + 3 classes

  it('lê o layout padrão do export do Ultralytics, [1, C, N]', () => {
    const dados = new Float32Array(CANAIS * ANCORAS);
    dados[(4 + 0) * ANCORAS + 17] = 0.83; // classe 0 numa âncora qualquer
    dados[(4 + 1) * ANCORAS + 18] = 0.99; // outra classe, que deve ser ignorada

    expect(maiorConfianca(dados, [1, CANAIS, ANCORAS], 0)).toBeCloseTo(0.83, 5);
  });

  it('lê o mesmo tensor transposto, [1, N, C]', () => {
    const dados = new Float32Array(ANCORAS * CANAIS);
    dados[17 * CANAIS + 4 + 0] = 0.77;
    dados[18 * CANAIS + 4 + 2] = 0.99;

    expect(maiorConfianca(dados, [1, ANCORAS, CANAIS], 0)).toBeCloseTo(0.77, 5);
  });

  it('lê um export com NMS embutido, [1, N, 6]', () => {
    const n = 300;
    const dados = new Float32Array(n * 6);
    dados[0 * 6 + 4] = 0.66;
    dados[0 * 6 + 5] = 0; // classe 0
    dados[1 * 6 + 4] = 0.99;
    dados[1 * 6 + 5] = 1; // outra classe

    expect(maiorConfianca(dados, [1, n, 6], 0)).toBeCloseTo(0.66, 5);
  });

  it('cena limpa devolve zero, não lixo', () => {
    const dados = new Float32Array(CANAIS * ANCORAS);
    expect(maiorConfianca(dados, [1, CANAIS, ANCORAS], 0)).toBe(0);
  });

  it('classe que o modelo não tem é erro dito em voz alta', () => {
    const dados = new Float32Array(CANAIS * ANCORAS);
    // um modelo de 3 classes com DETECCAO_CLASSE=5 renderia 0 para sempre em
    // silêncio; melhor estourar na primeira análise
    expect(() => maiorConfianca(dados, [1, CANAIS, ANCORAS], 5)).toThrow(/DETECCAO_CLASSE/);
  });
});
