import type { Printer, Status, Temperatura, Posicao, PrinterConfig } from '@3dfarm/shared';
import type { EstadoBruto } from './client.js';

/**
 * print_stats.state do Klipper → o vocabulário de status do design.
 *
 * 'atenção' não existe no Klipper: é a nossa combinação de "tinha um trabalho
 * rodando e algo deu errado" (error / shutdown com job aberto). É o que o design
 * pinta em accent-700.
 */
export function statusDe(bruto: EstadoBruto): Status {
  const stats = bruto.objetos.print_stats ?? {};
  const estadoKlipper: string = stats.state ?? 'standby';

  if (bruto.klippy === 'shutdown' || bruto.klippy === 'error') {
    return stats.filename ? 'atenção' : 'ociosa';
  }
  if (!bruto.conectado) return 'ociosa';

  switch (estadoKlipper) {
    case 'printing':
      return 'imprimindo';
    case 'paused':
      return 'pausada';
    case 'error':
      return 'atenção';
    case 'cancelled':
      return 'cancelada';
    case 'complete':
    case 'standby':
    default:
      return 'ociosa';
  }
}

/**
 * Progresso 0–100.
 *
 * display_status.progress é o que o Klipper mostra no LCD e já leva em conta
 * M73 quando o fatiador emite; virtual_sdcard.progress é o byte-a-byte cru.
 * Preferimos o primeiro e caímos no segundo.
 */
export function progressoDe(bruto: EstadoBruto): number {
  return Math.round(progressoBruto(bruto) * 100);
}

/** Fração 0–1 sem arredondar. A estimativa de ETA precisa da precisão. */
export function progressoBruto(bruto: EstadoBruto): number {
  const display = bruto.objetos.display_status?.progress;
  const sd = bruto.objetos.virtual_sdcard?.progress;
  const p = Number.isFinite(display) ? display : Number.isFinite(sd) ? sd : 0;
  return Math.max(0, Math.min(1, p ?? 0));
}

/**
 * Tempo restante.
 *
 * O Klipper não expõe ETA direto. A estimativa honesta é regra de três sobre o
 * tempo já impresso: total = decorrido / progresso. Ruim no comecinho da
 * impressão, por isso só usamos acima de 1 % — abaixo disso o número seria ficção.
 */
export function restanteSegundos(bruto: EstadoBruto): number | null {
  const decorrido = bruto.objetos.print_stats?.print_duration;
  const progresso = progressoBruto(bruto);
  if (!Number.isFinite(decorrido) || decorrido <= 0 || progresso < 0.01) return null;
  const total = decorrido / progresso;
  return Math.max(0, total - decorrido);
}

/** '84/210' — camada atual sobre total, quando o fatiador informou. */
export function camadaDe(bruto: EstadoBruto): string {
  const stats = bruto.objetos.print_stats ?? {};
  const info = stats.info ?? {};
  const atual = info.current_layer;
  const total = info.total_layer;
  if (Number.isFinite(atual) && Number.isFinite(total) && total > 0) {
    return `${atual}/${total}`;
  }
  return '—';
}

/** Números crus: quem formata (e escolhe a vírgula ou o ponto) é o front. */
export function temperaturasDe(bruto: EstadoBruto): Temperatura[] {
  const temps: Temperatura[] = [];
  const numero = (v: unknown) => (Number.isFinite(v) ? (v as number) : null);
  const bico = bruto.objetos.extruder;
  const mesa = bruto.objetos.heater_bed;
  if (bico) temps.push({ chave: 'bico', atual: numero(bico.temperature), alvo: numero(bico.target) });
  if (mesa) temps.push({ chave: 'mesa', atual: numero(mesa.temperature), alvo: numero(mesa.target) });
  return temps;
}

export function posicaoDe(bruto: EstadoBruto): Posicao | null {
  const pos = bruto.objetos.gcode_move?.gcode_position ?? bruto.objetos.toolhead?.position;
  if (!Array.isArray(pos) || pos.length < 3) return null;
  const [x, y, z] = pos;
  if (![x, y, z].every((v) => Number.isFinite(v))) return null;
  return { x, y, z };
}

/** Estado cru do Klipper + config → a Printer que a UI consome. */
export function normalizar(cfg: PrinterConfig, bruto: EstadoBruto): Printer {
  const status = statusDe(bruto);
  const stats = bruto.objetos.print_stats ?? {};
  const pct = status === 'cancelada' || status === 'ociosa' ? 0 : progressoDe(bruto);

  return {
    id: cfg.id,
    nome: cfg.nome,
    job: stats.filename || '—',
    pct,
    // só faz sentido quando está de fato imprimindo; nos outros casos o front
    // mostra o próprio status
    restanteSegundos: status === 'imprimindo' ? restanteSegundos(bruto) : null,
    camada: camadaDe(bruto),
    status,
    online: bruto.conectado,
    temTaCamera: !!cfg.cameraUrl,
    temperaturas: temperaturasDe(bruto),
    posicao: posicaoDe(bruto),
    macros: bruto.macros
  };
}
