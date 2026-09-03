import type { Printer } from '@3dfarm/shared';
import { quando } from '@3dfarm/shared';
import { config } from '../config.js';
import { farm } from './farm.js';
import { acharPrinter, listarPrinters } from './printers.repo.js';
import {
  backupVencido,
  coletarLixo,
  definirVerificadorDePendencia,
  intervaloBackupHoras,
  registrarCiclo,
  rodarBackup,
  ultimoBackupUtilEm
} from './backup.js';
import { criarAlerta } from './alerts.js';
import { logger } from '../lib/logger.js';

/**
 * Quando um backup pode acontecer.
 *
 * Regra única desta camada, e todo caminho passa por ela — ciclo agendado,
 * botão manual e recuperação ao religar: **só se copia uma impressora ociosa**.
 * Baixar o G-code de uma máquina no meio de uma peça disputa CPU e rede do
 * Raspberry Pi com o Klipper, e o preço disso é stutter na impressão.
 *
 * Quem não está ociosa não é recusada, fica pendente: assim que a impressão
 * terminar, a transição para ociosa esvazia a fila.
 */

type Motivo = 'ciclo' | 'manual' | 'recuperacao';

type Pendente = {
  motivo: Motivo;
  /** desde quando espera — vira alerta se demorar demais */
  desde: number;
  /** data do último backup útil no momento em que entrou na fila */
  ultimoEm: string | null;
};

const pendentes = new Map<string, Pendente>();
/** verificações já agendadas, para não empilhar timer na mesma impressora */
const agendadas = new Set<string>();

let processando = false;

/**
 * Espaço entre backups seguidos. A fazenda inteira ficando ociosa junto —
 * o que acontece de madrugada — não pode virar oito downloads simultâneos.
 */
const ESPACAMENTO_MS = 10_000;

/** Uma impressora pode ser copiada agora? */
export function podeCopiarAgora(printer: Printer | null | undefined): boolean {
  return !!printer && printer.online && printer.status === 'ociosa';
}

export function backupEstaVencido(printerId: string, agora = Date.now()): boolean {
  const cfg = acharPrinter(printerId);
  if (!cfg?.backupEnabled) return false;
  // cada máquina pode ter o seu intervalo; sem o dela, vale o global
  return backupVencido(ultimoBackupUtilEm(printerId), intervaloBackupHoras(printerId), agora);
}

export function estaPendente(printerId: string): boolean {
  return pendentes.has(printerId);
}

export function idsPendentes(): string[] {
  return [...pendentes.keys()];
}

export type ResultadoPedido = 'iniciado' | 'adiado' | 'offline' | 'desligado';

/**
 * Pede um backup. Único jeito de disparar um — `rodarBackup` é só o executor.
 * Devolve o que aconteceu para quem chamou poder contar ao usuário.
 */
export function pedirBackup(printerId: string, motivo: Motivo): ResultadoPedido {
  const cfg = acharPrinter(printerId);
  if (!cfg) return 'offline';
  if (!cfg.backupEnabled && motivo !== 'manual') return 'desligado';

  const printer = farm.printer(printerId);
  if (!printer?.online) return 'offline';

  if (!pendentes.has(printerId)) {
    pendentes.set(printerId, { motivo, desde: Date.now(), ultimoEm: ultimoBackupUtilEm(printerId) });
  }

  if (podeCopiarAgora(printer)) {
    void processarPendentes();
    return 'iniciado';
  }

  logger.info(
    { printer: printerId, status: printer.status, motivo },
    'backup adiado: a impressora não está ociosa'
  );
  return 'adiado';
}

/**
 * Ciclo completo — o que o cron das 03:00 dispara e o que o botão "backup de
 * toda a fazenda" chama. Quem estiver imprimindo entra na fila em vez de ser
 * copiada na marra.
 */
export function rodarCicloCompleto(motivo: Motivo = 'ciclo'): {
  iniciados: string[];
  adiados: string[];
  offline: string[];
  emDia: string[];
} {
  const candidatas = listarPrinters().filter((p) => p.backupEnabled);
  const iniciados: string[] = [];
  const adiados: string[] = [];
  const offline: string[] = [];
  const emDia: string[] = [];

  // O ciclo agendado respeita o intervalo de cada máquina: quem pediu backup
  // semanal não é copiada toda madrugada só porque o cron disparou. O pedido
  // manual copia todo mundo — quem clicou quer uma cópia agora.
  const alvos =
    motivo === 'manual'
      ? candidatas
      : candidatas.filter((p) => {
          if (backupEstaVencido(p.id)) return true;
          emDia.push(p.id);
          return false;
        });

  for (const p of alvos) {
    switch (pedirBackup(p.id, motivo)) {
      case 'iniciado':
        iniciados.push(p.id);
        break;
      case 'adiado':
        adiados.push(p.id);
        break;
      default:
        offline.push(p.id);
    }
  }

  logger.info(
    {
      total: candidatas.length,
      iniciados: iniciados.length,
      adiados: adiados.length,
      offline: offline.length,
      emDia: emDia.length
    },
    'ciclo de backup disparado'
  );
  return { iniciados, adiados, offline, emDia };
}

