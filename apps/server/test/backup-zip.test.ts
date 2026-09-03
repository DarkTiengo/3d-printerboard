import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/**
 * O que este teste protege: o .zip que o usuário baixa é montado a partir dos
 * blobs, e o G-code só entra quando ele pede. Se o empacotamento perder um
 * arquivo, o backup existe mas não serve — é o tipo de falha que só aparece no
 * dia da restauração.
 */

/** o teste lê o zip com o `unzip` do sistema; sem ele, não há o que verificar */
function temUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), '3dfarm-zip-'));
process.env.DATA_DIR = raiz;

vi.mock('../src/db/index.js', () => ({ getDb: () => ({}), getSetting: () => null, setSetting: () => {} }));
vi.mock('../src/services/farm.js', () => ({ farm: { http: () => null, printers: () => [] } }));
vi.mock('../src/services/printers.repo.js', () => ({ listarPrinters: () => [], acharPrinter: () => null }));
vi.mock('../src/services/alerts.js', () => ({ criarAlerta: async () => null }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const { montarZip } = await import('../src/services/backup.js');
const { config } = await import('../src/config.js');

function porBlob(conteudo: string): string {
  const hash = createHash('sha256').update(Buffer.from(conteudo)).digest('hex');
  const destino = path.join(config.blobsDir, hash.slice(0, 2), hash);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo);
  return hash;
}

const manifesto = {
  versao: 2 as const,
  printerId: 'P01',
  nome: 'Voron 2.4',
  moonrakerUrl: 'http://voron.local',
  criadoEm: new Date().toISOString(),
  firmware: 'Klipper v0.12.0',
  secoes: ['config', 'gcode'] as const,
  arquivosConfig: ['printer.cfg'],
  namespacesBanco: [],
  entradas: {} as Record<string, string>,
  gcode: {} as Record<string, string>,
  parcial: false,
  avisos: []
};

beforeAll(() => {
  manifesto.entradas['config/printer.cfg'] = porBlob('[printer]\nkinematics: corexy\n');
  manifesto.entradas['sistema.json'] = porBlob('{"klipper":"v0.12.0"}');
  manifesto.gcode['pecas/clipe.gcode'] = porBlob('G28\nG1 X10\n');
});

afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }));

async function escrever(comGcode: boolean): Promise<string[]> {
  const destino = path.join(raiz, `saida-${comGcode}.zip`);
  const zip = montarZip(manifesto as never, { comGcode });
  const saida = fs.createWriteStream(destino);
  const pronto = new Promise<void>((ok, falha) => {
    saida.on('close', () => ok());
    saida.on('error', falha);
    zip.on('error', falha);
  });
  zip.pipe(saida);
  await zip.finalize();
  await pronto;

  return execFileSync('unzip', ['-Z1', destino], { encoding: 'utf8' }).trim().split('\n').sort();
}

describe.runIf(temUnzip())('montarZip', () => {
  it('leva o manifesto e a config, e deixa o G-code de fora por padrão', async () => {
    expect(await escrever(false)).toEqual(['config/printer.cfg', 'manifest.json', 'sistema.json']);
  });

  it('inclui o G-code quando o usuário pede o backup inteiro', async () => {
    expect(await escrever(true)).toEqual([
      'config/printer.cfg',
      'gcode/pecas/clipe.gcode',
      'manifest.json',
      'sistema.json'
    ]);
  });

  it('o conteúdo sai íntegro do zip, não só o nome do arquivo', async () => {
    const destino = path.join(raiz, 'saida-true.zip');
    const conteudo = execFileSync('unzip', ['-p', destino, 'config/printer.cfg'], { encoding: 'utf8' });
    expect(conteudo).toBe('[printer]\nkinematics: corexy\n');
  });

  it('um blob que sumiu do disco não derruba o pacote', async () => {
    manifesto.entradas['config/perdido.cfg'] = 'f'.repeat(64);
    const nomes = await escrever(false);
    expect(nomes).not.toContain('config/perdido.cfg');
    expect(nomes).toContain('config/printer.cfg');
    delete manifesto.entradas['config/perdido.cfg'];
  });
});
