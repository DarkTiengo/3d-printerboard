import type {
  MesaDePecas,
  PecaDaMesa,
  Printer,
  Status,
  Temperatura,
  TipoSensor,
  Posicao,
  PrinterConfig
} from '@3dfarm/shared';
import { PREFIXOS_DE_SENSOR, type EstadoBruto } from './client.js';

/**
 * print_stats.state que significam "havia um trabalho em curso". 'error' entra
 * porque é o que o Klipper grava ao abortar uma impressão — inclusive quando
 * quem abortou foi o próprio shutdown.
 */
const JOB_EM_CURSO = new Set(['printing', 'paused', 'error']);

/**
 * print_stats.state do Klipper → o vocabulário de status do design.
 *
 * 'atenção' não existe no Klipper: é a nossa combinação de "tinha um trabalho
 * rodando e algo deu errado". É o que o design pinta em accent-700.
 */
export function statusDe(bruto: EstadoBruto): Status {
  const stats = bruto.objetos.print_stats ?? {};
  const estadoKlipper: string = stats.state ?? 'standby';

  // A queda do host tem sinal próprio (`online`) e alerta próprio; aqui ela não
  // vira 'atenção' para não contar o mesmo problema duas vezes.
  if (!bruto.conectado) return 'ociosa';

  /*
   * Klippy fora de 'ready' — MCU perdido, config quebrada, Klipper caído — quer
   * dizer que print_stats congelou no último valor conhecido. Nunca é
   * 'imprimindo': repetir o estado congelado deixaria a tela mostrando uma
   * impressão que não anda. Só vira 'atenção' se o valor congelado era um
   * trabalho em curso — 'complete' e 'cancelled' persistem em print_stats muito
   * depois da impressão, e tratá-los como job aberto viraria falso alarme a
   * cada shutdown com a máquina parada.
   */
  if (bruto.klippy !== 'ready') {
    return JOB_EM_CURSO.has(estadoKlipper) ? 'atenção' : 'ociosa';
  }

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

/** Ordem das extrusoras: 'extruder' primeiro, depois extruder1, extruder2… */
const EXTRUSORA = /^extruder\d*$/;

/**
 * Todos os sensores da máquina, em ordem de utilidade: as extrusoras, a mesa,
 * os aquecedores extras (a câmara), as ventoinhas por temperatura e, por
 * último, os sensores de leitura — MCU, Raspberry, o termistor da caixa.
 *
 * Números crus: quem formata (e escolhe a vírgula ou o ponto) é o front.
 */
export function temperaturasDe(bruto: EstadoBruto): Temperatura[] {
  const numero = (v: unknown) => (Number.isFinite(v) ? (v as number) : null);
  const nomes = Object.keys(bruto.objetos);

  const montar = (objeto: string, tipo: TipoSensor, rotulo: string | null): Temperatura | null => {
    const o = bruto.objetos[objeto];
    if (!o) return null;
    // o Klipper devolve as seções da config em minúsculas; o objeto preserva
    // o que a pessoa escreveu, então a busca pela faixa normaliza
    const faixa = tipo === 'sensor' ? null : (bruto.limites[objeto.toLowerCase()] ?? null);
    return {
      chave: objeto,
      rotulo,
      tipo,
      atual: numero(o.temperature),
      // sensor de leitura não tem alvo; nos outros, 0 é "desligado"
      alvo: tipo === 'sensor' ? null : numero(o.target),
      min: faixa?.min ?? null,
      max: faixa?.max ?? null
    };
  };

  const temps: (Temperatura | null)[] = [
    ...nomes.filter((n) => EXTRUSORA.test(n)).sort().map((n) => montar(n, 'aquecedor', null)),
    montar('heater_bed', 'aquecedor', null),
    ...PREFIXOS_DE_SENSOR.flatMap(([prefixo, tipo]) =>
      nomes
        .filter((n) => n.startsWith(prefixo))
        .sort()
        .map((n) => montar(n, tipo, n.slice(prefixo.length)))
    )
  ];

  return temps.filter((t): t is Temperatura => t !== null);
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
  const estadoKlipper: string = stats.state ?? 'standby';
  const pct = status === 'cancelada' || status === 'ociosa' ? 0 : progressoDe(bruto);

  return {
    id: cfg.id,
    nome: cfg.nome,
    job: stats.filename || '—',
    /*
     * O Klipper mantém o nome do arquivo em print_stats depois que a impressão
     * acaba, e distingue 'complete' de 'cancelled' — distinção que o nosso
     * `status` perde ao mapear as duas para "ociosa". Guardamos aqui porque é
     * o que permite oferecer reimpressão só quando a peça saiu inteira.
     */
    concluiuComSucesso: estadoKlipper === 'complete' && !!stats.filename,
    pct,
    // só faz sentido quando está de fato imprimindo; nos outros casos o front
    // mostra o próprio status
    restanteSegundos: status === 'imprimindo' ? restanteSegundos(bruto) : null,
    camada: camadaDe(bruto),
    status,
    online: bruto.conectado,
    klippy: bruto.klippy,
    mensagemKlippy: bruto.mensagemKlippy,
    temTaCamera: !!cfg.cameraUrl,
    /*
     * O Klipper devolve '' quando não há peça em curso — entre objetos, ou num
     * arquivo sem rótulo. O `||` trata os dois como o mesmo "não tem".
     */
    pecaAtual: bruto.objetos.exclude_object?.current_object || null,
    temPecas: (bruto.objetos.exclude_object?.objects?.length ?? 0) > 0,
    temperaturas: temperaturasDe(bruto),
    posicao: posicaoDe(bruto),
    macros: bruto.macros
  };
}


// ── A mesa, fora do snapshot ────────────────────────────────────────────────

/** Ponto do Klipper → par de números, descartando o que não for número. */
function ponto(v: unknown): [number, number] | null {
  return Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;
}

/**
 * As peças da mesa com contorno e tudo, para o mapa.
 *
 * Não vai junto do `Printer` de propósito: aquele objeto é republicado inteiro
 * a cada mudança de campo, e os polígonos de uma mesa cheia pesam mais que todo
 * o resto do snapshot somado — para uma coisa que não muda durante a impressão
 * e que quase ninguém abre. Aqui é sob demanda, e sai do estado que a conexão
 * já mantém: nenhuma volta extra ao Moonraker.
 */
export function mesaDePecas(bruto: EstadoBruto): MesaDePecas {
  const eo = bruto.objetos.exclude_object;
  const excluidas = new Set<string>(Array.isArray(eo?.excluded_objects) ? eo.excluded_objects : []);
  const atual: string = eo?.current_object || '';

  const pecas: PecaDaMesa[] = (Array.isArray(eo?.objects) ? eo.objects : [])
    .filter((o: any) => typeof o?.name === 'string' && o.name !== '')
    .map(
      (o: any): PecaDaMesa => ({
        nome: o.name,
        centro: ponto(o.center),
        contorno: (Array.isArray(o.polygon) ? o.polygon : []).map(ponto).filter(Boolean) as [number, number][],
        excluida: excluidas.has(o.name),
        atual: o.name === atual
      })
    );

  /*
   * Os limites vêm do toolhead, que já está assinado desde o handshake. Podem
   * faltar numa máquina que não os publica; aí o mapa se acerta pelo contorno
   * das peças, que é pior mas não impede nada.
   */
  const min = ponto(bruto.objetos.toolhead?.axis_minimum);
  const max = ponto(bruto.objetos.toolhead?.axis_maximum);
  const limites = min && max && max[0] > min[0] && max[1] > min[1]
    ? { minX: min[0], minY: min[1], maxX: max[0], maxY: max[1] }
    : null;

  return { limites, pecas };
}
