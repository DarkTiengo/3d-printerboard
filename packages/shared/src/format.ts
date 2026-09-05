/** Formatadores em pt-BR, compartilhados entre servidor e front. */

/** 4470 → '1h 14m'. Negativo ou não-finito → '—'. */
export function duracao(segundos: number | null | undefined): string {
  if (segundos == null || !Number.isFinite(segundos) || segundos < 0) return '—';
  const total = Math.round(segundos);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Data ISO → 'há 6 min' / 'há 2 h' / 'ontem' / 'há 4 d'. */
export function quando(iso: string, agora = Date.now()): string {
  const ms = agora - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  return `há ${d} d`;
}

/** Data ISO → 'hoje 03:00' quando é hoje, senão 'há 4 d'. Usado nos cards de backup. */
export function quandoCurto(iso: string | null, agora = Date.now()): string {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  const hoje = new Date(agora);
  const mesmoDia =
    d.getFullYear() === hoje.getFullYear() &&
    d.getMonth() === hoje.getMonth() &&
    d.getDate() === hoje.getDate();
  if (mesmoDia) {
    return `hoje ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return quando(iso, agora);
}

/** 1181116006 → '1,1 GB' (vírgula decimal, como no design). */
export function bytes(n: number | null | undefined): string {
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
  return `${v.toFixed(casas).replace('.', ',')} ${unidades[i]}`;
}

/** 210.42 → '210,4 °C'. */
export function temperatura(v: number | null | undefined, casas = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(casas).replace('.', ',')} °C`;
}

/** Alvo é sempre inteiro no design: 210 → '210 °C', 0 → 'desligado'. */
export function alvo(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v <= 0) return 'desligado';
  return `${Math.round(v)} °C`;
}

/**
 * Nome de seção do printer.cfg em nome de tela: 'chamber' → 'Chamber',
 * 'raspberry_pi' → 'Raspberry Pi', 'MCU' → 'MCU'.
 *
 * No printer.cfg o `_` é separador de palavra, e ninguém escreve maiúscula ali
 * por hábito. Só a primeira letra de cada palavra sobe — baixar o resto viraria
 * 'Mcu' e 'Ptc' justamente onde a sigla foi escrita de propósito.
 */
export function nomeBonito(nome: string): string {
  return nome
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((palavra) => palavra.charAt(0).toUpperCase() + palavra.slice(1))
    .join(' ');
}

/** 'suporte_camera_v3.gcode' → 'suporte_camera_v3'. */
export function semExtensao(nome: string): string {
  return nome.replace(/\.(gcode|gco|g|ufp|bgcode)$/i, '');
}

/** 86000 (mm de filamento) → '86 g' assumindo 1.75 mm PLA (1.24 g/cm³). */
export function filamentoGramas(mm: number | null | undefined, densidade = 1.24): string {
  if (mm == null || !Number.isFinite(mm) || mm <= 0) return '—';
  const raio = 1.75 / 2;
  const cm3 = (Math.PI * raio * raio * mm) / 1000;
  return `${Math.round(cm3 * densidade)} g`;
}
