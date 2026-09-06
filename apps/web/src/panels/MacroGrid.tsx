import { Zap } from 'lucide-react';
import { MACROS_CARREGAR, MACROS_DESCARREGAR } from '@3dfarm/shared';
import { api } from '../lib/api';
import { useT } from '../i18n';

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
  const t = useT();

  /* Carregar e descarregar filamento têm lugar próprio, na extrusora, com
     rótulo e ícone. Repeti-las aqui gastaria duas das oito vagas da grade. */
  const naTroca = new Set([...MACROS_CARREGAR, ...MACROS_DESCARREGAR]);
  const lista = macros.filter((m) => !naTroca.has(m.toUpperCase()));
  if (lista.length === 0) return null;

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono">{t.impressora.macros}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {lista.slice(0, 8).map((m) => (
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
