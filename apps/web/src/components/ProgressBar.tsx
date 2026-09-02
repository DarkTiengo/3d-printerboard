/**
 * Barra de progresso: trilho neutro-800, preenchimento accent.
 * Altura varia por contexto — 3px no tile da parede, 5px no mini painel.
 */
export function ProgressBar({ pct, altura = 3, rotulo }: { pct: number; altura?: number; rotulo?: string }) {
  const valor = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuenow={valor}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={rotulo ?? `${valor}% concluído`}
      style={{ height: altura, background: 'var(--color-neutral-800)', width: '100%' }}
    >
      <div
        style={{
          height: '100%',
          width: `${valor}%`,
          background: 'var(--color-accent)',
          transition: 'width 400ms ease'
        }}
      />
    </div>
  );
}
