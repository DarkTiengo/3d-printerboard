import { Maximize2 } from 'lucide-react';
import type { Printer } from '@3dfarm/shared';
import { CameraFeed } from './CameraFeed';
import { ProgressBar } from './ProgressBar';
import { Ponto } from './Tag';
import { corDoPonto, estiloStatus } from '../lib/status';
import { IconButton } from './IconButton';

/**
 * Tile da parede de câmeras — design/README.md § 2.
 * Feed 4:3, cantos com status e expandir, rodapé em gradiente com progresso.
 */
export function CameraTile({
  printer,
  selecionada,
  fps,
  aoSelecionar,
  aoExpandir
}: {
  printer: Printer;
  selecionada: boolean;
  fps: number;
  aoSelecionar: () => void;
  aoExpandir: () => void;
}) {
  const tag = estiloStatus(printer.status);

  return (
    <div
      style={{
        position: 'relative',
        outline: selecionada ? '2px solid var(--color-accent)' : '2px solid transparent',
        outlineOffset: -2,
        background: 'var(--color-neutral-900)'
      }}
    >
      {/* o feed é o fundo; o botão de seleção cobre o tile inteiro */}
      <div style={{ position: 'relative', aspectRatio: '4 / 3' }}>
        <CameraFeed
          printerId={printer.id}
          temCamera={printer.temTaCamera}
          fps={fps}
          alt={`Câmera de ${printer.nome} — ${tag.curto.toLowerCase()}`}
        />
      </div>

      <button
        type="button"
        onClick={aoSelecionar}
        aria-pressed={selecionada}
        aria-label={`Selecionar ${printer.nome} — ${tag.curto.toLowerCase()}, ${printer.pct}%`}
        style={{
          position: 'absolute',
          inset: 0,
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          padding: 0
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          pointerEvents: 'none',
          textShadow: '0 1px 3px rgba(0,0,0,.85)'
        }}
      >
        <Ponto cor={corDoPonto(printer.status, printer.online)} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em' }}>CAM {printer.id}</span>
      </div>

      <div style={{ position: 'absolute', top: 6, right: 6 }}>
        <IconButton
          rotulo={`Abrir ${printer.nome} em tela cheia`}
          variante="secundaria"
          pequeno
          onClick={aoExpandir}
          icone={<Maximize2 size={14} strokeWidth={2} aria-hidden />}
          style={{ background: 'rgba(32,30,29,.55)' }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '26px 12px 10px',
          background: 'linear-gradient(transparent, rgba(32,30,29,.92) 55%)',
          pointerEvents: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 15,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {printer.nome}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-neutral-300)'
            }}
          >
            {printer.online ? `${printer.pct}%` : 'OFFLINE'}
          </span>
        </div>
        <div style={{ marginTop: 7 }}>
          <ProgressBar pct={printer.pct} altura={3} rotulo={`${printer.nome}: ${printer.pct}%`} />
        </div>
      </div>
    </div>
  );
}
