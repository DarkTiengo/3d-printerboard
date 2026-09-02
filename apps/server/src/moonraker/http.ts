import type { PrinterConfig } from '@3dfarm/shared';

/**
 * Lado HTTP do Moonraker. O WebSocket cobre estado e comandos; arquivos,
 * banco de dados e info de máquina são bem mais simples por REST.
 */

export type ArquivoMoonraker = {
  path: string;
  modified: number;
  size: number;
  permissions?: string;
};

export type MetadadosGcode = {
  filename?: string;
  estimated_time?: number;
  filament_total?: number;
  filament_weight_total?: number;
  layer_height?: number;
  first_layer_height?: number;
  object_height?: number;
  slicer?: string;
  slicer_version?: string;
  filament_type?: string;
  filament_name?: string;
  print_start_time?: number;
  thumbnails?: { width: number; height: number; size: number; relative_path: string }[];
};

export class MoonrakerHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'MoonrakerHttpError';
  }
}

export class MoonrakerHttp {
  constructor(private cfg: PrinterConfig) {}

  private url(caminho: string, query?: Record<string, string | number | undefined>): string {
    const base = this.cfg.moonrakerUrl.replace(/\/+$/, '');
    const url = new URL(base + caminho);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private headers(): Record<string, string> {
    return this.cfg.apiKey ? { 'X-Api-Key': this.cfg.apiKey } : {};
  }

  private async pedir(caminho: string, query?: Record<string, string | number | undefined>, timeoutMs = 20_000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.url(caminho, query), { headers: this.headers(), signal: ctrl.signal });
      if (!res.ok) {
        throw new MoonrakerHttpError(`${caminho} respondeu ${res.status}`, res.status);
      }
      return res;
    } catch (err) {
      if (err instanceof MoonrakerHttpError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new MoonrakerHttpError(`${caminho}: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async json<T>(caminho: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const res = await this.pedir(caminho, query);
    const body = (await res.json()) as { result: T };
    return body.result;
  }

  /** Ping barato para o botão "testar conexão" da tela de gestão. */
  async testar(): Promise<{ ok: true; versao: string; hostname: string }> {
    const info = await this.json<{ klipper_path?: string; hostname?: string; software_version?: string }>(
      '/printer/info'
    );
    return { ok: true, versao: info.software_version ?? '?', hostname: info.hostname ?? '?' };
  }

  listarArquivos(root: 'gcodes' | 'config' | 'logs'): Promise<ArquivoMoonraker[]> {
    return this.json<ArquivoMoonraker[]>('/server/files/list', { root });
  }

  metadados(filename: string): Promise<MetadadosGcode> {
    return this.json<MetadadosGcode>('/server/files/metadata', { filename });
  }

  /** Baixa um arquivo como Buffer. `root` + `path` viram /server/files/<root>/<path>. */
  async baixar(root: string, caminho: string, timeoutMs = 120_000): Promise<Buffer> {
    const partes = caminho.split('/').map(encodeURIComponent).join('/');
    const res = await this.pedir(`/server/files/${root}/${partes}`, undefined, timeoutMs);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Miniatura embutida no G-code, extraída pelo próprio Moonraker. */
  async thumbnail(relativePath: string): Promise<Buffer> {
    return this.baixar('gcodes', relativePath, 30_000);
  }

  listarNamespaces(): Promise<{ namespaces: string[] }> {
    return this.json<{ namespaces: string[] }>('/server/database/list');
  }

  itemBanco(namespace: string): Promise<{ namespace: string; value: unknown }> {
    return this.json<{ namespace: string; value: unknown }>('/server/database/item', { namespace });
  }

  infoSistema(): Promise<{ system_info: Record<string, unknown> }> {
    return this.json<{ system_info: Record<string, unknown> }>('/machine/system_info');
  }

  statusAtualizacao(): Promise<Record<string, any>> {
    return this.json<Record<string, any>>('/machine/update/status', { refresh: 'false' });
  }

  /** Envia um arquivo para o root `gcodes`. Usado pela fila e pela restauração. */
  async enviar(root: string, caminho: string, conteudo: Buffer, iniciarImpressao = false): Promise<void> {
    const form = new FormData();
    const dir = caminho.includes('/') ? caminho.slice(0, caminho.lastIndexOf('/')) : '';
    const nome = caminho.slice(caminho.lastIndexOf('/') + 1);
    form.set('root', root);
    if (dir) form.set('path', dir);
    if (iniciarImpressao) form.set('print', 'true');
    form.set('file', new Blob([new Uint8Array(conteudo)]), nome);

    const res = await fetch(this.url('/server/files/upload'), {
      method: 'POST',
      headers: this.headers(),
      body: form
    });
    if (!res.ok) {
      throw new MoonrakerHttpError(`upload de ${caminho} respondeu ${res.status}`, res.status);
    }
  }

  /** URL absoluta do stream da câmera, se configurada. */
  cameraUrl(): string | null {
    return this.cfg.cameraUrl || null;
  }
}
