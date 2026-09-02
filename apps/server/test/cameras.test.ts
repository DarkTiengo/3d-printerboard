import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Regressão do bug que travava a fazenda inteira: `capturar` não resolvia
 * quando havia um quadro em cache mais velho que `maxIdade`. A resposta HTTP
 * nunca era enviada, o soquete ficava preso, e depois de seis desses o
 * navegador não tinha mais conexão para nenhuma chamada da API.
 */

const mundo = vi.hoisted(() => ({ cameraUrl: 'http://camera.local/stream' as string | null }));

vi.mock('../src/services/printers.repo.js', () => ({
  acharPrinter: (id: string) => ({ id, nome: id, cameraUrl: mundo.cameraUrl, backupEnabled: true, ordem: 0 })
}));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const { cameras } = await import('../src/services/cameras.js');

/** Injeta um quadro em cache com a idade pedida, sem abrir rede. */
function semearQuadro(printerId: string, jpeg: Buffer, idadeMs: number) {
  const fontes = (cameras as any).fontes as Map<string, any>;
  fontes.set(printerId, {
    url: mundo.cameraUrl,
    abort: null,
    demux: { push: () => [], reset: () => {} },
    assinantes: new Set(),
    ultimoFrame: jpeg,
    ultimoFrameEm: Date.now() - idadeMs,
    online: true,
    reconectarEm: null,
    tentativas: 0,
    lingerEm: null
  });
}

const QUADRO = Buffer.from([0xff, 0xd8, 0xff, 0x41, 0xff, 0xd9]);

beforeEach(() => {
  mundo.cameraUrl = 'http://camera.local/stream';
  ((cameras as any).fontes as Map<string, any>).clear();
});

describe('cameras.capturar', () => {
  it('devolve o quadro em cache quando ele é novo o bastante', async () => {
    semearQuadro('P01', QUADRO, 100);
    await expect(cameras.capturar('P01', 800)).resolves.toEqual(QUADRO);
  });

  it('resolve mesmo quando o quadro em cache está velho — não pode travar', async () => {
    // este é o caso do bug: cache existe, mas mais velho que maxIdade.
    // Antes, a promessa nunca assentava e a requisição ficava pendurada.
    semearQuadro('P01', QUADRO, 5_000);

    const resultado = await Promise.race([
      cameras.capturar('P01', 400, 1_000),
      new Promise((_, rej) => setTimeout(() => rej(new Error('capturar travou')), 3_000))
    ]);

    expect(resultado).toEqual(QUADRO);
  });

  it('não deixa assinante para trás depois de capturar', async () => {
    semearQuadro('P01', QUADRO, 5_000);
    await cameras.capturar('P01', 400, 1_000);

    const fonte = ((cameras as any).fontes as Map<string, any>).get('P01');
    expect(fonte.assinantes.size).toBe(0);
  });

  it('devolve null quando a impressora não tem câmera', async () => {
    mundo.cameraUrl = null;
    await expect(cameras.capturar('P09', 400, 500)).resolves.toBeNull();
  });

  it('várias capturas seguidas no mesmo quadro velho todas resolvem', async () => {
    semearQuadro('P01', QUADRO, 5_000);

    const todas = await Promise.race([
      Promise.all([0, 1, 2, 3, 4, 5].map(() => cameras.capturar('P01', 400, 1_000))),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('alguma travou')), 4_000))
    ]);

    expect(todas).toHaveLength(6);
    expect(todas.every((q) => q !== null)).toBe(true);
  });
});
