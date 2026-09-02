import type { Printer, Status } from '@3dfarm/shared';
import type { Dicionario } from '../i18n/pt';
import type { Formatador } from '../i18n/formato';

/** Cores de cada status — a tabela do design/README.md § 2. */
export function coresStatus(status: Status): { bg: string; fg: string } {
  switch (status) {
    case 'imprimindo':
      return { bg: 'var(--color-accent)', fg: 'var(--color-bg)' };
    case 'atenção':
      return { bg: 'var(--color-accent-700)', fg: 'var(--color-bg)' };
    case 'pausada':
      return { bg: 'var(--color-neutral-700)', fg: 'var(--color-bg)' };
    case 'cancelada':
      return { bg: 'var(--color-neutral-800)', fg: 'var(--color-neutral-300)' };
    default:
      return { bg: 'var(--color-neutral-800)', fg: 'var(--color-neutral-300)' };
  }
}

/** Rótulo curto do status, no idioma ativo. */
export function rotuloStatus(status: Status, t: Dicionario): string {
  switch (status) {
    case 'imprimindo':
      return t.status.imprimindo;
    case 'pausada':
      return t.status.pausada;
    case 'cancelada':
      return t.status.cancelada;
    case 'atenção':
      return t.status.atencao;
    default:
      return t.status.ociosa;
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

/**
 * O que aparece no lugar do tempo restante.
 *
 * Só a impressão em andamento tem uma estimativa; nos outros casos o mais
 * honesto é repetir o estado da máquina.
 */
export function rotuloRestante(printer: Printer, t: Dicionario, f: Formatador): string {
  if (!printer.online) return t.status.offline.toLowerCase();
  if (printer.status === 'imprimindo') return f.duracao(printer.restanteSegundos);
  return rotuloStatus(printer.status, t).toLowerCase();
}

export const CORES_SEVERIDADE = {
  alta: 'var(--color-accent)',
  media: 'var(--color-accent-700)',
  baixa: 'var(--color-neutral-600)'
} as const;
