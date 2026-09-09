import { createRequire } from 'node:module';
import path from 'node:path';
import jpeg from 'jpeg-js';
import type { InferenceSession, Tensor, TypedTensor } from 'onnxruntime-web';
import type { RotacaoCamera } from '@gridfarm/shared';
import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * A camada que transforma um JPEG numa nota de 0 a 1: "o quanto isto parece
 * espaguete".
 *
 * Fica isolada atrás de `classificar` de propósito. O detector que decide
 * pausar impressão não deve saber o que é um tensor, e os testes trocam esta
 * função por uma que devolve o número que eles querem — assim a suíte continua
 * rodando em milissegundos, sem carregar 11 MB de WebAssembly.
 *
 * Por que WASM e não binário nativo: a imagem é `node:22-alpine`, ou seja musl,
 * e o `onnxruntime-node` não publica build musl. O `onnxruntime-web` é o mesmo
 * runtime compilado para WebAssembly — roda igual em x64 e arm64, sem
 * dependência nativa nova no projeto, ao custo de ~2× o tempo de inferência.
 * A 0,3 análise por segundo, esse custo não aparece.
 */

/** Lado da entrada do modelo. 320 e não 640: são ~4× menos contas. */
const LADO = 320;

/** O cinza com que o Ultralytics preenche a borda do letterbox. */
const CINZA = 114;

/** Sessão parada por mais tempo que isto é liberada — são ~120 MB de RAM. */
const OCIOSA_MS = 10 * 60_000;

type Sessao = Pick<InferenceSession, 'run' | 'inputNames' | 'outputNames' | 'release'>;

let sessao: Sessao | null = null;
let carregando: Promise<Sessao> | null = null;
let liberarEm: NodeJS.Timeout | null = null;
/** Serializa as chamadas: nunca há duas inferências ao mesmo tempo. */
let fila: Promise<unknown> = Promise.resolve();
let ultimaMs = 0;
/** O layout da saída só é logado uma vez, na primeira inferência. */
let layoutLogado = false;

export type EstadoVisao = { carregada: boolean; ultimaMs: number };

export function estadoDaVisao(): EstadoVisao {
  return { carregada: sessao != null, ultimaMs };
}

/** Descarrega o modelo. Chamado pelo relógio de ociosidade e no encerramento. */
export async function liberarVisao(): Promise<void> {
  if (liberarEm) {
    clearTimeout(liberarEm);
    liberarEm = null;
  }
  const s = sessao;
  sessao = null;
  carregando = null;
  if (s) {
    try {
      await s.release();
      logger.debug('modelo de detecção descarregado por ociosidade');
    } catch {
      /* liberar é melhor-esforço: o processo pode estar encerrando */
    }
  }
}

function adiarLiberacao(): void {
  if (liberarEm) clearTimeout(liberarEm);
  liberarEm = setTimeout(() => void liberarVisao(), OCIOSA_MS);
  liberarEm.unref();
}

