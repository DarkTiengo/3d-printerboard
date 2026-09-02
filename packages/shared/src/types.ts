/**
 * Modelo compartilhado entre servidor e front.
 * A base é o § "Estado" do design/README.md — os rótulos ficam em português
 * porque são renderizados direto na UI.
 */

export type Status = 'imprimindo' | 'pausada' | 'cancelada' | 'ociosa' | 'atenção';

/** Impressora normalizada, do jeito que a UI consome. */
export type Printer = {
  id: string; // 'P01'
  nome: string; // 'Ender 3 V2 — A'
  job: string; // 'suporte_camera_v3.gcode'
  pct: number; // 0-100
  restante: string; // '1h 14m'
  camada: string; // '84/210'
  status: Status;
  /** false quando o WebSocket do Moonraker está caído ou o Klipper não respondeu. */
  online: boolean;
  temTaCamera: boolean;
  temperaturas: Temperatura[];
  posicao: Posicao | null;
  macros: string[];
};

export type Temperatura = {
  item: string; // 'Bico' | 'Mesa'
  atual: string; // '210,4 °C'
  alvo: string; // '210 °C'
};

export type Posicao = { x: number; y: number; z: number };

/** Registro de configuração da impressora (tela de gestão). */
export type PrinterConfig = {
  id: string;
  nome: string;
  moonrakerUrl: string;
  apiKey: string | null;
  cameraUrl: string | null;
  backupEnabled: boolean;
  ordem: number;
};

export type PrinterConfigInput = Omit<PrinterConfig, 'id' | 'ordem'> & {
  id?: string;
  ordem?: number;
};

// ── Usuários ────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'operador' | 'leitura';

export type User = {
  id: number;
  username: string;
  role: Role;
};

/** Quem pode fazer o quê. Checado no servidor; espelhado no front para desabilitar botões. */
export const PODE = {
  controlarImpressao: ['admin', 'operador'] as Role[],
  pararEmergencia: ['admin', 'operador'] as Role[],
  enfileirar: ['admin', 'operador'] as Role[],
  rodarBackup: ['admin', 'operador'] as Role[],
  restaurarBackup: ['admin'] as Role[],
  resolverAlerta: ['admin', 'operador'] as Role[],
  gerirImpressoras: ['admin'] as Role[],
  gerirUsuarios: ['admin'] as Role[]
};

export type Acao = keyof typeof PODE;

export function pode(role: Role | undefined, acao: Acao): boolean {
  return !!role && PODE[acao].includes(role);
}

// ── Arquivos ────────────────────────────────────────────────────────────────

export type GcodeFile = {
  /** caminho relativo dentro do root `gcodes`, é a chave de verdade */
  path: string;
  nome: string; // sem extensão, para o título do card
  perfil: string; // 'PLA 0.20 / 3 paredes'
  tempo: string; // '4h 10m'
  filamento: string; // '86 g'
  impressoes: string; // '12'
  thumbnailUrl: string | null;
  /** impressora de onde o arquivo foi listado */
  printerId: string;
};

// ── Fila ────────────────────────────────────────────────────────────────────

export type QueueStatus = 'pendente' | 'atribuido' | 'imprimindo' | 'concluido' | 'falhou' | 'cancelado';

export type QueueJob = {
  id: number;
  arquivo: string; // 'clipe_cabo_x12.gcode'
  /** null = "próxima livre" */
  destino: string | null;
  destinoNome: string; // 'Prusa MK4' | 'próxima livre'
  tempo: string; // '4h 25m'
  status: QueueStatus;
  printerId: string | null;
  criadoEm: string;
  erro: string | null;
};

// ── Alertas ─────────────────────────────────────────────────────────────────

export type Severidade = 'alta' | 'media' | 'baixa';

export type Alert = {
  id: number;
  titulo: string;
  impressora: string; // nome da impressora
  printerId: string | null;
  quando: string; // 'há 6 min' — formatado no servidor
  criadoEm: string;
  sev: Severidade;
  detalhe: string;
  frame: string; // legenda do frame, ex.: 'FRAME DO ALERTA — CAM P06'
  frameUrl: string | null;
  resolvidoEm: string | null;
  resolvidoPor: string | null;
};

// ── Backups ─────────────────────────────────────────────────────────────────

export type BackupEstado = 'OK' | 'PARCIAL' | 'FALHOU' | 'NUNCA';

export type BackupCard = {
  printerId: string;
  nome: string;
  estado: BackupEstado;
  perfis: string; // 'hoje 03:00'
  firmware: string; // 'Klipper v0.12 · há 6 d'
  gcode: string; // '42 arq. · 1,1 GB'
  /** Na fila, esperando a impressora ficar ociosa para ser copiada. */
  pendente: boolean;
};

export type BackupResumo = {
  rotina: string; // 'diário 03:00'
  ultimoCiclo: string; // 'hoje 03:03'
  armazenado: string; // '5,5 GB'
  falhas: number;
};

export type BackupSnapshot = {
  id: number;
  printerId: string;
  quando: string;
  criadoEm: string;
  estado: BackupEstado;
  tamanho: string;
  arquivos: number;
};

// ── Stream (SSE) ────────────────────────────────────────────────────────────

export type StreamEvent =
  | { tipo: 'printers'; printers: Printer[] }
  | { tipo: 'printer'; printer: Printer }
  | { tipo: 'alerta'; alerta: Alert }
  | { tipo: 'fila'; fila: QueueJob[] }
  | { tipo: 'backup'; resumo: BackupResumo; cards: BackupCard[] };

// ── Payloads de comando ─────────────────────────────────────────────────────

export type JogPayload = { eixo: 'X' | 'Y' | 'Z'; passo: number };
export type GcodePayload = { script: string };
export type LoginPayload = { usuario: string; senha: string; lembrar: boolean };
export type EnqueuePayload = { arquivo: string; destino: string | null };
export type RestorePayload = { snapshotId: number; destinoPrinterId: string };
