import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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

const fontes = () => (cameras as any).fontes as Map<string, any>;

/** Injeta um quadro em cache com a idade pedida, sem abrir rede. */
function semearQuadro(printerId: string, jpeg: Buffer | null, idadeMs: number, extra: Record<string, unknown> = {}) {
  fontes().set(printerId, {
    url: mundo.cameraUrl,
    abort: null,
    demux: { push: () => [], reset: () => {} },
    assinantes: new Set(),
    ultimoFrame: jpeg,
    ultimoFrameEm: Date.now() - idadeMs,
    online: true,
    reconectarEm: null,
    tentativas: 0,
    lingerEm: null,
    ultimaFalhaEm: 0,
    ultimoPedidoEm: Date.now(),
    ...extra
  });
}

/** Fonte de uma câmera que já falhou e ainda não voltou. */
function semearCaida(printerId: string, jpeg: Buffer | null) {
  semearQuadro(printerId, jpeg, 60_000, { online: false, ultimaFalhaEm: Date.now() - 1_000 });
}

const QUADRO = Buffer.from([0xff, 0xd8, 0xff, 0x41, 0xff, 0xd9]);

beforeEach(() => {
  mundo.cameraUrl = 'http://camera.local/stream';
  fontes().clear();
});

// não deixar temporizador de reconexão vivo entre os testes
afterEach(() => {
  for (const fonte of fontes().values()) {
    if (fonte.reconectarEm) clearTimeout(fonte.reconectarEm);
    if (fonte.lingerEm) clearTimeout(fonte.lingerEm);
  }
  fontes().clear();
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

  it('não espera o timeout quando a câmera já falhou e continua fora', async () => {
    // é o caso do switch caído: o host aceita o TCP e nunca responde. Antes,
    // cada tile da parede segurava a requisição por 8 s e afogava as 6
    // conexões que o navegador dá por origem — a API do painel ia junto.
    semearCaida('P01', QUADRO);

    const inicio = Date.now();
    const resultado = await cameras.capturar('P01', 400, 5_000);

    expect(Date.now() - inicio).toBeLessThan(200);
    // devolve o mesmo que devolveria depois de esperar: o último quadro conhecido
    expect(resultado).toEqual(QUADRO);
  });

  it('devolve null na hora quando a câmera caiu sem nunca ter dado um quadro', async () => {
    semearCaida('P01', null);

    const inicio = Date.now();
    await expect(cameras.capturar('P01', 400, 5_000)).resolves.toBeNull();
    expect(Date.now() - inicio).toBeLessThan(200);
  });

  it('câmera caída continua com uma reconexão agendada', async () => {
    // sem isto o atalho seria uma armadilha: ninguém assina, ninguém tenta
    // reconectar, e a câmera ficaria morta mesmo depois de a rede voltar
    semearCaida('P01', QUADRO);
    await cameras.capturar('P01', 400, 5_000);

    expect(fontes().get('P01').reconectarEm).not.toBeNull();
  });

  it('não usa o atalho numa fonte que ainda não falhou nenhuma vez', async () => {
    /*
     * Offline mas sem falha registrada é o estado de quem acabou de nascer: aí
     * é preciso mesmo tentar, não responder "não deu" de graça.
     *
     * Sem quadro em cache de propósito — com um quadro guardado o `assinar` já
     * o entrega num microtask e a captura assenta na hora, com ou sem atalho.
     * É justamente a fonte que nunca deu quadro nenhum que ficava presa no
     * timeout inteiro, e é o único caso em que a espera é legítima.
     */
    semearQuadro('P01', null, 60_000, { online: false, ultimaFalhaEm: 0 });

    const inicio = Date.now();
    await expect(cameras.capturar('P01', 400, 400)).resolves.toBeNull();

    expect(Date.now() - inicio).toBeGreaterThanOrEqual(350);
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
