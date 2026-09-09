import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * O arquivo do modelo: como chega e como se sabe que é o certo.
 *
 * O que motivou o arquivo: um download interrompido pela metade que ficasse
 * com o nome final seria carregado no próximo boot como se estivesse inteiro,
 * e o erro apareceria longe daqui — dentro do runtime de WebAssembly, num log
 * que ninguém liga à noite em que a rede caiu. Por isso a gravação é atômica e
 * o SHA-256 é conferido antes de o arquivo ganhar o nome definitivo.
 *
 * E o caso mais comum de todos precisa ser silencioso: sem modelo no disco o
 * recurso fica desligado, sem lançar nada. É o estado de quem nunca ligou a
 * detecção, que é a maioria.
 */

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

// o agente da fazenda arrasta mDNS junto; aqui só interessa o fetch
vi.mock('../src/lib/http-agent.js', () => ({ agenteDaFazenda: undefined }));

const { config } = await import('../src/config.js');
const modelo = await import('../src/services/modelo.js');

const CONTEUDO = Buffer.from('onnx-de-mentira, mas com bytes de verdade');
const SHA = createHash('sha256').update(CONTEUDO).digest('hex');

let tmp: string;
let modelosDirOriginal: string;
let urlOriginal: string;
let shaOriginal: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gridfarm-modelo-'));
  modelosDirOriginal = config.modelosDir;
  urlOriginal = config.deteccaoModeloUrl;
  shaOriginal = config.deteccaoModeloSha256;
  config.modelosDir = tmp;
  config.deteccaoModeloUrl = 'http://exemplo.invalido/falhas-v1.onnx';
  config.deteccaoModeloSha256 = SHA;
  modelo._limparEstadoDoModelo();
});

afterEach(() => {
  config.modelosDir = modelosDirOriginal;
  config.deteccaoModeloUrl = urlOriginal;
  config.deteccaoModeloSha256 = shaOriginal;
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function responder(corpo: Buffer, ok = true): void {
  vi.stubGlobal('fetch', async () => ({
    ok,
    status: ok ? 200 : 503,
    arrayBuffer: async () => corpo.buffer.slice(corpo.byteOffset, corpo.byteOffset + corpo.byteLength)
  }));
}

describe('estado do modelo', () => {
  it('sem arquivo e sem tentativa, está apenas ausente — não é erro', async () => {
    const e = await modelo.estadoDoModelo();
    expect(e.estado).toBe('ausente');
    expect(e.erro).toBeNull();
    expect(await modelo.modeloPronto()).toBe(false);
  });

  it('sem URL configurada, a tela sabe que não há de onde baixar', async () => {
    config.deteccaoModeloUrl = '';
    const e = await modelo.estadoDoModelo();
    expect(e.podeBaixar).toBe(false);
  });

  it('um arquivo posto na pasta na mão conta como pronto', async () => {
    fs.writeFileSync(modelo.caminhoDoModelo(), CONTEUDO);
    expect(await modelo.modeloPronto()).toBe(true);
    expect((await modelo.estadoDoModelo()).estado).toBe('pronto');
  });
});

describe('download', () => {
  it('grava o arquivo quando o checksum confere', async () => {
    responder(CONTEUDO);

    const e = await modelo.baixarModelo();

    expect(e.estado).toBe('pronto');
    expect(e.bytes).toBe(CONTEUDO.byteLength);
    expect(fs.readFileSync(modelo.caminhoDoModelo())).toEqual(CONTEUDO);
  });

  it('checksum diferente recusa o arquivo e não deixa nada para trás', async () => {
    config.deteccaoModeloSha256 = 'f'.repeat(64);
    responder(CONTEUDO);

    const e = await modelo.baixarModelo();

    expect(e.estado).toBe('erro');
    expect(e.erro).toContain('SHA-256');
    expect(fs.existsSync(modelo.caminhoDoModelo())).toBe(false);
    // nem o parcial: um .parcial esquecido enche o volume de graça
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('servidor que recusa vira erro legível, não exceção', async () => {
    responder(Buffer.alloc(0), false);

    const e = await modelo.baixarModelo();

    expect(e.estado).toBe('erro');
    expect(e.erro).toContain('503');
  });

  it('download vazio não vira um modelo de zero byte', async () => {
    responder(Buffer.alloc(0));

    const e = await modelo.baixarModelo();

    expect(e.estado).toBe('erro');
    expect(fs.existsSync(modelo.caminhoDoModelo())).toBe(false);
  });

  it('sem URL não tenta buscar nada', async () => {
    config.deteccaoModeloUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('não deveria ter sido chamado');
      })
    );

    const e = await modelo.baixarModelo();

    expect(e.estado).toBe('erro');
    expect(e.erro).toContain('DETECCAO_MODELO_URL');
  });

  it('dois cliques no botão baixam uma vez só', async () => {
    const buscar = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => CONTEUDO.buffer.slice(CONTEUDO.byteOffset, CONTEUDO.byteOffset + CONTEUDO.byteLength)
    }));
    vi.stubGlobal('fetch', buscar);

    await Promise.all([modelo.baixarModelo(), modelo.baixarModelo()]);

    expect(buscar).toHaveBeenCalledTimes(1);
  });
});
