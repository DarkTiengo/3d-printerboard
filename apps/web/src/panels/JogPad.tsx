import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, House, MoveVertical } from 'lucide-react';
import { useUi } from '../store/ui';
import { api } from '../lib/api';
import { Tooltip } from '../components/Tooltip';
import { useT } from '../i18n';

const PASSOS = ['0.1', '1', '10', '100'];

const celula: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 38,
  height: 32,
  border: '1px solid var(--color-neutral-700)',
  /* jog pad é uma das três exceções arredondadas do sistema */
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--color-bg)',
  cursor: 'pointer',
  padding: 0
};

/**
 * Cabeça de impressão — design/README.md § 2.5.
 * Grade 3×3 com X±, Y±, Z± e home, mais o seletor de passo.
 */
export function JogPad({
  printerId,
  posicao,
  desabilitado
}: {
  printerId: string;
  posicao: { x: number; y: number; z: number } | null;
  desabilitado: boolean;
}) {
  const t = useT();
  const passo = useUi((s) => s.passo);
  const definirPasso = useUi((s) => s.definirPasso);

  const mover = (eixo: 'X' | 'Y' | 'Z', sinal: 1 | -1) => () => {
    void api.jog(printerId, eixo, sinal * Number(passo)).catch(() => {});
  };

  const botao = (rotulo: string, icone: React.ReactNode, onClick: () => void) => (
    <Tooltip texto={rotulo}>
      <button
        type="button"
        aria-label={rotulo}
        onClick={onClick}
        disabled={desabilitado}
        style={{
          ...celula,
          ...(desabilitado
            ? { borderColor: 'var(--color-neutral-800)', color: 'var(--color-neutral-700)', cursor: 'not-allowed' }
            : {})
        }}
      >
        {icone}
      </button>
    </Tooltip>
  );

  const vazio = <span style={{ width: 38, height: 32 }} aria-hidden />;

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mono">{t.impressora.cabeca}</div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 38px)', gap: 4 }}>
          {vazio}
          {botao(t.impressora.moverYTras, <ArrowUp size={15} strokeWidth={2} aria-hidden />, mover('Y', 1))}
          {vazio}

          {botao(t.impressora.moverXEsq, <ArrowLeft size={15} strokeWidth={2} aria-hidden />, mover('X', -1))}
          {botao(t.impressora.home, <House size={14} strokeWidth={2} aria-hidden />, () => {
            void api.home(printerId).catch(() => {});
          })}
          {botao(t.impressora.moverXDir, <ArrowRight size={15} strokeWidth={2} aria-hidden />, mover('X', 1))}

          {vazio}
          {botao(t.impressora.moverYFrente, <ArrowDown size={15} strokeWidth={2} aria-hidden />, mover('Y', -1))}
          {vazio}
        </div>

        {/* Z fica separado, com o move-vertical como rótulo do eixo: dois botões
            com o mesmo ícone seriam indistinguíveis sem passar o mouse. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <MoveVertical size={13} strokeWidth={2} aria-hidden style={{ color: 'var(--color-neutral-400)' }} />
          {botao(t.impressora.subirZ, <ArrowUp size={15} strokeWidth={2} aria-hidden />, mover('Z', 1))}
          {botao(t.impressora.descerZ, <ArrowDown size={15} strokeWidth={2} aria-hidden />, mover('Z', -1))}
        </div>
      </div>

      <div>
        <div className="mono" style={{ marginBottom: 6 }}>
          {t.impressora.passo}
        </div>
        <div role="group" aria-label={t.impressora.passoGrupo} style={{ display: 'flex', gap: 4 }}>
          {PASSOS.map((v) => {
            const ativo = passo === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => definirPasso(v)}
                aria-pressed={ativo}
                style={{
                  textAlign: 'center',
                  border: 0,
                  borderRadius: 999,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  padding: '7px 12px',
                  cursor: 'pointer',
                  background: ativo ? 'var(--color-accent)' : 'var(--color-neutral-800)',
                  color: ativo ? 'var(--color-bg)' : 'var(--color-neutral-300)'
                }}
              >
                {v}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-500)' }}>
        {posicao
          ? `X ${posicao.x.toFixed(1)}  Y ${posicao.y.toFixed(1)}  Z ${posicao.z.toFixed(2)}`
          : t.impressora.posicaoDesconhecida}
      </div>
    </section>
  );
}
