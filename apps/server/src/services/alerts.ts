import path from 'node:path';
import fs from 'node:fs/promises';
import type { Alert, Printer, Severidade } from '@3dfarm/shared';

import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { farm } from '../services/farm.js';
import { cameras } from './cameras.js';
import { logger } from '../lib/logger.js';

type Row = {
  id: number;
  codigo: string | null;
  printer_id: string | null;
  printer_name: string;
  severity: Severidade;
  title: string;
  detail: string;
  frame_label: string;
  frame_path: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

function paraAlert(r: Row): Alert {
  return {
    id: r.id,
    codigo: r.codigo ?? '',
    titulo: r.title,
    impressora: r.printer_name,
    printerId: r.printer_id,
    criadoEm: r.created_at + 'Z',
    sev: r.severity,
    detalhe: r.detail,
    frame: r.frame_label,
    frameUrl: r.frame_path ? `/api/alertas/${r.id}/frame` : null,
    resolvidoEm: r.resolved_at ? r.resolved_at + 'Z' : null,
    resolvidoPor: r.resolved_by
  };
}

/*
 * O mais grave primeiro, e só então o mais recente: com a fazenda cheia, um MCU
 * perdido não pode aparecer abaixo de três "impressão concluída". O front
 * reordena com o mesmo critério (`porGravidade`), porque alertas novos chegam
 * pelo SSE fora desta consulta.
 */
const ORDEM = `ORDER BY CASE severity
                 WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3
               END, created_at DESC`;

export function listarAlertas(incluirResolvidos = false, limite = 100): Alert[] {
  const sql = incluirResolvidos
    ? `SELECT * FROM alerts ${ORDEM} LIMIT ?`
    : `SELECT * FROM alerts WHERE resolved_at IS NULL ${ORDEM} LIMIT ?`;
  return (getDb().prepare(sql).all(limite) as Row[]).map(paraAlert);
}

export function acharAlerta(id: number): { alert: Alert; framePath: string | null } | null {
  const r = getDb().prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Row | undefined;
  return r ? { alert: paraAlert(r), framePath: r.frame_path } : null;
}

export function resolverAlerta(id: number, por: string): Alert | null {
  getDb()
    .prepare("UPDATE alerts SET resolved_at = datetime('now'), resolved_by = ? WHERE id = ? AND resolved_at IS NULL")
    .run(por, id);
  return acharAlerta(id)?.alert ?? null;
}

export type NovoAlerta = {
  printerId: string | null;
  printerNome: string;
  sev: Severidade;
  /** chave estável do tipo — é o que o front usa para traduzir o título */
  codigo: string;
  titulo: string;
  detalhe: string;
  frameLabel?: string;
  /** Enquanto houver um alerta aberto com esta chave, não criamos outro. */
  dedupeKey?: string;
  /** Guarda o quadro da câmera no instante do alerta. */
  capturarFrame?: boolean;
};

/**
 * Cria um alerta. Emite pelo hub SSE via callback registrado em ligarAlertas().
 * Devolve null quando o dedupe barrou — é o caso comum de reconexão em loop.
 */
export async function criarAlerta(novo: NovoAlerta): Promise<Alert | null> {
  const db = getDb();
  const existente = novo.dedupeKey
    ? db.prepare('SELECT id FROM alerts WHERE dedupe_key = ? AND resolved_at IS NULL').get(novo.dedupeKey)
    : undefined;
  if (existente) return null;

  const info = db
    .prepare(
      `INSERT INTO alerts (printer_id, printer_name, severity, codigo, title, detail, frame_label, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      novo.printerId,
      novo.printerNome,
      novo.sev,
      novo.codigo,
      novo.titulo,
      novo.detalhe,
      novo.frameLabel ?? '',
      novo.dedupeKey ?? null
    );
  const id = Number(info.lastInsertRowid);

  if (novo.capturarFrame && novo.printerId) {
    // fora do caminho crítico: se a câmera demorar, o alerta já existe
    void capturarFrame(id, novo.printerId);
  }

  const alert = acharAlerta(id)!.alert;
  logger.info({ alerta: id, sev: novo.sev, printer: novo.printerId }, novo.titulo);
  emissor?.(alert);
  return alert;
}

async function capturarFrame(alertaId: number, printerId: string): Promise<void> {
  try {
    // o frame do alerta precisa ser do instante do alerta, não um cacheado
    const jpeg = await cameras.capturar(printerId, 1_000);
    if (!jpeg) return;
    const arquivo = path.join(config.framesDir, `alerta-${alertaId}.jpg`);
    await fs.writeFile(arquivo, jpeg);
    getDb().prepare('UPDATE alerts SET frame_path = ? WHERE id = ?').run(arquivo, alertaId);
    const alert = acharAlerta(alertaId)?.alert;
    if (alert) emissor?.(alert);
  } catch (err) {
    logger.warn(`não foi possível capturar o frame do alerta ${alertaId}: ${err}`);
  }
}

let emissor: ((a: Alert) => void) | null = null;
export function aoCriarAlerta(fn: (a: Alert) => void): void {
  emissor = fn;
}

/**
 * Fecha em nome do sistema o alerta aberto com esta chave, se houver.
 *
 * Emite pelo SSE: sem isso o alerta some do banco mas fica na tela de quem já
 * estava com ela aberta, até um F5.
 */
function resolverPorChave(chave: string): void {
  const row = getDb().prepare('SELECT id FROM alerts WHERE dedupe_key = ? AND resolved_at IS NULL').get(chave) as
    | { id: number }
    | undefined;
  if (!row) return;
  const alert = resolverAlerta(row.id, 'sistema');
  if (alert) emissor?.(alert);
}

/**
 * Apaga os quadros de câmera velhos.
 *
 * Eles eram só escritos: cada alerta com câmera deixava um JPEG em `framesDir`
 * para sempre, e "impressão concluída" — o que mais aparece numa fazenda ativa —
 * nunca se resolve sozinho, então nem uma poda por alerta resolvido daria conta.
 * O critério é idade: depois de duas semanas a imagem não diz mais nada.
 *
 * O alerta continua no histórico, só sem a foto — `frameUrl` vira null e a tela
 * mostra "sem imagem do momento", que é exatamente o que aconteceu.
 */
export async function podarFrames(dias = config.alertaFrameDias): Promise<number> {
  if (!(dias > 0)) return 0;
  const velhos = getDb()
    .prepare(
      `SELECT id, frame_path FROM alerts
       WHERE frame_path IS NOT NULL AND created_at < datetime('now', ?)`
    )
    .all(`-${Math.floor(dias)} days`) as { id: number; frame_path: string }[];

  let apagados = 0;
  for (const linha of velhos) {
    // solta a referência mesmo se o arquivo já tinha sumido: o que não pode é
    // a tela oferecer um link para uma imagem que não existe mais
    await fs.rm(linha.frame_path, { force: true }).catch(() => {});
    getDb().prepare('UPDATE alerts SET frame_path = NULL WHERE id = ?').run(linha.id);
    apagados += 1;
  }
  if (apagados > 0) logger.info(`${apagados} quadros de alerta com mais de ${dias} dias apagados`);
  return apagados;
}

// ── gerador ─────────────────────────────────────────────────────────────────

const nomeCurto = (p: Printer) => p.nome;

/**
 * Firmware parado com o host ainda respondendo. Exige `online`: sem Moonraker
 * não sabemos nada sobre o Klipper, e quem cobre esse caso é o alerta de
 * impressora fora do ar.
 */
const klipperCaido = (p: Printer) => p.online && p.klippy !== 'ready';

/** O motivo do Klipper, ou a melhor explicação que temos sem ele. */
function motivoDaParada(p: Printer): string {
  if (p.klippy === 'disconnected') {
    return 'O Moonraker perdeu a conexão com o Klipper — o processo caiu ou está reiniciando.';
  }
  // é o texto cru do Klipper, em inglês; traduzi-lo esconderia o termo que a
  // pessoa vai jogar no buscador ou colar no fórum
  return p.mensagemKlippy ?? 'O Klipper parou sem informar o motivo.';
}

/**
 * Observa o Farm e as câmeras e transforma transições em alertas.
 * As regras são as do § 7 do plano; o que dispara é sempre uma *transição*,
 * nunca o estado em si — senão cada update do Klipper geraria um alerta.
 */
export function ligarGeradorDeAlertas(): void {
  farm.on('printer', (atual: Printer, anterior: Printer | null) => {
    /*
     * Resoluções primeiro, e valendo também no primeiro snapshot.
     *
     * Um alerta que se fecha sozinho depende de ver a transição de volta — e
     * quem reinicia o app perde a que aconteceu enquanto ele estava fora. Sem o
     * `!anterior` aqui, uma máquina que se recuperou durante a parada ficaria
     * com o alerta aberto para sempre. Continua sendo barato: só roda na
     * primeira leitura de cada impressora e nas viradas de estado.
     */
    if (atual.klippy === 'ready' && (!anterior || anterior.klippy !== 'ready')) {
      resolverPorChave(`klippy:${atual.id}`);
    }
    if (atual.online && (!anterior || !anterior.online)) {
      resolverPorChave(`offline:${atual.id}`);
    }

    // Criar alerta, ao contrário, exige transição: sem o estado anterior não dá
    // para saber se algo mudou, e o primeiro snapshot alertaria a fazenda toda.
    if (!anterior) return;

    /*
     * Klipper parado — a classe crítica.
     *
     * Cobre tudo que derruba o firmware: perda de comunicação com o MCU,
     * thermal runaway, config quebrada, e o processo do Klipper morrendo
     * debaixo de um Moonraker que continua de pé. A máquina não aceita mais
     * comandos e não há impressão possível até um FIRMWARE_RESTART.
     *
     * A condição é "caiu agora" e não `anterior.klippy === 'ready'`: quando o
     * app sobe com a impressora já em shutdown, o estado anterior é o inicial
     * (offline), e essa máquina precisa alertar do mesmo jeito.
     */
    if (klipperCaido(atual) && !klipperCaido(anterior)) {
      void criarAlerta({
        printerId: atual.id,
        printerNome: nomeCurto(atual),
        sev: 'critica',
        codigo: 'klipper_parado',
        titulo: 'Klipper parado',
        detalhe: `${motivoDaParada(atual)} ${
          atual.status === 'atenção'
            ? `A impressão de ${atual.job} foi interrompida na camada ${atual.camada}.`
            : 'Não havia impressão em andamento.'
        } A máquina não aceita comandos até um FIRMWARE_RESTART.`,
        frameLabel: `CAM ${atual.id}`,
        dedupeKey: `klippy:${atual.id}`,
        capturarFrame: true
      });
    }

    /*
     * Erro de impressão com o firmware saudável: um G-code que abortou, um
     * sensor que mandou parar. Quando o Klipper está caído a causa é outra e o
     * alerta acima já a nomeia — abrir os dois seria contar o mesmo problema
     * duas vezes, com o menos informativo por cima.
     */
    if (anterior.status !== 'atenção' && atual.status === 'atenção' && atual.klippy === 'ready') {
      void criarAlerta({
        printerId: atual.id,
        printerNome: nomeCurto(atual),
        sev: 'alta',
        codigo: 'erro_impressao',
        titulo: 'Impressão interrompida por erro',
        detalhe: `${atual.job} parou na camada ${atual.camada}. O Klipper reportou erro e a impressão não avança. Verifique a máquina antes de retomar.`,
        frameLabel: `CAM ${atual.id}`,
        dedupeKey: `erro:${atual.id}:${atual.job}`,
        capturarFrame: true
      });
    }

    if (anterior.online && !atual.online) {
      // Sumir com uma impressão em curso é crítico: ela segue rodando sem
      // ninguém olhando. Sumir ociosa é sério, mas não urgente.
      const imprimia = anterior.status === 'imprimindo';
      void criarAlerta({
        printerId: atual.id,
        printerNome: nomeCurto(atual),
        sev: imprimia ? 'critica' : 'alta',
        codigo: 'impressora_offline',
        titulo: 'Impressora fora do ar',
        detalhe: `O host do Moonraker parou de responder. ${
          imprimia
            ? `Havia uma impressão em ${anterior.pct}% (${anterior.job}) — ela pode ter continuado sem monitoramento.`
            : 'A máquina estava ociosa.'
        }`,
        frameLabel: `CAM ${atual.id}`,
        dedupeKey: `offline:${atual.id}`
      });
    }

    if (anterior.status === 'imprimindo' && atual.status === 'ociosa' && anterior.pct >= 95) {
      void criarAlerta({
        printerId: atual.id,
        printerNome: nomeCurto(atual),
        sev: 'baixa',
        codigo: 'impressao_concluida',
        titulo: 'Impressão concluída',
        detalhe: `${anterior.job} terminou em ${nomeCurto(atual)}. A mesa segue ocupada até a peça ser retirada.`,
        frameLabel: `CAM ${atual.id}`,
        capturarFrame: true
      });
    }
  });

  farm.on('evento', (printerId: string, metodo: string, params: any) => {
    if (metodo !== 'notify_gcode_response') return;
    const texto: string = Array.isArray(params) ? String(params[0] ?? '') : '';
    // o sensor de filamento do Klipper avisa por gcode response, não por objeto
    if (/filament|runout/i.test(texto)) {
      const p = farm.printer(printerId);
      if (!p) return;
      void criarAlerta({
        printerId,
        printerNome: nomeCurto(p),
        sev: 'media',
        codigo: 'filamento_acabando',
        titulo: 'Filamento acabando',
        detalhe: texto.trim(),
        frameLabel: `CAM ${printerId}`,
        dedupeKey: `filamento:${printerId}`,
        capturarFrame: true
      });
    }
  });

  cameras.on('offline', (printerId: string, motivo: string) => {
    const p = farm.printer(printerId);
    void criarAlerta({
      printerId,
      printerNome: p ? nomeCurto(p) : printerId,
      sev: 'media',
      codigo: 'camera_offline',
        titulo: 'Câmera offline',
      detalhe: `O stream parou de responder (${motivo}). A impressão continua, mas sem imagem. Vale checar a alimentação do hub USB.`,
      frameLabel: `CAM ${printerId}`,
      dedupeKey: `camera:${printerId}`
    });
  });

  cameras.on('online', (printerId: string) => {
    // câmera voltou: fecha o alerta sozinha, ninguém precisa resolver na mão
    resolverPorChave(`camera:${printerId}`);
  });
}
