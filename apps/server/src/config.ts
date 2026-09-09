import { randomBytes } from 'node:crypto';
import path from 'node:path';

function bool(v: string | undefined, padrao: boolean): boolean {
  if (v == null || v === '') return padrao;
  return v === '1' || v.toLowerCase() === 'true';
}

function int(v: string | undefined, padrao: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

/** Como `int`, mas guarda a parte fracionária — limiares vão de 0 a 1. */
function num(v: string | undefined, padrao: number): number {
  if (v == null || v === '') return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');

export const config = {
  port: int(process.env.PORT, 8080),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  get isProd() {
    return this.nodeEnv === 'production';
  },

  dataDir,
  dbPath: path.join(dataDir, 'fazenda.db'),
  backupsDir: path.join(dataDir, 'backups'),
  framesDir: path.join(dataDir, 'frames'),
  thumbsDir: path.join(dataDir, 'thumbs'),
  /** store de G-code endereçado por hash — 8 máquinas repetem muito arquivo */
  blobsDir: path.join(dataDir, 'blobs'),

  /** dist do build do Vite; só existe em produção */
  webDir: path.resolve(process.env.WEB_DIR ?? './apps/web/dist'),

  /** Sem JWT_SECRET a sessão não sobrevive a um restart — avisamos no boot. */
  /**
   * Flag Secure do cookie de sessão: 'auto' decide por requisição (Secure só
   * quando a conexão de fato é HTTPS). Amarrar isso a NODE_ENV quebra a
   * fazenda: o container roda em produção mas é acessado por http:// na rede
   * local, e o navegador descarta um cookie Secure vindo de origem insegura.
   */
  cookieSecure: (process.env.COOKIE_SECURE ?? 'auto') as 'auto' | 'true' | 'false',

  jwtSecret: process.env.JWT_SECRET ?? randomBytes(32).toString('hex'),
  jwtSecretGerado: !process.env.JWT_SECRET,
  sessaoCurtaHoras: int(process.env.SESSION_HOURS, 12),
  sessaoLongaDias: int(process.env.SESSION_REMEMBER_DAYS, 30),

  adminUser: process.env.ADMIN_USER ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',

  /**
   * Fila automática: quando ligada, a próxima impressão começa sozinha assim
   * que a máquina fica ociosa. Desligada por padrão de propósito — numa fazenda
   * a peça anterior continua na mesa, e começar por cima dela estraga as duas.
   * Com ela desligada, cada impressão precisa de um clique de autorização.
   */
  filaAutomatica: bool(process.env.QUEUE_AUTO_START, false),

  /** Sobe um Moonraker falso com as 8 impressoras do design — testar sem hardware. */
  mockPrinters: bool(process.env.MOCK_PRINTERS, false),

  backupCron: process.env.BACKUP_CRON ?? '0 3 * * *',
  /**
   * Quanto tempo um backup pode ficar velho antes de ser considerado vencido.
   * É o que o verificador usa quando uma impressora volta à rede: se o último
   * backup dela é mais antigo que isto, roda um de recuperação na hora.
   */
  backupIntervaloHoras: int(process.env.BACKUP_INTERVAL_HOURS ?? process.env.BACKUP_INTERVALO_HORAS, 24),
  /** Espera depois de a impressora aparecer, para o Klipper terminar de subir. */
  backupEsperaAposOnlineMs: int(process.env.BACKUP_WAIT_AFTER_ONLINE_MS ?? process.env.BACKUP_ESPERA_ONLINE_MS, 30_000),
  backupRetencao: int(process.env.BACKUP_KEEP, 7),
  backupIncluiGcode: bool(process.env.BACKUP_GCODE, true),
  /** teto por impressora para o download de G-code, evita encher o volume */
  backupGcodeMaxBytes: int(process.env.BACKUP_GCODE_MAX_BYTES, 2 * 1024 * 1024 * 1024),

  /**
   * Por quantos dias guardar o quadro da câmera anexado a um alerta.
   * Passado esse tempo a imagem não diz mais nada e só ocupa disco — o alerta
   * em si continua no histórico, sem a foto.
   */
  alertaFrameDias: int(process.env.ALERT_FRAME_KEEP_DAYS, 14),

  /** quadros por segundo do proxy MJPEG quando o cliente não pede nada */
  cameraFpsPadrao: int(process.env.CAMERA_FPS, 5),
  cameraTimeoutMs: int(process.env.CAMERA_TIMEOUT_MS, 60_000),

  /**
   * Detecção de falha pela câmera. Desligada por padrão: precisa baixar um
   * modelo, e um recurso que pausa impressão sozinho não deve aparecer sem
   * alguém ter pedido.
   *
   * O custo no Raspberry Pi vem de três escolhas, e não do modelo: só olha
   * quem está imprimindo, uma inferência por vez na fazenda inteira, e um
   * quadro a cada `intervaloS` por máquina.
   */
  deteccaoLigada: bool(process.env.DETECCAO_ENABLED, false),
  /**
   * Segundos entre duas análises da mesma impressora. Espaguete não aparece e
   * some em dois segundos — quando aparece, fica — então olhar mais vezes
   * gasta CPU sem enxergar nada de novo.
   */
  deteccaoIntervaloS: int(process.env.DETECCAO_INTERVALO_S, 25),
  /** confiança mínima do modelo para a amostra contar como suspeita */
  deteccaoLimiar: num(process.env.DETECCAO_LIMIAR, 0.55),
  /**
   * Quantas amostras suspeitas seguidas confirmam a falha. Com 3 e o intervalo
   * padrão são ~75 s de evidência contínua: o bico passando na frente da
   * câmera, um quadro borrado ou um reflexo não derrubam impressão nenhuma.
   */
  deteccaoConfirmacoes: int(process.env.DETECCAO_CONFIRMACOES, 3),
  /**
   * Quanto esperar depois de a impressão começar. A linha de purga e a saia
   * são exatamente o que o modelo foi treinado a chamar de emaranhado.
   */
  deteccaoEsperaInicialS: int(process.env.DETECCAO_ESPERA_INICIAL_S, 120),
  /** ação padrão de quem não escolheu a sua; veja AcaoDeteccao no shared */
  deteccaoAcao: process.env.DETECCAO_ACAO ?? 'pausar',
  /** threads do WASM; 1 num Pi que já esteja apertado */
  deteccaoThreads: int(process.env.DETECCAO_THREADS, 2),
  /**
   * Índice da classe "espaguete" na saída do modelo. O padrão vale para o
   * modelo que documentamos (spaghetti, stringing, zits); um modelo exportado
   * com as classes noutra ordem só precisa deste número.
   *
   * As outras duas classes são ignoradas de propósito: numa webcam a dois
   * metros, fiapo e bolinha estão abaixo do ruído e só serviriam de fábrica de
   * alarme falso.
   */
  deteccaoClasse: int(process.env.DETECCAO_CLASSE, 0),
  /** de onde baixar o .onnx na primeira vez, e o SHA-256 que ele deve ter */
  deteccaoModeloUrl: process.env.DETECCAO_MODELO_URL ?? '',
  deteccaoModeloSha256: (process.env.DETECCAO_MODELO_SHA256 ?? '').toLowerCase(),
  modelosDir: path.join(dataDir, 'modelos'),
  /**
   * Só desenvolvimento: força a confiança devolvida pelo classificador, para
   * percorrer o caminho inteiro — alerta, foto no Telegram, pausa — sem ter um
   * espaguete de verdade na frente de uma câmera. Vazio desliga.
   */
  deteccaoSimularConf: process.env.DETECCAO_SIMULAR_CONF ?? '',

  /**
   * Telegram. Servem de valor inicial: o que estiver no banco (tela de gestão)
   * ganha destes, do mesmo jeito que o intervalo de backup.
   */
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  /** base da API, trocável nos testes por um servidor local */
  telegramApiBase: process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org',
  /**
   * Endereço público do painel, se houver — vira o link "abrir no painel" no
   * rodapé da notificação. É onde entra o hostname de um túnel.
   */
  appBaseUrl: (process.env.APP_BASE_URL ?? '').replace(/\/+$/, ''),

  logLevel: process.env.LOG_LEVEL ?? 'info'
};

export type Config = typeof config;
