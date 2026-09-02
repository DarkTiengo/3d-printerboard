import { Thermometer } from 'lucide-react';
import type { Temperatura } from '@3dfarm/shared';
import { useT } from '../i18n';
import { useFormato } from '../i18n/formato';

/** Temperaturas — design/README.md § 2.4: bico e mesa, "atual / alvo". */
export function TempList({ temperaturas }: { temperaturas: Temperatura[] }) {
  const t = useT();
  const f = useFormato();
  if (temperaturas.length === 0) return null;

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono">{t.impressora.temperaturas}</div>
      {temperaturas.map((temp) => (
        <div key={temp.chave} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Thermometer size={14} strokeWidth={2} aria-hidden style={{ color: 'var(--color-neutral-400)' }} />
          <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-heading)', minWidth: 44 }}>
            {temp.chave === 'bico' ? t.impressora.bico : t.impressora.mesa}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginLeft: 'auto' }}>
            {f.temperatura(temp.atual)}
            <span style={{ color: 'var(--color-neutral-500)' }}> / {f.alvo(temp.alvo)}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
