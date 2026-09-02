import { Thermometer } from 'lucide-react';
import type { Temperatura } from '@3dfarm/shared';

/** Temperaturas — design/README.md § 2.4: bico e mesa, "atual / alvo". */
export function TempList({ temperaturas }: { temperaturas: Temperatura[] }) {
  if (temperaturas.length === 0) return null;

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono">TEMPERATURAS</div>
      {temperaturas.map((t) => (
        <div key={t.item} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Thermometer size={14} strokeWidth={2} aria-hidden style={{ color: 'var(--color-neutral-400)' }} />
          <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-heading)', minWidth: 44 }}>
            {t.item}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginLeft: 'auto' }}>
            {t.atual}
            <span style={{ color: 'var(--color-neutral-500)' }}> / {t.alvo}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
