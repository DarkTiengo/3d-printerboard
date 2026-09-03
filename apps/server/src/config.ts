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

  /** quadros por segundo do proxy MJPEG quando o cliente não pede nada */
  cameraFpsPadrao: int(process.env.CAMERA_FPS, 5),
  cameraTimeoutMs: int(process.env.CAMERA_TIMEOUT_MS, 60_000),

  logLevel: process.env.LOG_LEVEL ?? 'info'
};

export type Config = typeof config;
