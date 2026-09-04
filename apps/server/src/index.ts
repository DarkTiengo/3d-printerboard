import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { abrirBanco, fecharBanco } from './db/index.js';
import { garantirAdmin } from './services/auth.js';
import { farm } from './services/farm.js';
import { cameras } from './services/cameras.js';
import { criarApp } from './app.js';
import { hub, ligarFarmAoHub } from './routes/stream.js';
import { ligarGeradorDeAlertas, aoCriarAlerta, criarAlerta, podarFrames } from './services/alerts.js';
import { ligarMotorDaFila, aoMudarFila, listarFila } from './services/queue.js';
import { aoMudarBackup, cardsDeBackup, resumoDeBackup } from './services/backup.js';
import { ligarAgendaDeBackup, rodarCicloCompleto } from './services/backup-agenda.js';
import { ligarNotificacoes } from './services/notificacoes.js';
import { ligarBot, pararBot } from './services/bot-telegram.js';
import { criarClienteMock, criarHttpMock, semearImpressoras } from './moonraker/mock.js';
import { farmPrinterNome } from './lib/util.js';

async function main(): Promise<void> {
  abrirBanco();
  garantirAdmin();

  if (config.jwtSecretGerado) {
    logger.warn('JWT_SECRET não definido — um segredo aleatório foi gerado e todas as sessões cairão no próximo restart.');
  }

  if (config.mockPrinters) {
    logger.warn('MOCK_PRINTERS ligado: nenhuma impressora real será contatada.');
    semearImpressoras();
    farm.criarCliente = criarClienteMock;
    farm.criarHttp = criarHttpMock;
  }

  // ── fiação dos serviços ──────────────────────────────────────────────────
  ligarFarmAoHub();
  ligarGeradorDeAlertas();
  ligarMotorDaFila();
  ligarAgendaDeBackup();

  aoCriarAlerta((alerta) => hub.publicar({ tipo: 'alerta', alerta }));
  // segundo inscrito nos alertas: o que sai da fazenda
  ligarNotificacoes();
  ligarBot();
  aoMudarFila(() => hub.publicar({ tipo: 'fila', fila: listarFila() }));
  aoMudarBackup(() => hub.publicar({ tipo: 'backup', resumo: resumoDeBackup(), cards: cardsDeBackup() }));

  farm.iniciar();

  // ── agendamentos ─────────────────────────────────────────────────────────
  if (cron.validate(config.backupCron)) {
    cron.schedule(config.backupCron, () => {
      logger.info('ciclo de backup agendado disparado');
      // quem estiver imprimindo entra na fila e é copiada ao ficar ociosa
      rodarCicloCompleto('ciclo');
    });
    logger.info(`backup agendado: ${config.backupCron}`);
  } else {
    logger.error(`BACKUP_CRON inválido ("${config.backupCron}") — o backup automático está desligado.`);
  }

  // câmera que parou de mandar quadro vira alerta de severidade média
  setInterval(() => {
    for (const id of cameras.verificarSilenciosas()) {
      void criarAlerta({
        printerId: id,
        printerNome: farmPrinterNome(id),
        sev: 'media',
        codigo: 'camera_muda',
        titulo: 'Câmera parou de responder',
        detalhe: `Nenhum quadro novo nos últimos ${Math.round(config.cameraTimeoutMs / 1000)} s, mas a conexão segue aberta.`,
        frameLabel: 'ÚLTIMO FRAME RECEBIDO',
        dedupeKey: `camera-mudo:${id}`
      });
    }
  }, 30_000).unref();

  // quadros de alerta velhos saem do disco; o alerta fica, sem a foto
  void podarFrames();
  setInterval(() => void podarFrames(), 6 * 60 * 60_000).unref();

  // ── servidor ─────────────────────────────────────────────────────────────
  const app = await criarApp();
  await app.listen({ port: config.port, host: config.host });
  logger.info(`3D Printerboard no ar em http://${config.host}:${config.port}`);

  const encerrar = async (sinal: string) => {
    logger.info(`${sinal} recebido, encerrando…`);
    try {
      await app.close();
      pararBot();
      farm.parar();
      cameras.parar();
      fecharBanco();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void encerrar('SIGINT'));
  process.on('SIGTERM', () => void encerrar('SIGTERM'));
}

main().catch((err) => {
  logger.error(err, 'falha ao subir o servidor');
  process.exit(1);
});
