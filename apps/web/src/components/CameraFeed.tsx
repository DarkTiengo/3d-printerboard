import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { VideoOff } from 'lucide-react';
import { urlCamera, urlSnapshot } from '../lib/api';
import { useT } from '../i18n';

type Modo = 'stream' | 'snapshot';

type Props = {
  printerId: string;
  temCamera: boolean;
  /** Quadros por segundo. No modo snapshot é a frequência do polling. */
  fps: number;
  /**
   * 'stream' abre um MJPEG e o mantém aberto; 'snapshot' busca um JPEG por vez.
   *
   * O padrão é snapshot porque o HTTP/1.1 dá ao navegador só 6 conexões por
   * origem: um MJPEG por tile consumiria todas — com o SSE e as chamadas da
   * própria API ficando na fila para sempre. Use 'stream' apenas no feed em
   * foco, no máximo um ou dois ao mesmo tempo.
   */
  modo?: Modo;
  /** Só carrega quando o elemento entra na viewport. */
  observarVisibilidade?: boolean;
  alt: string;
};

/**
 * A aba está à vista?
 *
 * O `IntersectionObserver` acima só sabe de rolagem: para ele um tile numa aba
 * minimizada continua visível. Isso importa porque as duas metades do feed se
 * comportam de formas diferentes quando ninguém está olhando. O polling de
 * snapshot é movido por `setTimeout`, e o navegador estrangula timer de aba de
 * fundo — ele desacelera sozinho. Já o MJPEG é um fluxo de rede dentro de um
 * `<img>`: nada o estrangula. Uma aba esquecida minimizada, um celular no
 * bolso ou uma TV na oficina seguiriam puxando quadros a taxa cheia e
 * segurando o upstream daquela câmera aberto no servidor por horas.
 *
 * Com isto, 10 segundos depois de a última pessoa desviar o olhar o linger do
 * hub fecha as conexões e a fazenda para de falar com as câmeras.
 */
function useAbaVisivel(): boolean {
  return useSyncExternalStore(
    (aoMudar) => {
      document.addEventListener('visibilitychange', aoMudar);
      return () => document.removeEventListener('visibilitychange', aoMudar);
    },
    () => !document.hidden,
    // no servidor não há aba; o valor não é usado, mas o hook exige o terceiro
    () => true
  );
}

export function CameraFeed({
  printerId,
  temCamera,
  fps,
  modo = 'snapshot',
  observarVisibilidade = true,
  alt
}: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(!observarVisibilidade);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!observarVisibilidade) return;
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(([entrada]) => setVisivel(entrada.isIntersecting), {
      // margem generosa: rolar a parede não deve piscar os tiles
      rootMargin: '200px'
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [observarVisibilidade]);

  const abaVisivel = useAbaVisivel();

  useEffect(() => setErro(false), [printerId, fps, modo]);

  // voltar para a aba dá uma nova chance a uma câmera que falhou enquanto
  // ninguém estava olhando — senão o tile fica em "sem sinal" até remontar
  useEffect(() => {
    if (abaVisivel) setErro(false);
  }, [abaVisivel]);

  // precisa ser estável: o SSE re-renderiza o painel várias vezes por segundo,
  // e um callback novo a cada render reiniciaria o loop de polling — cada
  // reinício dispara uma requisição na hora, ignorando o intervalo e enchendo
  // o pool de 6 conexões do navegador
  const aoFalhar = useCallback(() => setErro(true), []);

  const ativo = temCamera && !erro && visivel;
  const semImagem = !temCamera || erro;

  return (
    <div ref={ref} className={semImagem ? 'listrado' : undefined} style={{ position: 'absolute', inset: 0 }}>
      {ativo && modo === 'stream' && abaVisivel && (
        <img
          // a chave força uma conexão nova quando o fps muda
          key={`${printerId}-${fps}`}
          src={urlCamera(printerId, fps)}
          alt={alt}
          onError={() => setErro(true)}
          style={estiloImagem}
        />
      )}
      {ativo && modo === 'snapshot' && (
        /* pausado em vez de desmontado: o loop para, mas o último quadro fica
           na tela — voltar para a aba não pisca a parede inteira de preto */
        <SnapshotLoop
          printerId={printerId}
          fps={fps}
          alt={alt}
          pausado={!abaVisivel}
          aoFalhar={aoFalhar}
        />
      )}

      {semImagem && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--color-neutral-500)'
          }}
        >
          <VideoOff size={22} strokeWidth={2} aria-hidden />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em' }}>
            {temCamera ? t.cameras.semSinal : t.cameras.semCamera}
          </span>
        </div>
      )}
    </div>
  );
}

const estiloImagem: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block'
};

/**
 * Busca um JPEG de cada vez, encadeando: o próximo pedido só sai depois que o
 * anterior terminou. Uma câmera lenta atrasa a si mesma em vez de empilhar
 * requisições, e a imagem só troca depois de carregada — sem piscar.
 */
function SnapshotLoop({
  printerId,
  fps,
  alt,
  pausado,
  aoFalhar
}: {
  printerId: string;
  fps: number;
  alt: string;
  pausado: boolean;
  aoFalhar: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const falhasRef = useRef(0);

  // o callback fica numa ref para não entrar nas dependências do efeito
  const aoFalharRef = useRef(aoFalhar);
  aoFalharRef.current = aoFalhar;

  useEffect(() => {
    if (pausado) return;

    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const intervalo = 1000 / Math.max(0.1, fps);

    const buscar = () => {
      if (!vivo) return;
      const inicio = Date.now();
      const url = urlSnapshot(printerId, inicio, Math.round(intervalo * 0.8));

      const img = new Image();
      img.onload = () => {
        if (!vivo) return;
        falhasRef.current = 0;
        setSrc(url);
        timer = setTimeout(buscar, Math.max(0, intervalo - (Date.now() - inicio)));
      };
      img.onerror = () => {
        if (!vivo) return;
        falhasRef.current++;
        // três falhas seguidas: mostra "sem sinal" em vez de martelar a câmera
        if (falhasRef.current >= 3) {
          aoFalharRef.current();
          return;
        }
        timer = setTimeout(buscar, 2000);
      };
      img.src = url;
    };

    buscar();
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
  }, [printerId, fps, pausado]);

  if (!src) return null;
  return <img src={src} alt={alt} style={estiloImagem} />;
}
