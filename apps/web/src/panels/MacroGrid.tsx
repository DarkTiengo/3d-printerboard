import { Zap } from 'lucide-react';
import { api } from '../lib/api';

/** Macros — design/README.md § 2.6: grade de 2 colunas com ícone vermelho. */
export function MacroGrid({
  printerId,
  macros,
  desabilitado
}: {
  printerId: string;
  macros: string[];
  desabilitado: boolean;
}) {
  if (macros.length === 0) return null;

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono">MACROS</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {macros.slice(0, 8).map((m) => (
          <button
            key={m}
            type="button"
            disabled={desabilitado}
            onClick={() => void api.gcode(printerId, m).catch(() => {})}
            title={m}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              border: `1px solid ${desabilitado ? 'var(--color-neutral-800)' : 'var(--color-neutral-700)'}`,
              borderRadius: 999,
              background: 'transparent',
              color: desabilitado ? 'var(--color-neutral-700)' : 'var(--color-bg)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.04em',
              padding: '9px 12px',
              cursor: desabilitado ? 'not-allowed' : 'pointer',
              minWidth: 0
            }}
          >
            <Zap
              size={12}
              strokeWidth={2}
              aria-hidden
              style={{ color: desabilitado ? 'var(--color-neutral-700)' : 'var(--color-accent)', flex: 'none' }}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
