import type { CSSProperties, ReactNode } from 'react';

/**
 * Pílula de status. Raio 0 — tags fazem parte do que o design system mantém
 * quadrado (design/README.md § Estrutura).
 */
export function Tag({
  children,
  bg,
  fg,
  style
}: {
  children: ReactNode;
  bg: string;
  fg: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: bg,
        color: fg,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.06em',
        padding: '3px 8px',
        borderRadius: 0,
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      {children}
    </span>
  );
}

/** Ponto de status 7–8px. Sempre acompanhado do texto, nunca sozinho. */
export function Ponto({ cor, tamanho = 7 }: { cor: string; tamanho?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: '50%',
        background: cor,
        flex: 'none',
        display: 'inline-block'
      }}
    />
  );
}
