import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EstadoModelo } from '@gridfarm/shared';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { agenteDaFazenda } from '../lib/http-agent.js';

/**
 * O arquivo do modelo: onde mora, como chega e como se sabe que é o certo.
 *
 * Não vai versionado no repositório nem embutido na imagem. São 6–12 MB que
 * só interessam a quem liga a detecção, e o volume de dados é onde eles
 * sobrevivem a um `docker compose up --build`. Quem instala sem internet põe o
 * arquivo na pasta na mão — o download é a conveniência, não o requisito.
 */

const NOME = 'falhas-v1.onnx';

/** Teto de sanidade: o modelo documentado tem ~12 MB. */
const MAX_BYTES = 64 * 1024 * 1024;

export function caminhoDoModelo(): string {
  return path.join(config.modelosDir, NOME);
}

let baixando: Promise<EstadoModelo> | null = null;
let ultimoErro: string | null = null;

async function bytesDoArquivo(): Promise<number> {
  try {
    const st = await fs.stat(caminhoDoModelo());
    return st.isFile() ? st.size : 0;
  } catch {
    return 0;
  }
}

export async function estadoDoModelo(): Promise<EstadoModelo> {
  const bytes = await bytesDoArquivo();
  const podeBaixar = config.deteccaoModeloUrl !== '';
  if (baixando) return { estado: 'baixando', bytes, erro: null, podeBaixar };
  if (bytes > 0) return { estado: 'pronto', bytes, erro: null, podeBaixar };
  if (ultimoErro) return { estado: 'erro', bytes: 0, erro: ultimoErro, podeBaixar };
  return { estado: 'ausente', bytes: 0, erro: null, podeBaixar };
}

/** O modelo está no disco e pronto para uso? Barato: só um stat. */
export async function modeloPronto(): Promise<boolean> {
  return (await bytesDoArquivo()) > 0;
}

/**
 * Baixa o modelo, confere o SHA-256 e só então o põe no lugar definitivo.
 *
 * A gravação é atômica — arquivo temporário e `rename` — porque um download
 * interrompido pela metade que ficasse com o nome final seria carregado no
 * próximo boot como se estivesse inteiro, e o erro apareceria longe daqui.
 *
 * Chamadas concorrentes compartilham o mesmo download: dois cliques no botão
 * não baixam duas vezes.
 */
export function baixarModelo(): Promise<EstadoModelo> {
  if (baixando) return baixando;

  baixando = (async () => {
    const destino = caminhoDoModelo();
    const temporario = `${destino}.parcial`;
    try {
      if (!config.deteccaoModeloUrl) {
        throw new Error('DETECCAO_MODELO_URL não está configurada — não há de onde baixar o modelo');
      }
      ultimoErro = null;
      logger.info(`baixando o modelo de detecção de ${config.deteccaoModeloUrl}`);

      const res = await fetch(config.deteccaoModeloUrl, { dispatcher: agenteDaFazenda } as RequestInit);
      if (!res.ok) throw new Error(`o servidor do modelo respondeu ${res.status}`);

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0) throw new Error('o download veio vazio');
      if (buf.byteLength > MAX_BYTES) {
        throw new Error(`o arquivo tem ${(buf.byteLength / 1048576).toFixed(0)} MB, acima do teto de 64 MB`);
      }

      const sha = createHash('sha256').update(buf).digest('hex');
      if (config.deteccaoModeloSha256 && sha !== config.deteccaoModeloSha256) {
        throw new Error(`SHA-256 não confere: esperava ${config.deteccaoModeloSha256}, veio ${sha}`);
      }
      if (!config.deteccaoModeloSha256) {
        logger.warn(`DETECCAO_MODELO_SHA256 vazio: o modelo foi aceito sem conferência (sha256=${sha})`);
      }

      await fs.mkdir(config.modelosDir, { recursive: true });
      await fs.writeFile(temporario, buf);
      await fs.rename(temporario, destino);
      logger.info(`modelo de detecção pronto em ${destino} (${(buf.byteLength / 1048576).toFixed(1)} MB)`);
    } catch (err) {
      ultimoErro = err instanceof Error ? err.message : String(err);
      logger.error(`falha ao baixar o modelo de detecção: ${ultimoErro}`);
      await fs.rm(temporario, { force: true }).catch(() => undefined);
    } finally {
      baixando = null;
    }
    return estadoDoModelo();
  })();

  return baixando;
}

/** Só para os testes: zera o erro lembrado da última tentativa. */
export function _limparEstadoDoModelo(): void {
  ultimoErro = null;
  baixando = null;
}
