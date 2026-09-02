import type { User } from '@3dfarm/shared';
import { usePrintersVisiveis } from '../store/printers';
import { useUi } from '../store/ui';
import { CameraTile } from '../components/CameraTile';
import { PrinterPanel } from '../panels/PrinterPanel';
import { QueuePanel } from '../panels/QueuePanel';
import { useT } from '../i18n';

/**
 * Painel — tela inicial. Parede de câmeras à esquerda, coluna de 360px à direita
 * (fila quando não há seleção; mini painel quando há). design/README.md § 2.
 */
export function Dashboard({ usuario }: { usuario: User }) {
  const printers = usePrintersVisiveis();
  const sel = useUi((s) => s.sel);
  const selecionar = useUi((s) => s.selecionar);
  const focarCamera = useUi((s) => s.focarCamera);
  const irPara = useUi((s) => s.irPara);

  const selecionada = printers.find((p) => p.id === sel) ?? null;

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 2 }}>
        {printers.length === 0 ? (
          <Vazio />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 2
            }}
          >
            {printers.map((p) => (
              <CameraTile
                key={p.id}
                printer={p}
                selecionada={p.id === sel}
                /* a parede toda por snapshot; a selecionada já aparece ao vivo
                   no mini painel ao lado, então aqui basta 1 fps */
                fps={p.id === sel ? 1 : 2}
                aoSelecionar={() => selecionar(p.id === sel ? null : p.id)}
                aoExpandir={() => {
                  focarCamera(p.id);
                  selecionar(p.id);
                  irPara('cams');
                }}
              />
            ))}
          </div>
        )}
      </div>

      <aside
        style={{
          width: 'var(--painel-largura)',
          flex: 'none',
          borderLeft: '2px solid var(--color-neutral-700)',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {selecionada ? (
          <PrinterPanel printer={selecionada} usuario={usuario} aoFechar={() => selecionar(null)} />
        ) : (
          <QueuePanel usuario={usuario} />
        )}
      </aside>
    </div>
  );
}

function Vazio() {
  const t = useT();
  const irPara = useUi((s) => s.irPara);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 40,
        textAlign: 'center'
      }}
    >
      <div className="mono">{t.painel.semImpressoras}</div>
      <p style={{ maxWidth: 380, color: 'var(--color-neutral-300)', fontSize: 14, textWrap: 'pretty' }}>
        {t.painel.semImpressorasTexto}
      </p>
      <button
        type="button"
        onClick={() => irPara('config')}
        style={{
          border: 0,
          background: 'var(--color-accent)',
          color: 'var(--color-bg)',
          borderRadius: 999,
          padding: '12px 22px',
          fontFamily: 'var(--font-heading)',
          fontWeight: 800,
          fontSize: 13,
          cursor: 'pointer'
        }}
      >
        {t.painel.cadastrar}
      </button>
    </div>
  );
}
