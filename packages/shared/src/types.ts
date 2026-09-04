/**
 * Modelo compartilhado entre servidor e front.
 * A base é o § "Estado" do design/README.md — os rótulos ficam em português
 * porque são renderizados direto na UI.
 */

export type Status = 'imprimindo' | 'pausada' | 'cancelada' | 'ociosa' | 'atenção';

/**
 * Estado do Klipper visto pelo Moonraker. Não é o mesmo que `Status`: descreve
 * o firmware, não o trabalho. 'shutdown' e 'error' são o Klipper vivo mas
 * parado (MCU perdido, config quebrada, thermal runaway); 'disconnected' é o
 * processo do Klipper fora do ar, com o Moonraker ainda de pé.
 */
export type EstadoKlippy = 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected';

/** Impressora normalizada, do jeito que a UI consome. */
export type Printer = {
  id: string; // 'P01'
  nome: string; // 'Ender 3 V2 — A'
  job: string; // 'suporte_camera_v3.gcode'
  pct: number; // 0-100
  /**
   * Segundos restantes, ou null quando não dá para estimar. O rótulo é montado
   * no front: o servidor não sabe em que idioma a tela está.
   */
  restanteSegundos: number | null;
  camada: string; // '84/210'
  status: Status;
  /**
   * A última impressão terminou inteira (e não cancelada nem por erro). É o que
   * habilita a oferta de reimprimir a peça.
   */
  concluiuComSucesso: boolean;
  /** false quando o WebSocket do Moonraker está caído ou o Klipper não respondeu. */
  online: boolean;
  /**
   * Estado do firmware. Fora de 'ready' a máquina não aceita comandos e os
   * outros campos são o último valor conhecido, não o valor de agora.
   */
  klippy: EstadoKlippy;
  /** Motivo cru do Klipper quando `klippy` não é 'ready' — a primeira linha do
   * `state_message`, ex.: "MCU 'mcu' shutdown: Lost communication with MCU". */
  mensagemKlippy: string | null;
  temTaCamera: boolean;
  temperaturas: Temperatura[];
  posicao: Posicao | null;
  macros: string[];
};

export type Temperatura = {
  /** identifica o sensor sem depender de idioma */
  chave: 'bico' | 'mesa';
  atual: number | null;
  /** 0 significa desligado */
  alvo: number | null;
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
  /*
   * O reinício do host se desfaz sozinho — a máquina volta em um minuto — e é
   * a saída para um Klipper travado, então acompanha a parada de emergência.
   * O desligamento não volta sem alguém no lugar apertando o botão, e por isso
   * fica só com quem administra a fazenda.
   */
  reiniciarMaquina: ['admin', 'operador'] as Role[],
  desligarMaquina: ['admin'] as Role[],
  enfileirar: ['admin', 'operador'] as Role[],
  rodarBackup: ['admin', 'operador'] as Role[],
  restaurarBackup: ['admin'] as Role[],
  resolverAlerta: ['admin', 'operador'] as Role[],
  gerirImpressoras: ['admin'] as Role[],
  /* um token de bot é credencial: mesmo nível de quem cadastra impressoras */
  gerirNotificacoes: ['admin'] as Role[],
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
  /** null = "próxima livre"; o rótulo é montado no front */
  destino: string | null;
  tempo: string; // '4h 25m'
  status: QueueStatus;
  printerId: string | null;
  criadoEm: string;
  erro: string | null;
};

// ── Alertas ─────────────────────────────────────────────────────────────────

export type Severidade = 'critica' | 'alta' | 'media' | 'baixa';

/**
 * Ordem de exibição: o mais grave primeiro, e só então o mais recente. Numa
 * fazenda com dezenas de alertas abertos, um MCU perdido não pode ficar
 * embaixo de três "impressão concluída".
 */
export const PESO_SEVERIDADE: Record<Severidade, number> = { critica: 0, alta: 1, media: 2, baixa: 3 };

/** Comparador pronto para `sort` — grave primeiro, recente primeiro. */
export function porGravidade(a: Alert, b: Alert): number {
  const peso = PESO_SEVERIDADE[a.sev] - PESO_SEVERIDADE[b.sev];
  return peso !== 0 ? peso : b.criadoEm.localeCompare(a.criadoEm);
}

export type Alert = {
  id: number;
  /** chave estável do tipo de alerta, para o front traduzir o título */
  codigo: string;
  /** título como o servidor escreveu — usado quando o código é desconhecido */
  titulo: string;
  impressora: string; // nome da impressora
  printerId: string | null;
  criadoEm: string;
  sev: Severidade;
  detalhe: string;
  frame: string; // legenda do frame, ex.: 'FRAME DO ALERTA — CAM P06'
  frameUrl: string | null;
  resolvidoEm: string | null;
  resolvidoPor: string | null;
};

// ── Notificações ────────────────────────────────────────────────────────────

/**
 * O que mandar para fora, e para onde.
 *
 * O token do bot não está aqui de propósito: ele nunca sai do servidor, do
 * mesmo jeito que a chave de API do Moonraker. A tela sabe apenas se existe um,
 * por `NotificacaoConfig.tokenDefinido`.
 */