async function abrirSessao(caminho: string): Promise<Sessao> {
  if (sessao) return sessao;
  if (carregando) return carregando;

  carregando = (async () => {
    /*
     * Import dinâmico: com o recurso desligado — que é o padrão — o runtime de
     * WebAssembly nunca é lido do disco nem ocupa memória.
     */
    const ort = await import('onnxruntime-web');

    /*
     * Em Node não existe URL base para o runtime achar o .wasm ao lado do .js,
     * então o caminho vai na mão. `require.resolve` cai em dist/ort.node.min.js
     * e o diretório dele é onde os dois arquivos moram.
     */
    const require = createRequire(import.meta.url);
    ort.env.wasm.wasmPaths = path.dirname(require.resolve('onnxruntime-web')) + path.sep;
    ort.env.wasm.numThreads = Math.max(1, config.deteccaoThreads);
    ort.env.logLevel = 'error';

    const bytes = await (await import('node:fs/promises')).readFile(caminho);
    const s = await ort.InferenceSession.create(new Uint8Array(bytes), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    logger.info(
      { entrada: s.inputNames[0], threads: config.deteccaoThreads },
      `modelo de detecção carregado (${(bytes.byteLength / 1048576).toFixed(1)} MB)`
    );
    sessao = s;
    return s;
  })();

  try {
    return await carregando;
  } catch (err) {
    carregando = null;
    throw err;
  }
}

/**
 * Decodifica, gira e encaixa o quadro na entrada do modelo, numa passada só.
 *
 * Uma passada porque cada pixel de destino busca o seu na origem: girar,
 * redimensionar e preencher a borda viram a mesma conta de índice, sem imagem
 * intermediária. Numa webcam de 640×480 isso são ~300 k leituras — dezenas de
 * milissegundos, contra os ~800 ms da inferência que vem depois.
 */
export function preparar(jpegBuf: Buffer, rotacao: RotacaoCamera): Float32Array {
  const img = jpeg.decode(jpegBuf, { useTArray: true, formatAsRGBA: true });
  const { width: w, height: h, data } = img;

  // dimensões depois de girar; o quarto de volta troca os lados
  const meiaVolta = rotacao === 90 || rotacao === 270;
  const rw = meiaVolta ? h : w;
  const rh = meiaVolta ? w : h;

  const escala = Math.min(LADO / rw, LADO / rh);
  const nw = Math.round(rw * escala);
  const nh = Math.round(rh * escala);
  const padX = Math.floor((LADO - nw) / 2);
  const padY = Math.floor((LADO - nh) / 2);

  // CHW, que é o que o YOLO espera: os três canais em blocos, não intercalados
  const plano = LADO * LADO;
  const saida = new Float32Array(3 * plano);
  const cinza = CINZA / 255;
  saida.fill(cinza);

  for (let dy = 0; dy < nh; dy++) {
    const ry = Math.min(rh - 1, Math.floor(dy / escala));
    const linha = (dy + padY) * LADO + padX;

    for (let dx = 0; dx < nw; dx++) {
      const rx = Math.min(rw - 1, Math.floor(dx / escala));

      /*
       * Desfaz o giro: (rx, ry) é onde o pixel aparece na tela, e aqui
       * voltamos para onde ele está no quadro cru. A rotação do GridFarm é
       * horária — é `transform: rotate(Ndeg)` do CSS, veja web/src/lib/
       * rotacao.ts — e os quadros do servidor vêm sempre sem giro nenhum.
       */
      let sx: number;
      let sy: number;
      if (rotacao === 90) {
        sx = ry;
        sy = h - 1 - rx;
      } else if (rotacao === 180) {
        sx = w - 1 - rx;
        sy = h - 1 - ry;
      } else if (rotacao === 270) {
        sx = w - 1 - ry;
        sy = rx;
      } else {
        sx = rx;
        sy = ry;
      }

      const o = (sy * w + sx) * 4;
      const d = linha + dx;
      saida[d] = data[o] / 255;
      saida[plano + d] = data[o + 1] / 255;
      saida[2 * plano + d] = data[o + 2] / 255;
    }
  }

  return saida;
}

/**
 * A maior confiança da classe procurada em toda a saída do modelo.
 *
 * Não há NMS aqui, e nem faz falta: a pergunta é "tem espaguete nesta cena?",
 * não "quantos e onde". O máximo sobre todas as âncoras responde isso, e pula
 * a parte mais cara de um pós-processamento de YOLO.
 *
 * Os dois layouts que os exports do Ultralytics produzem são aceitos. O eixo
 * dos canais é sempre o menor: são 4 + nº de classes, contra ~2100 âncoras a
 * 320 px, então não há como confundir os dois.
 */
export function maiorConfianca(dados: Float32Array, dims: readonly number[], classe: number): number {
  if (dims.length !== 3) throw new Error(`saída do modelo com ${dims.length} dimensões, esperava 3`);
  const [, a, b] = dims;

  // export com NMS embutido: [1, N, 6] = x, y, x, y, confiança, classe
  if (b === 6 && a !== 6) {
    let melhor = 0;
    for (let i = 0; i < a; i++) {
      const base = i * 6;
      if (Math.round(dados[base + 5]) === classe) melhor = Math.max(melhor, dados[base + 4]);
    }
    if (!layoutLogado) logger.debug({ dims }, 'saída do modelo: NMS embutido');
    layoutLogado = true;
    return melhor;
  }

  const canais = Math.min(a, b);
  const ancoras = Math.max(a, b);
  const classes = canais - 4;
  if (classe >= classes) {
    throw new Error(`modelo tem ${classes} classe(s), mas DETECCAO_CLASSE aponta para a ${classe}`);
  }

  let melhor = 0;
  if (canais === a) {
    // [1, C, N] — o layout padrão do `yolo export format=onnx`
    const base = (4 + classe) * ancoras;
    for (let i = 0; i < ancoras; i++) melhor = Math.max(melhor, dados[base + i]);
  } else {
    // [1, N, C] — o mesmo tensor transposto
    for (let i = 0; i < ancoras; i++) melhor = Math.max(melhor, dados[i * canais + 4 + classe]);
  }

  if (!layoutLogado) logger.debug({ dims, classes }, 'saída do modelo lida');
  layoutLogado = true;
  return melhor;
}

/**
 * Um quadro entra, uma nota de 0 a 1 sai.
 *
 * As chamadas são serializadas: uma inferência por vez no processo inteiro. É
 * o que segura o custo numa fazenda de oito máquinas — o pico de CPU é o de
 * *uma* análise, não o de oito começando juntas.
 */
export function classificar(jpegBuf: Buffer, rotacao: RotacaoCamera, caminhoModelo: string): Promise<number> {
  const proxima = fila.then(async () => {
    const s = await abrirSessao(caminhoModelo);
    const entrada = preparar(jpegBuf, rotacao);

    const ort = await import('onnxruntime-web');
    const tensor = new ort.Tensor('float32', entrada, [1, 3, LADO, LADO]);

    const t0 = Date.now();
    const saida = await s.run({ [s.inputNames[0]]: tensor as Tensor });
    ultimaMs = Date.now() - t0;

    const primeira = saida[s.outputNames[0]] as TypedTensor<'float32'>;
    adiarLiberacao();
    return maiorConfianca(primeira.data, primeira.dims, config.deteccaoClasse);
  });

  // a fila não pode morrer com um erro, ou nenhuma análise seguinte roda
  fila = proxima.catch(() => undefined);
  return proxima;
}
