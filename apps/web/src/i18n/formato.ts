import { localeDe, useIdioma } from './index';

/**
 * Formatação sensível ao idioma.
 *
 * O servidor manda números e datas ISO; a vírgula decimal, o "há 6 min" e o
 * "hoje 03:00" nascem aqui, no idioma que a pessoa escolheu.
 */

export type Formatador = ReturnType<typeof criarFormatador>;

export function useFormato(): Formatador {
  const idioma = useIdioma((s) => s.idioma);
  return criarFormatador(idioma);
}

function criarFormatador(idioma: 'pt' | 'en') {
  const locale = localeDe(idioma);
  const pt = idioma === 'pt';

  /** 4470 → '1h 14m'. Neutro o bastante para os dois idiomas. */
  function duracao(segundos: number | null | undefined): string {
    if (segundos == null || !Number.isFinite(segundos) || segundos < 0) return '—';
    const total = Math.round(segundos);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  /** ISO → 'há 6 min' / '6 min ago', via Intl.RelativeTimeFormat. */
  function quando(iso: string | null | undefined, agora = Date.now()): string {
    if (!iso) return pt ? 'nunca' : 'never';
    const ms = agora - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '—';

    const min = Math.floor(ms / 60000);
    if (min < 1) return pt ? 'agora' : 'just now';

    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (min < 60) return rtf.format(-min, 'minute');
    const h = Math.floor(min / 60);
    if (h < 24) return rtf.format(-h, 'hour');
    const d = Math.floor(h / 24);
    return rtf.format(-d, 'day');
  }

  /** ISO → 'hoje 03:00' quando é hoje, senão o relativo. */
  function quandoCurto(iso: string | null | undefined, agora = Date.now()): string {
    if (!iso) return pt ? 'nunca' : 'never';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '—';

    const hoje = new Date(agora);
    const mesmoDia =
      d.getFullYear() === hoje.getFullYear() &&
      d.getMonth() === hoje.getMonth() &&
      d.getDate() === hoje.getDate();

    if (mesmoDia) {
      const hora = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: !pt }).format(d);
      return `${pt ? 'hoje' : 'today'} ${hora}`;
    }
    return quando(iso, agora);
  }

  /** Bytes com o separador decimal do idioma. */
  function bytes(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n) || n < 0) return '0 B';
    if (n < 1024) return `${Math.round(n)} B`;
    const unidades = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < unidades.length - 1) {
      v /= 1024;
      i++;
    }
    const casas = v < 10 ? 1 : 0;
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v)} ${unidades[i]}`;
  }

  function numero(v: number, casas = 1): string {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v);
  }

  function temperatura(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return `${numero(v, 1)} °C`;
  }

  /** Alvo zerado é aquecedor desligado, não 0 °C. */
  function alvo(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    if (v <= 0) return pt ? 'desligado' : 'off';
    return `${Math.round(v)} °C`;
  }

  /** '0 3 * * *' → '03:00'. Devolve null quando não é o padrão diário. */
  function horaDoCron(cron: string): string | null {
    const m = /^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/.exec(cron.trim());
    if (!m) return null;
    return `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
  }

  return { duracao, quando, quandoCurto, bytes, numero, temperatura, alvo, horaDoCron, locale };
}