export type NotificacaoPrefs = {
  ligado: boolean;
  /** chat, grupo ou canal de destino — o `chat_id` do Telegram */
  chatId: string;
  /**
   * Códigos de alerta que geram mensagem. É lista de inclusão, e não um limiar
   * de severidade, porque "problemas e fim de impressão" mistura os extremos:
   * `impressao_concluida` é baixa e `backup_recuperacao` também.
   */
  codigos: string[];
  /** Avisa também quando o alerta se resolve sozinho. */
  avisarResolucao: boolean;
  /**
   * Responde /status no chat. Separado de `ligado` porque são vontades
   * diferentes: dá para querer perguntar sem querer ser avisado.
   */
  responderComandos: boolean;
};

/** O que aconteceu com os últimos envios — a tela mostra para dar diagnóstico. */
export type NotificacaoEstado = {
  ultimoEnvioEm: string | null;
  ultimoErro: string | null;
  ultimoErroEm: string | null;
};

export type NotificacaoConfig = {
  prefs: NotificacaoPrefs;
  tokenDefinido: boolean;
  estado: NotificacaoEstado;
};

/**
 * Todo alerta que o servidor sabe emitir, com a severidade que ele usa. É a
 * fonte única: o servidor valida contra ela e a tela monta as caixas a partir
 * dela, agrupadas por severidade. Um código novo em `alerts.ts` precisa entrar
 * aqui para virar notificação.
 */
export const CODIGOS_DE_ALERTA: { codigo: string; sev: Severidade }[] = [
  { codigo: 'klipper_parado', sev: 'critica' },
  { codigo: 'impressora_offline', sev: 'critica' },
  { codigo: 'erro_impressao', sev: 'alta' },
  { codigo: 'backup_falhou', sev: 'alta' },
  { codigo: 'filamento_acabando', sev: 'media' },
  { codigo: 'camera_offline', sev: 'media' },
  { codigo: 'camera_muda', sev: 'media' },
  { codigo: 'backup_esperando', sev: 'media' },
  { codigo: 'impressao_concluida', sev: 'baixa' },
  { codigo: 'backup_recuperacao', sev: 'baixa' }
];

/**
 * O que notifica sem ninguém configurar nada: os problemas, mais o fim de
 * impressão. Fica de fora o que é ruído para quem só quer saber de máquina
 * parada — câmera muda, backup em espera e backup de recuperação.
 */
export const CODIGOS_PADRAO = [
  'klipper_parado',
  'impressora_offline',
  'erro_impressao',
  'backup_falhou',
  'filamento_acabando',
  'impressao_concluida'
];

/** Sentinela de "mantém o que está guardado" — igual ao da chave do Moonraker. */
export const SEGREDO_MASCARADO = '••••••••';

// ── Backups ─────────────────────────────────────────────────────────────────

export type BackupEstado = 'OK' | 'PARCIAL' | 'FALHOU' | 'NUNCA';

export type BackupCard = {
  printerId: string;
  nome: string;
  estado: BackupEstado;
  /** ISO do último backup, ou null se nunca houve — o front formata */
  ultimoEm: string | null;
  firmware: string; // 'Klipper v0.12.0' — versão, não depende de idioma
  gcodeArquivos: number;
  bytes: number;
  /** Na fila, esperando a impressora ficar ociosa para ser copiada. */
  pendente: boolean;
  /** O que esta máquina copia, de quanto em quanto tempo e quantas cópias guarda. */
  prefs: BackupPrefs;
  /** Quantas cópias existem guardadas hoje. */
  copias: number;
};

/**
 * O que entra no backup de uma impressora.
 *
 * `config` é printer.cfg e macros, `banco` são os perfis do Mainsail/Fluidd,
 * `sistema` é versão de firmware e calibração, `gcode` é a biblioteca de peças
 * — de longe a mais pesada, por isso é a que mais se desliga por máquina.
 */
export type BackupSecao = 'config' | 'banco' | 'sistema' | 'gcode';

export const BACKUP_SECOES: BackupSecao[] = ['config', 'banco', 'sistema', 'gcode'];

export type BackupPrefs = {
  printerId: string;
  secoes: BackupSecao[];
  /**
   * Caminhos de config desmarcados pelo usuário. É lista de exclusão, não de
   * inclusão, de propósito: um arquivo novo que apareça na impressora entra no
   * backup sozinho, em vez de ficar de fora até alguém lembrar de marcá-lo.
   */
  excluidos: string[];
  /** null = usa o intervalo global */
  intervaloHoras: number | null;
  /** null = usa a retenção global; quantas cópias guardar antes de apagar */
  retencao: number | null;
};

export type BackupPrefsInput = {
  secoes?: BackupSecao[];
  excluidos?: string[];
  intervaloHoras?: number | null;
  retencao?: number | null;
};

/** Os valores globais que valem quando a impressora não tem os seus. */
export type BackupPadroes = { intervaloHoras: number; retencao: number };

/** Um arquivo de config visto na impressora, para a tela de seleção. */
export type ArquivoDeConfig = { caminho: string; bytes: number; incluso: boolean };

export type BackupResumo = {
  /** expressão cron crua; o front descreve em palavras */
  cron: string;
  ultimoCicloEm: string | null;
  bytes: number;
  falhas: number;
  /** intervalo e retenção que valem para quem não configurou os seus */
  padroes: BackupPadroes;
};

export type BackupSnapshot = {
  id: number;
  printerId: string;
  criadoEm: string;
  estado: BackupEstado;
  bytes: number;
  arquivos: number;
  /** quantos G-code o snapshot referencia — decide a oferta de baixar com eles */
  gcodeArquivos: number;
  /** formato do arquivo guardado; `tar.gz` é de snapshots anteriores à mudança */
  formato: 'zip' | 'tar.gz';
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
