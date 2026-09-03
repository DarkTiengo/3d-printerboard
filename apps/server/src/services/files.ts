import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { GcodeFile } from '@3dfarm/shared';
import { duracao, semExtensao, filamentoGramas } from '@3dfarm/shared';
import { farm } from './farm.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { getDb } from '../db/index.js';

type Cache = { em: number; arquivos: GcodeFile[] };
const cache = new Map<string, Cache>();
const TTL_MS = 30_000;

/** '0.20mm' + 'PLA' + 3 paredes → 'PLA 0.20 / 3 paredes' (linha mono do card). */
function perfilDe(meta: {
  filament_type?: string;
  layer_height?: number;
  slicer?: string;
}): string {
  const material = (meta.filament_type ?? '').split(';')[0].trim().toUpperCase();
  const altura = Number.isFinite(meta.layer_height) ? meta.layer_height!.toFixed(2) : null;
  const partes = [material || null, altura].filter(Boolean);
  if (partes.length === 0) return meta.slicer ?? '—';
  return partes.join(' ');
}

async function guardarThumb(printerId: string, caminho: string, dados: Buffer): Promise<string> {
  const chave = createHash('sha1').update(`${printerId}:${caminho}`).digest('hex').slice(0, 16);
  const destino = path.join(config.thumbsDir, `${chave}.png`);
  await fs.writeFile(destino, dados);
  return `/api/thumbnails/${chave}.png`;
}

/**
 * Lista os G-code de uma impressora com metadados e miniatura.
 *
 * O Moonraker já extrai a miniatura embutida no G-code; nós só copiamos para o
 * nosso diretório para servir da mesma origem (e não vazar a API key da máquina
 * para o navegador). Cache de 30 s porque a tela de Arquivos refaz a consulta a
 * cada foco de janela e a listagem de metadados é cara no host.
 */
export async function listarArquivos(printerId: string): Promise<GcodeFile[]> {
  const emCache = cache.get(printerId);
  if (emCache && Date.now() - emCache.em < TTL_MS) return emCache.arquivos;

  const http = farm.http(printerId);
  if (!http) return [];

  const cfg = farm.cliente(printerId)?.config;
  const arquivos: GcodeFile[] = [];

  try {
    const lista = await http.listarArquivos('gcodes');
    // sem limite a tela trava numa biblioteca grande; os mais recentes bastam
    const recentes = [...lista].sort((a, b) => b.modified - a.modified).slice(0, 120);

    const contagens = contarImpressoes();

    for (const arq of recentes) {
      let meta: Awaited<ReturnType<typeof http.metadados>> = {};
      try {
        meta = await http.metadados(arq.path);
      } catch {
        // arquivo ainda sendo processado pelo Moonraker: entra sem metadados
      }

      let thumbnailUrl: string | null = null;
      const thumb = (meta.thumbnails ?? []).sort((a, b) => b.width - a.width)[0];
      if (thumb) {
        try {
          const dados = await http.thumbnail(thumb.relative_path);
          thumbnailUrl = await guardarThumb(printerId, arq.path, dados);
        } catch {
          /* miniatura é opcional */
        }
      }

      const gramas = meta.filament_weight_total
        ? `${Math.round(meta.filament_weight_total)} g`
        : filamentoGramas(meta.filament_total);

      arquivos.push({
        path: arq.path,
        nome: semExtensao(arq.path.split('/').pop() ?? arq.path),
        perfil: perfilDe(meta),
        tempo: duracao(meta.estimated_time),
        filamento: gramas,
        impressoes: String(contagens.get(arq.path.split('/').pop() ?? '') ?? 0),
        thumbnailUrl,
        printerId
      });
    }
  } catch (err) {
    logger.warn(`não foi possível listar arquivos de ${printerId}: ${err}`);
    return emCache?.arquivos ?? [];
  }

  cache.set(printerId, { em: Date.now(), arquivos });
  return arquivos;
}

/** Quantas vezes cada arquivo já saiu da nossa fila com sucesso. */
function contarImpressoes(): Map<string, number> {
  const rows = getDb()
    .prepare("SELECT filename, COUNT(*) AS n FROM queue_jobs WHERE status = 'concluido' GROUP BY filename")
    .all() as { filename: string; n: number }[];
  return new Map(rows.map((r) => [r.filename, r.n]));
}

/**
 * Biblioteca da fazenda inteira, uma entrada por arquivo *por impressora*.
 *
 * Antes o mesmo nome em máquinas diferentes era juntado num card só. Isso
 * escondia justamente o que importa na hora de enfileirar: em qual máquina o
 * arquivo já está, e portanto quem vai imprimi-lo. A tela agrupa por
 * impressora, então a duplicata aqui é a informação, não ruído.
 */
export async function listarBiblioteca(): Promise<GcodeFile[]> {
  const ids = farm.printers().map((p) => p.id);
  const listas = await Promise.all(ids.map((id) => listarArquivos(id).catch(() => [] as GcodeFile[])));

  // ordem da fazenda primeiro, nome depois: é assim que a tela desenha as seções
  const posicao = new Map(ids.map((id, i) => [id, i]));
  return listas
    .flat()
    .sort(
      (a, b) =>
        (posicao.get(a.printerId) ?? 99) - (posicao.get(b.printerId) ?? 99) ||
        a.nome.localeCompare(b.nome, 'pt-BR')
    );
}

export function invalidarCache(printerId?: string): void {
  if (printerId) cache.delete(printerId);
  else cache.clear();
}
