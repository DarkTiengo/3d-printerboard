import type {
  Alert,
  ArquivoDeConfig,
  BackupCard,
  BackupPadroes,
  BackupPrefs,
  BackupPrefsInput,
  BackupResumo,
  BackupSnapshot,
  GcodeFile,
  NotificacaoConfig,
  NotificacaoPrefs,
  Printer,
  PrinterConfig,
  QueueJob,
  Role,
  User
} from '@3dfarm/shared';

/**
 * Mensagens da camada de rede. Ficam aqui, e não no dicionário, porque este
 * módulo não é um componente e não tem acesso ao hook — quem troca o idioma
 * atualiza este objeto.
 */
export const MENSAGENS = { semServidor: 'Could not reach the server.', erro: 'Error' };

export function definirMensagensDaApi(m: { semServidor: string; erro: string }): void {
  MENSAGENS.semServidor = m.semServidor;
  MENSAGENS.erro = m.erro;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Base da API.
 *
 * Sempre a mesma origem: o app é servido pelo próprio agregador, então o
 * endereço do servidor é, por definição, de onde esta página veio. Caminhos
 * relativos também mantêm o cookie de sessão e o proxy de câmera na origem
 * única — sem CORS e sem conteúdo misto.
 */
export function urlDaApi(caminho: string): string {
  return caminho;
}

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(urlDaApi(caminho), {
      credentials: 'include',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init
    });
  } catch {
    // rede caiu ou o endereço do servidor está errado — a tela de login trata
    throw new ApiError(MENSAGENS.semServidor, 0);
  }

  if (res.status === 204) return undefined as T;

  const texto = await res.text();
  const corpo = texto ? safeJson(texto) : null;

  if (!res.ok) {
    throw new ApiError(corpo?.erro ?? `${MENSAGENS.erro} ${res.status}`, res.status);
  }
  return corpo as T;
}

