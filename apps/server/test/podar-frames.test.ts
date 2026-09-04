import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));
vi.mock('../src/services/farm.js', () => ({ farm: { on: () => {}, printer: () => null } }));
vi.mock('../src/services/cameras.js', () => ({ cameras: { on: () => {}, capturar: async () => null } }));

const { abrirBanco, fecharBanco, getDb } = await import('../src/db/index.js');
const { config } = await import('../src/config.js');
const { podarFrames } = await import('../src/services/alerts.js');

/**
 * Os quadros de câmera eram só escritos: cada alerta com câmera deixava um JPEG
 * em disco para sempre. Numa fazenda ativa quem mais os produz é "impressão
 * concluída", que nunca se resolve sozinha — então a poda tem de ser por idade,
 * não por alerta resolvido.
 */

let dir: string | null = null;

function bancoLimpo() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printerboard-frames-'));
  for (const chave of ['dataDir', 'backupsDir', 'framesDir', 'thumbsDir', 'blobsDir'] as const) {
    (config as any)[chave] = path.join(dir, chave);
  }
  (config as any).dbPath = path.join(dir, 'app.db');
  return abrirBanco();
}

/** Cria um alerta com um JPEG em disco, envelhecido em `diasAtras`. */
function comFrame(id: number, diasAtras: number, resolvido = false): string {
  const arquivo = path.join(config.framesDir, `alerta-${id}.jpg`);
  fs.writeFileSync(arquivo, Buffer.from([0xff, 0xd8, 0xff]));
  getDb()
    .prepare(
      `INSERT INTO alerts (id, printer_name, severity, codigo, title, frame_path, created_at, resolved_at)
       VALUES (?, 'Voron 0.2', 'baixa', 'impressao_concluida', 'Impressão concluída', ?,
               datetime('now', ?), ?)`
    )
    .run(id, arquivo, `-${diasAtras} days`, resolvido ? new Date().toISOString() : null);
  return arquivo;
}

afterEach(() => {
  fecharBanco();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('podarFrames', () => {
  it('apaga o quadro velho e mantém o recente', async () => {
    bancoLimpo();
    const velho = comFrame(1, 30);
    const novo = comFrame(2, 2);

    expect(await podarFrames(14)).toBe(1);
    expect(fs.existsSync(velho)).toBe(false);
    expect(fs.existsSync(novo)).toBe(true);
  });

  it('mantém o alerta no histórico, só sem a foto', async () => {
    bancoLimpo();
    comFrame(1, 30);
    await podarFrames(14);

    const linha = getDb().prepare('SELECT title, frame_path FROM alerts WHERE id = 1').get() as {
      title: string;
      frame_path: string | null;
    };
    // a tela passa a mostrar "sem imagem do momento", que é o que de fato houve
    expect(linha.title).toBe('Impressão concluída');
    expect(linha.frame_path).toBeNull();
  });

  it('poda o alerta que nunca foi resolvido — é justamente o caso comum', async () => {
    bancoLimpo();
    // 'impressao_concluida' não tem resolução automática e ninguém resolve na
    // mão; uma poda por alerta resolvido nunca tocaria nele
    comFrame(1, 30, false);
    expect(await podarFrames(14)).toBe(1);
  });

  it('solta a referência mesmo quando o arquivo já sumiu do disco', async () => {
    bancoLimpo();
    const arquivo = comFrame(1, 30);
    fs.rmSync(arquivo);

    expect(await podarFrames(14)).toBe(1);
    const linha = getDb().prepare('SELECT frame_path FROM alerts WHERE id = 1').get() as {
      frame_path: string | null;
    };
    // o que não pode é a tela oferecer link para uma imagem inexistente
    expect(linha.frame_path).toBeNull();
  });

  it('não faz nada com retenção zero ou negativa — é como se desliga a poda', async () => {
    bancoLimpo();
    const velho = comFrame(1, 999);
    expect(await podarFrames(0)).toBe(0);
    expect(await podarFrames(-1)).toBe(0);
    expect(fs.existsSync(velho)).toBe(true);
  });

  it('é idempotente: rodar de novo não acha mais nada', async () => {
    bancoLimpo();
    comFrame(1, 30);
    expect(await podarFrames(14)).toBe(1);
    expect(await podarFrames(14)).toBe(0);
  });
});
