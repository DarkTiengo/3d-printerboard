import { useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';
import { urlCamera, urlSnapshot } from '../lib/api';

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

export function CameraFeed({
  printerId,
  temCamera,
  fps,
  modo = 'snapshot',
  observarVisibilidade = true,
  alt
}: Props) {
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

  useEffect(() => setErro(false), [printerId, fps, modo]);

  const ativo = temCamera && !erro && visivel;
  const semImagem = !temCamera || erro;

  return (
    <div ref={ref} className={semImagem ? 'listrado' : undefined} style={{ position: 'absolute', inset: 0 }}>
      {ativo && modo === 'stream' && (
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
        <SnapshotLoop printerId={printerId} fps={fps} alt={alt} aoFalhar={() => setErro(true)} />
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
            {temCamera ? 'SEM SINAL' : 'SEM CÂMERA'}
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
  aoFalhar
}: {
  printerId: string;
  fps: number;
  alt: string;
  aoFalhar: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const falhasRef = useRef(0);

  useEffect(() => {
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
          aoFalhar();
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
  }, [printerId, fps, aoFalhar]);

  if (!src) return null;
  return <img src={src} alt={alt} style={estiloImagem} />;
}