/**
 * Esvazia a fila, uma impressora de cada vez. Quem ainda não está ociosa
 * permanece na fila — a transição para ociosa chama esta função de novo.
 */
async function processarPendentes(): Promise<void> {
  if (processando) return;
  processando = true;
  let copiouAlguma = false;

  try {
    for (const [printerId, pendente] of [...pendentes]) {
      const printer = farm.printer(printerId);

      if (!printer?.online) {
        // sumiu antes da vez; volta a valer quando reaparecer
        pendentes.delete(printerId);
        continue;
      }
      if (!podeCopiarAgora(printer)) continue;

      pendentes.delete(printerId);
      logger.info({ printer: printerId, motivo: pendente.motivo }, 'rodando backup');

      const snapshot = await rodarBackup(printerId);
      copiouAlguma = true;

      if (snapshot && pendente.motivo === 'recuperacao') {
        await criarAlerta({
          printerId,
          printerNome: printer.nome,
          sev: 'baixa',
          codigo: 'backup_recuperacao',
        titulo: 'Backup de recuperação executado',
          detalhe: pendente.ultimoEm
            ? `${printer.nome} ficou fora do ar durante a janela de backup — o último era de ${quando(pendente.ultimoEm)}. Um backup foi feito assim que ela voltou à rede e ficou ociosa.`
            : `${printer.nome} nunca tinha sido copiada. O primeiro backup foi feito assim que ela ficou ociosa.`,
          frameLabel: `CAM ${printerId}`
        });
      }

      if (pendentes.size > 0) {
        await new Promise((r) => setTimeout(r, ESPACAMENTO_MS));
      }
    }
  } catch (err) {
    logger.error({ err }, 'falha ao processar a fila de backup');
  } finally {
    processando = false;
  }

  if (copiouAlguma) {
    registrarCiclo();
    await coletarLixo();
  }
}

/**
 * Uma impressora que nunca fica ociosa nunca seria copiada, e ninguém saberia.
 * Depois de dois intervalos esperando, isso vira alerta.
 */
function avisarEsperaLonga(): void {
  for (const [printerId, pendente] of pendentes) {
    const limite = intervaloBackupHoras(printerId) * 2 * 3_600_000;
    if (Date.now() - pendente.desde < limite) continue;
    const printer = farm.printer(printerId);
    if (!printer) continue;

    void criarAlerta({
      printerId,
      printerNome: printer.nome,
      sev: 'media',
      codigo: 'backup_esperando',
        titulo: 'Backup esperando a impressora ficar ociosa',
      detalhe:
        `${printer.nome} está na fila de backup há ${quando(new Date(pendente.desde).toISOString())} e segue ocupada. ` +
        `O último backup dela é de ${pendente.ultimoEm ? quando(pendente.ultimoEm) : 'nunca'}. ` +
        `Copiar durante a impressão causaria stutter, então o sistema espera — mas vale abrir uma janela ociosa nessa máquina.`,
      dedupeKey: `backup-espera:${printerId}`
    });
  }
}

export function ligarAgendaDeBackup(): void {
  // os cards da tela precisam saber quem está na fila
  definirVerificadorDePendencia(estaPendente);

  farm.on('printer', (atual: Printer, anterior: Printer | null) => {
    const apareceu = (!anterior && atual.online) || (!!anterior && !anterior.online && atual.online);

    if (apareceu && !agendadas.has(atual.id)) {
      agendadas.add(atual.id);
      // dá tempo do Klipper subir: perguntar cedo demais devolve erro e
      // marcaria o backup como falho sem motivo
      setTimeout(() => {
        agendadas.delete(atual.id);
        if (!farm.printer(atual.id)?.online) return;
        if (backupEstaVencido(atual.id)) {
          logger.info(
            { printer: atual.id, ultimoBackup: ultimoBackupUtilEm(atual.id) ?? 'nunca' },
            'backup vencido detectado ao religar'
          );
          pedirBackup(atual.id, 'recuperacao');
        }
      }, config.backupEsperaAposOnlineMs).unref();
    }

    // ficou ociosa: é a hora de rodar o que estava esperando
    if (pendentes.has(atual.id) && podeCopiarAgora(atual)) {
      void processarPendentes();
    }
  });

  setInterval(avisarEsperaLonga, 30 * 60_000).unref();

  logger.info(
    `agenda de backup ligada: só copia impressora ociosa; recupera quem passar de ${intervaloBackupHoras()} h sem backup`
  );
}

/** Só para os testes: limpa o estado entre casos. */
export function _limparEstado(): void {
  pendentes.clear();
  agendadas.clear();
  processando = false;
}