function safeJson(texto: string): any {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

const get = <T,>(c: string) => pedir<T>(c);
const post = <T,>(c: string, body?: unknown) =>
  pedir<T>(c, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T,>(c: string, body?: unknown) =>
  pedir<T>(c, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T,>(c: string) => pedir<T>(c, { method: 'DELETE' });

export const api = {
  // auth
  login: (usuario: string, senha: string, lembrar: boolean) =>
    post<{ usuario: User }>('/api/auth/login', { usuario, senha, lembrar }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  eu: () => get<{ usuario: User }>('/api/auth/eu'),

  // usuários
  usuarios: () => get<User[]>('/api/usuarios'),
  criarUsuario: (usuario: string, senha: string, role: Role) => post<User>('/api/usuarios', { usuario, senha, role }),
  trocarSenha: (id: number, senha: string) => put<{ ok: true }>(`/api/usuarios/${id}/senha`, { senha }),
  removerUsuario: (id: number) => del<{ ok: true }>(`/api/usuarios/${id}`),

  // impressoras
  printers: () => get<Printer[]>('/api/printers'),
  resumo: () => get<{ ativas: number; fila: number; atencao: number; alertasAbertos: number; texto: string }>('/api/resumo'),
  pausar: (id: string) => post<{ ok: true }>(`/api/printers/${id}/pause`),
  continuar: (id: string) => post<{ ok: true }>(`/api/printers/${id}/resume`),
  cancelar: (id: string) => post<{ ok: true }>(`/api/printers/${id}/cancel`),
  jog: (id: string, eixo: 'X' | 'Y' | 'Z', passo: number) => post<{ ok: true }>(`/api/printers/${id}/jog`, { eixo, passo }),
  home: (id: string) => post<{ ok: true }>(`/api/printers/${id}/home`),
  gcode: (id: string, script: string) => post<{ ok: true }>(`/api/printers/${id}/gcode`, { script }),
  paradaEmergencia: () => post<{ ok: boolean; total: number; falhas: string[] }>('/api/emergency-stop'),
  // energia do host: falam com o Moonraker, então valem com o Klipper caído
  reiniciarMaquina: (id: string) => post<{ ok: true }>(`/api/printers/${id}/machine/reboot`),
  desligarMaquina: (id: string) => post<{ ok: true }>(`/api/printers/${id}/machine/shutdown`),

  // gestão
  configPrinters: () => get<PrinterConfig[]>('/api/config/printers'),
  criarPrinter: (p: Partial<PrinterConfig>) => post<PrinterConfig>('/api/config/printers', p),
  atualizarPrinter: (id: string, p: Partial<PrinterConfig>) => put<PrinterConfig>(`/api/config/printers/${id}`, p),
  removerPrinter: (id: string) => del<{ ok: true }>(`/api/config/printers/${id}`),
  // notificações
  notificacoes: () => get<NotificacaoConfig>('/api/config/notificacoes'),
  salvarNotificacoes: (p: NotificacaoPrefs & { token?: string }) =>
    put<NotificacaoConfig>('/api/config/notificacoes', p),
  // como o teste de impressora, responde 200 com { ok, erro } — a recusa do
  // Telegram aparece ao lado do botão, não num catch
  testarNotificacoes: (p: { token?: string; chatId: string }) =>
    post<{ ok: boolean; erro?: string }>('/api/config/notificacoes/testar', p),

  testarPrinter: (p: Partial<PrinterConfig>) =>
    post<{
      ok: boolean;
      versao?: string;
      hostname?: string;
      erro?: string;
      /** null quando não havia URL informada e nada foi descoberto */
      camera?: {
        ok: boolean;
        erro?: string;
        /** a URL que respondeu — pode ter sido descoberta pelo servidor */
        url?: string;
        nome?: string;
        descoberta?: boolean;
        /** um quadro em data URL, para a prévia no formulário */
        preview?: string;
      } | null;
    }>('/api/config/printers/testar', p),

  // arquivos e fila
  arquivos: () => get<GcodeFile[]>('/api/arquivos'),
  fila: () => get<QueueJob[]>('/api/fila'),
  enfileirar: (arquivo: string, destino: string | null) => post<QueueJob>('/api/fila', { arquivo, destino }),
  cancelarJob: (id: number) => del<QueueJob>(`/api/fila/${id}`),
  filaDaImpressora: (id: string) => get<QueueJob[]>(`/api/printers/${id}/fila`),
  /** Autoriza e inicia: nada na fila começa sem passar por aqui. */
  iniciarJob: (jobId: number, printerId: string) => post<QueueJob>(`/api/fila/${jobId}/iniciar`, { printerId }),
  reimprimir: (printerId: string) => post<QueueJob>(`/api/printers/${printerId}/reimprimir`),

  // alertas
  alertas: () => get<Alert[]>('/api/alertas'),
  resolverAlerta: (id: number) => post<Alert>(`/api/alertas/${id}/resolver`),

  // backups
  backups: () => get<{ resumo: BackupResumo; cards: BackupCard[] }>('/api/backups'),
  snapshots: (printer?: string) =>
    get<BackupSnapshot[]>(`/api/backups/snapshots${printer ? `?printer=${encodeURIComponent(printer)}` : ''}`),
  rodarBackupTodas: () =>
    post<{ ok: true; iniciados: number; adiados: number; offline: number; adiadasIds: string[] }>(
      '/api/backups/rodar'
    ),
  rodarBackup: (id: string) =>
    post<{ ok: true; resultado: 'iniciado' | 'adiado'; nome: string }>(`/api/backups/${id}/rodar`),
  restaurar: (snapshotId: number, destinoPrinterId: string) =>
    post<{ ok: true; arquivos: number }>('/api/backups/restaurar', { snapshotId, destinoPrinterId, confirmar: true }),
  prefsBackup: (id: string) => get<{ prefs: BackupPrefs; padroes: BackupPadroes }>(`/api/backups/${id}/prefs`),
  salvarPrefsBackup: (id: string, prefs: BackupPrefsInput) =>
    put<{ ok: true; prefs: BackupPrefs; padroes: BackupPadroes }>(`/api/backups/${id}/prefs`, prefs),
  /** lista ao vivo, direto da impressora — só responde com ela na rede */
  arquivosDeConfig: (id: string) => get<ArquivoDeConfig[]>(`/api/backups/${id}/arquivos`)
};

/**
 * Endereço para baixar uma cópia. É um link normal: mesma origem, cookie de
 * sessão junto, e o navegador salva o arquivo sem passar pelo JavaScript.
 */
export function urlDownloadBackup(snapshotId: number, comGcode: boolean): string {
  return urlDaApi(`/api/backups/snapshots/${snapshotId}/baixar${comGcode ? '?gcode=1' : ''}`);
}

/** URL do stream MJPEG de uma câmera, na taxa pedida. */
export function urlCamera(printerId: string, fps: number): string {
  return urlDaApi(`/api/printers/${printerId}/camera?fps=${fps}`);
}

/**
 * `maxIdade` diz ao servidor o quão velho o quadro em cache pode ser: um tile
 * pedindo 2 vezes por segundo aceita 400 ms, e assim vários espectadores da
 * mesma câmera compartilham o mesmo quadro sem tráfego extra para a máquina.
 */
export function urlSnapshot(printerId: string, cacheBuster?: number, maxIdade?: number): string {
  const q = new URLSearchParams();
  if (cacheBuster) q.set('t', String(cacheBuster));
  if (maxIdade) q.set('maxIdade', String(maxIdade));
  const sufixo = q.toString() ? `?${q}` : '';
  return urlDaApi(`/api/printers/${printerId}/snapshot${sufixo}`);
}
