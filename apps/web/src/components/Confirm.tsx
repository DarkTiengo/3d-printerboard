import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../i18n';

/**
 * Confirmação para ações destrutivas — parada de emergência, restauração de
 * backup, remoção de impressora. O handoff pede isso explicitamente para a
 * parada de emergência (design/COMECE_AQUI.md § Cuidados).
 */
export function Confirm({
  aberto,
  titulo,
  descricao,
  rotuloConfirmar,
  perigoso = true,
  semCancelar = false,
  onConfirmar,
  onCancelar
}: {
  aberto: boolean;
  titulo: string;
  descricao: ReactNode;
  rotuloConfirmar?: string;
  perigoso?: boolean;
  /** Diálogo de aviso: só o botão de fechar, sem a escolha de cancelar. */
  semCancelar?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const t = useT();
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    // foco no botão seguro: Enter distraído não dispara a ação destrutiva
    // (num aviso sem escolha, o único botão é o de fechar)
    (semCancelar ? confirmarRef : cancelarRef).current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, onCancelar, semCancelar]);

  if (!aberto) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={(e) => e.target === e.currentTarget && onCancelar()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(20, 19, 18, 0.72)'
      }}
    >
      <div
        style={{
          width: 'min(460px, 100%)',
          background: 'var(--color-text)',
          border: '2px solid var(--color-neutral-700)',
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}
      >
        <h2 style={{ fontSize: 22, letterSpacing: '-0.01em' }}>{titulo}</h2>
        <div style={{ fontSize: 14, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{descricao}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            ref={cancelarRef}
            type="button"
            onClick={onCancelar}
            hidden={semCancelar}
            style={{
              border: '1px solid var(--color-neutral-700)',
              background: 'transparent',
              color: 'var(--color-bg)',
              borderRadius: 999,
              padding: '11px 20px',
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            {t.comum.cancelar}
          </button>
          <button
            ref={confirmarRef}
            type="button"
            onClick={onConfirmar}
            style={{
              border: 0,
              background: perigoso ? 'var(--color-accent)' : 'var(--color-neutral-700)',
              color: 'var(--color-bg)',
              borderRadius: 999,
              padding: '11px 20px',
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            {rotuloConfirmar ?? t.comum.confirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
