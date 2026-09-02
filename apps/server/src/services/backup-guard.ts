import type { Printer } from '@3dfarm/shared';
import { quando } from '@3dfarm/shared';
import { config } from '../config.js';
import { farm } from './farm.js';
import { acharPrinter } from './printers.repo.js';
import { backupVencido, intervaloBackupHoras, rodarBackup, ultimoBackupUtilEm } from './backup.js';
import { criarAlerta } from './alerts.js';
import { logger } from '../lib/logger.js';

/**
 * Backup de recuperação.
 *
 * O ciclo das 03:00 só alcança quem estava ligado às 03:00 — e numa fazenda
 * caseira as máquinas passam dias desligadas. Este verificador fecha esse buraco:
 * quando uma impressora reaparece na rede, ele confere há quanto tempo foi o
 * último backup dela e, se a janela configurada já passou, roda um na hora.
 *
 * Duas cautelas que valem mais que a pressa:
 *  - espera o Klipper terminar de subir antes de perguntar qualquer coisa;
 *  - não baixa G-code de uma máquina que está imprimindo. Puxar um gigabyte do
 *    Raspberry Pi no meio de uma peça é um jeito conhecido de causar stutter.
 *    Nesse caso o trabalho fica pendente e sai quando ela ficar ociosa.
 */

/** Impressoras que já sabemos estar com backup vencido, esperando a vez. */
const pendentes = new Set<string>();
/** Impressoras cuja verificação já está agendada, para não duplicar timer. */
const agendadas = new Set<string>();

let processando = false;

/** Intervalo entre backups de recuperação seguidos — a fazenda inteira religando
 *  ao mesmo tempo não pode virar oito downloads simultâneos. */
const ESPACAMENTO_MS = 10_000;

export function precisaDeBackup(printerId: string, agora = Date.now()): boolean {
  const cfg = acharPrinter(printerId);
  if (!cfg?.backupEnabled) return false;
  return backupVencido(ultimoBackupUtilEm(printerId), intervaloBackupHoras(), agora);
}

/** Uma impressora pode receber backup agora? Ociosa e online. */
function podeRodarAgora(printer: Printer | null): boolean {
  return !!printer?.online && printer.status === 'ociosa';
}

function verificar(printerId: string): void {
  agendadas.delete(printerId);

  const printer = farm.printer(printerId);
  if (!printer?.online) return;
  if (!precisaDeBackup(printerId)) return;

  if (!pendentes.has(printerId)) {
    const desde = ultimoBackupUtilEm(printerId);
    logger.info(
      { printer: printerId, ultimoBackup: desde ?? 'nunca' },
      'backup vencido detectado ao religar; agendando recuperação'
    );
    pendentes.add(printerId);
  }
  void processarPendentes();
}

/**
 * Roda os pendentes um de cada vez. Quem está imprimindo continua na fila —
 * a transição para ociosa chama de novo.
 */
async function processarPendentes(): Promise<void> {
  if (processando) return;
  processando = true;
  try {
    for (const printerId of [...pendentes]) {
      const printer = farm.printer(printerId);
      if (!printer?.online) {
        // sumiu antes de dar tempo; volta a valer quando reaparecer
        pendentes.delete(printerId);
        continue;
      }
      if (!podeRodarAgora(printer)) continue;
      if (!precisaDeBackup(printerId)) {
        pendentes.delete(printerId);
        continue;
      }

      pendentes.delete(printerId);
      const desde = ultimoBackupUtilEm(printerId);
      logger.info({ printer: printerId }, 'rodando backup de recuperação');

      const snapshot = await rodarBackup(printerId);

      if (snapshot) {
        await criarAlerta({
          printerId,
          printerNome: printer.nome,
          sev: 'baixa',
          titulo: 'Backup de recuperação executado',
          detalhe: desde
            ? `${printer.nome} ficou fora do ar durante a janela de backup — o último era de ${quando(desde)}. Um backup foi feito assim que ela voltou à rede.`
            : `${printer.nome} nunca tinha sido copiada. O primeiro backup foi feito assim que ela apareceu na rede.`,
          frameLabel: `CAM ${printerId}`
        });
      }

      // espaçamento entre máquinas: a fazenda religando junto não pode virar
      // oito downloads ao mesmo tempo
      if (pendentes.size > 0) {
        await new Promise((r) => setTimeout(r, ESPACAMENTO_MS));
      }
    }
  } catch (err) {
    logger.error({ err }, 'falha no verificador de backup');
  } finally {
    processando = false;
  }
}

export function ligarVerificadorDeBackup(): void {
  farm.on('printer', (atual: Printer, anterior: Printer | null) => {
    const apareceu = (!anterior && atual.online) || (anterior && !anterior.online && atual.online);

    if (apareceu && !agendadas.has(atual.id)) {
      agendadas.add(atual.id);
      // dá tempo do Klipper subir: perguntar cedo demais devolve erro e
      // marcaria o backup como falho sem motivo
      setTimeout(() => verificar(atual.id), config.backupEsperaAposOnlineMs).unref();
    }

    // ficou ociosa: é a hora de rodar o que estava esperando a impressão acabar
    if (pendentes.has(atual.id) && podeRodarAgora(atual)) {
      void processarPendentes();
    }
  });

  logger.info(
    `verificador de backup ligado: recupera quem passar de ${intervaloBackupHoras()} h sem backup ao voltar à rede`
  );
}

/** Só para os testes: limpa o estado entre casos. */
export function _limparEstado(): void {
  pendentes.clear();
  agendadas.clear();
  processando = false;
}
