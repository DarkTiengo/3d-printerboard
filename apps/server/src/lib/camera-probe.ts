import { MjpegDemuxer } from './mjpeg.js';
import { agenteDaFazenda } from './http-agent.js';

/**
 * Descoberta e teste de câmera.
 *
 * Perguntar ao Moonraker o que ele tem configurado é melhor que adivinhar: o
 * Mainsail e o Fluidd guardam as webcams no banco dele, e é essa a URL que já
 * funciona para a pessoa. Só quando não há nada configurado é que caímos nos
 * caminhos convencionais do crowsnest.
 */

export type CameraDescoberta = {
  nome: string;
  url: string;
  /** de onde veio: a configuração do Moonraker ou um palpite nosso */
  origem: 'moonraker' | 'convencao';
};

/** Caminhos que a esmagadora maioria das instalações usa. */
const CONVENCOES = [
  { nome: 'webcam', caminho: '/webcam/?action=stream' },
  { nome: 'webcam2', caminho: '/webcam2/?action=stream' },
  { nome: 'mjpg-streamer', porta: 8080, caminho: '/?action=stream' },
  { nome: 'mjpg-streamer (8081)', porta: 8081, caminho: '/?action=stream' }
];

/** Resolve uma URL possivelmente relativa contra o host do Moonraker. */
export function resolverUrlDaCamera(moonrakerUrl: string, url: string): string | null {
  try {
    const base = new URL(moonrakerUrl);
    // o stream quase nunca está na porta do Moonraker; relativo herda o host
    if (/^https?:\/\//i.test(url)) return new URL(url).toString();
    return new URL(url, `${base.protocol}//${base.hostname}${base.port ? `:${base.port}` : ''}`).toString();
  } catch {
    return null;
  }
}

/** Pergunta ao Moonraker quais webcams ele conhece. Lista vazia se não souber. */
export async function camerasDoMoonraker(
  moonrakerUrl: string,
  headers: Record<string, string>
): Promise<CameraDescoberta[]> {
  const base = moonrakerUrl.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);

  try {
    const res = await fetch(`${base}/server/webcams/list`, {
      headers,
      signal: ctrl.signal,
      dispatcher: agenteDaFazenda
    });
    if (!res.ok) return [];

    const corpo = (await res.json()) as { result?: { webcams?: any[] } };
    const webcams = corpo.result?.webcams ?? [];

    const achadas: CameraDescoberta[] = [];
    for (const w of webcams) {
      const bruta = w.stream_url || w.snapshot_url || w.urlStream || w.urlSnapshot;
      if (typeof bruta !== 'string' || !bruta) continue;
      const url = resolverUrlDaCamera(moonrakerUrl, bruta);
      if (!url) continue;
      achadas.push({ nome: String(w.name ?? 'webcam'), url, origem: 'moonraker' });
    }
    return achadas;
  } catch {
    // Moonraker antigo não tem esse endpoint; não é erro, só não sabemos
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export type QuadroCapturado = { jpeg: Buffer; tipo: string };

/**
 * Um quadro só de uma URL de câmera.
 *
 * Serve tanto para snapshot (`image/jpeg` direto) quanto para stream MJPEG —
 * neste caso lemos até o primeiro quadro fechar e abortamos, sem consumir o
 * fluxo inteiro.
 */
export async function capturarUmQuadro(url: string, timeoutMs = 8_000): Promise<QuadroCapturado> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: ctrl.signal, dispatcher: agenteDaFazenda });
    if (!res.ok) throw new Error(`respondeu ${res.status}`);

    const tipo = res.headers.get('content-type') ?? '';

    if (/^image\//i.test(tipo)) {
      const jpeg = Buffer.from(await res.arrayBuffer());
      if (jpeg.length === 0) throw new Error('imagem vazia');
      return { jpeg, tipo };
    }

    if (!/multipart/i.test(tipo)) {
      throw new Error(`não parece vídeo nem imagem (${tipo || 'sem tipo'})`);
    }
    if (!res.body) throw new Error('resposta sem corpo');

    const demux = new MjpegDemuxer();
    let lido = 0;
    let capturado: Buffer | null = null;

    for await (const pedaco of res.body as unknown as AsyncIterable<Uint8Array>) {
      lido += pedaco.length;
      const quadros = demux.push(Buffer.from(pedaco));
      if (quadros.length > 0) {
        capturado = quadros[0];
        // sair do laço basta; abortar aqui dentro faz o cancelamento do
        // iterador estourar um AbortError que atropelaria o quadro que já
        // temos em mãos
        break;
      }
      // um stream que nunca fecha um quadro não deve nos prender
      if (lido > 12 * 1024 * 1024) throw new Error('nenhum quadro completo no início do fluxo');
    }

    if (!capturado) throw new Error('o fluxo terminou sem um quadro completo');
    return { jpeg: capturado, tipo };
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error('sem resposta dentro do tempo limite');
    }
    const causa = err instanceof Error ? ((err as Error & { cause?: unknown }).cause as Error | undefined) : undefined;
    throw new Error(causa?.message || (err instanceof Error ? err.message : String(err)));
  } finally {
    clearTimeout(timer);
    // fecha o stream depois de já ter o quadro em mãos
    ctrl.abort();
  }
}

/**
 * Descobre a câmera de uma impressora: primeiro o que o Moonraker declara,
 * depois os caminhos convencionais. Só devolve o que realmente entregou imagem.
 */
export async function descobrirCamera(
  moonrakerUrl: string,
  headers: Record<string, string>
): Promise<{ camera: CameraDescoberta; jpeg: Buffer } | null> {
  const declaradas = await camerasDoMoonraker(moonrakerUrl, headers);

  const candidatas: CameraDescoberta[] = [...declaradas];
  for (const c of CONVENCOES) {
    const alvo = c.porta ? comPorta(moonrakerUrl, c.porta, c.caminho) : resolverUrlDaCamera(moonrakerUrl, c.caminho);
    if (alvo && !candidatas.some((x) => x.url === alvo)) {
      candidatas.push({ nome: c.nome, url: alvo, origem: 'convencao' });
    }
  }

  for (const candidata of candidatas) {
    try {
      // timeout curto: são várias tentativas em sequência
      const { jpeg } = await capturarUmQuadro(candidata.url, 5_000);
      return { camera: candidata, jpeg };
    } catch {
      // próxima
    }
  }
  return null;
}

function comPorta(moonrakerUrl: string, porta: number, caminho: string): string | null {
  try {
    const base = new URL(moonrakerUrl);
    return `${base.protocol}//${base.hostname}:${porta}${caminho}`;
  } catch {
    return null;
  }
}
