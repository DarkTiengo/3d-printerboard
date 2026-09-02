import type { Status } from '@3dfarm/shared';

/** Cores e rótulo curto de cada status — a tabela do design/README.md § 2. */
export function estiloStatus(status: Status): { bg: string; fg: string; curto: string } {
  switch (status) {
    case 'imprimindo':
      return { bg: 'var(--color-accent)', fg: 'var(--color-bg)', curto: 'IMPRIMINDO' };
    case 'atenção':
      return { bg: 'var(--color-accent-700)', fg: 'var(--color-bg)', curto: 'ATENÇÃO' };
    case 'pausada':
      return { bg: 'var(--color-neutral-700)', fg: 'var(--color-bg)', curto: 'PAUSADA' };
    case 'cancelada':
      return { bg: 'var(--color-neutral-800)', fg: 'var(--color-neutral-300)', curto: 'CANCELADA' };
    default:
      return { bg: 'var(--color-neutral-800)', fg: 'var(--color-neutral-300)', curto: 'OCIOSA' };
  }
}

/** Cor do ponto de status. Nunca é o único sinal — sempre acompanha o texto. */
export function corDoPonto(status: Status, online = true): string {
  if (!online) return 'var(--color-neutral-700)';
  if (status === 'atenção') return 'var(--color-accent-700)';
  if (status === 'imprimindo') return 'var(--color-accent)';
  return 'var(--color-neutral-600)';
}

/** Regras de habilitação dos três controles de impressão. */
export function controlesHabilitados(status: Status): { pausar: boolean; continuar: boolean; cancelar: boolean } {
  const rodando = status === 'imprimindo' || status === 'atenção';
  const parada = status === 'pausada';
  return { pausar: rodando, continuar: parada, cancelar: rodando || parada };
}

export const CORES_SEVERIDADE = {
  alta: 'var(--color-accent)',
  media: 'var(--color-accent-700)',
  baixa: 'var(--color-neutral-600)'
} as const;
