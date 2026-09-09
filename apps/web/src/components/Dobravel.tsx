import { ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '../i18n';

/**
 * Uma seção do painel que se recolhe.
 *
 * Existe para as duas seções compridas — o gráfico e o console —, que somadas
 * dobram a altura da coluna. Cada uma delas também busca dados ao abrir, então
 * recolher não é só esconder: é deixar de pedir.
 *
 * O cabeçalho inteiro é o botão, com a mesma tipografia mono das outras seções
 * — o triângulo é a única marca de que ali se clica.
 */
export function Dobravel({
  titulo,
  aberto,
  aoAlternar,
  legenda,
  children
}: {
  titulo: string;
  aberto: boolean;
  aoAlternar: () => void;
  /** Texto curto à direita do título: a janela do gráfico, a contagem de linhas. */
  legenda?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const Seta = aberto ? ChevronDown : ChevronRight;

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        type="button"
        onClick={aoAlternar}
        aria-expanded={aberto}
        aria-label={aberto ? t.comum.esconder(titulo) : t.comum.mostrar(titulo)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          border: 0,
          background: 'transparent',
          padding: 0,
          cursor: 'pointer',
          color: 'inherit',
          textAlign: 'left'
        }}
      >
        <Seta size={13} strokeWidth={2} aria-hidden style={{ color: 'var(--color-neutral-400)', flex: 'none' }} />
        <span className="mono">{titulo}</span>
        {legenda && (
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-neutral-500)'
            }}
          >
            {legenda}
          </span>
        )}
      </button>
      {aberto && children}
    </section>
  );
}
