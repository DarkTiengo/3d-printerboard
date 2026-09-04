import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const { criarTelegram, escaparHtml, TelegramError } = await import('../src/notificadores/telegram.js');

/**
 * Sobe um Telegram falso de verdade, em HTTP, em vez de trocar o `fetch`.
 * É a convenção do repositório (test/camera-capture.test.ts) e aqui ela paga:
 * multipart, corpo de erro e `retry_after` só existem no transporte.
 */

type Recebido = { metodo: string; tipo: string | null; corpo: Buffer };

let servidor: http.Server;
let base: string;
let recebidos: Recebido[] = [];
/** A próxima resposta do falso Telegram: null = sucesso. */
let proximaFalha: { status: number; corpo: unknown } | null = null;

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on('data', (d) => pedacos.push(d));
    req.on('end', () => {
      recebidos.push({
        metodo: (req.url ?? '').split('/').pop() ?? '',
        tipo: req.headers['content-type'] ?? null,
        corpo: Buffer.concat(pedacos)
      });
      if (proximaFalha) {
        const { status, corpo } = proximaFalha;
        proximaFalha = null;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(corpo));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: {} }));
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
});

beforeEach(() => {
  recebidos = [];
  proximaFalha = null;
});

describe('escaparHtml', () => {
  it('escapa só o que o parse_mode HTML do Telegram exige', () => {
    expect(escaparHtml('a & b <c> d')).toBe('a &amp; b &lt;c&gt; d');
    // aspas e acentos passam intactos: escapá-los sujaria a mensagem à toa
    expect(escaparHtml("MCU 'mcu' shutdown — ção")).toBe("MCU 'mcu' shutdown — ção");
  });
});

describe('envio', () => {
  it('manda texto como JSON, com o chat e o parse_mode', async () => {
    await criarTelegram('TOKEN', '-100123', base).enviarTexto('<b>oi</b>');

    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].metodo).toBe('sendMessage');
    expect(recebidos[0].tipo).toContain('application/json');
    const corpo = JSON.parse(recebidos[0].corpo.toString());
    expect(corpo).toMatchObject({ chat_id: '-100123', text: '<b>oi</b>', parse_mode: 'HTML' });
  });

  it('manda foto como multipart, com a legenda junto', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);
    await criarTelegram('TOKEN', '-100123', base).enviarFoto(jpeg, 'legenda');

    expect(recebidos[0].metodo).toBe('sendPhoto');
    expect(recebidos[0].tipo).toContain('multipart/form-data');
    const texto = recebidos[0].corpo.toString('latin1');
    expect(texto).toContain('name="caption"');
    expect(texto).toContain('legenda');
    expect(texto).toContain('filename="alerta.jpg"');
    // os bytes da imagem chegaram inteiros
    expect(recebidos[0].corpo.includes(jpeg)).toBe(true);
  });

  it('corta a legenda no limite de 1024 do Telegram', async () => {
    await criarTelegram('TOKEN', '1', base).enviarFoto(Buffer.from([1]), 'x'.repeat(2000));
    // o limite do Telegram é em caracteres, não em bytes
    const texto = recebidos[0].corpo.toString('utf8');
    const legenda = /name="caption"\r\n\r\n([\s\S]*?)\r\n--/.exec(texto)?.[1] ?? '';
    expect(legenda.length).toBeLessThanOrEqual(1024);
    expect(legenda.endsWith('…')).toBe(true);
  });

  it('nunca corta no meio de uma tag — o Telegram recusaria a mensagem inteira', async () => {
    // o corte cairia dentro do href, e o "can't parse entities" trocaria um
    // aviso truncado por aviso nenhum
    const recheio = 'y'.repeat(1010);
    await criarTelegram('TOKEN', '1', base).enviarFoto(Buffer.from([1]), `${recheio}<a href="http://x/">painel</a>`);
    const texto = recebidos[0].corpo.toString('utf8');
    const legenda = /name="caption"\r\n\r\n([\s\S]*?)\r\n--/.exec(texto)?.[1] ?? '';
    expect(legenda.length).toBeLessThanOrEqual(1024);
    expect(legenda).not.toMatch(/<[^>]*$/);
  });
});

describe('erros', () => {
  it('usa a descrição do Telegram, não o código HTTP nu', async () => {
    proximaFalha = { status: 400, corpo: { ok: false, description: 'Bad Request: chat not found' } };
    await expect(criarTelegram('TOKEN', 'errado', base).enviarTexto('oi')).rejects.toThrow(/chat not found/);
  });

  it('não pede retry num 4xx que não é 429 — token ou chat errado não melhora', async () => {
    proximaFalha = { status: 401, corpo: { ok: false, description: 'Unauthorized' } };
    const err = await criarTelegram('RUIM', '1', base).enviarTexto('oi').catch((e) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect((err as InstanceType<typeof TelegramError>).status).toBe(401);
    expect((err as InstanceType<typeof TelegramError>).vaiMelhorarComRetry).toBe(false);
  });

  it('lê o retry_after de um 429 e pede retry', async () => {
    proximaFalha = { status: 429, corpo: { ok: false, description: 'Too Many Requests', parameters: { retry_after: 7 } } };
    const err = (await criarTelegram('TOKEN', '1', base)
      .enviarTexto('oi')
      .catch((e) => e)) as InstanceType<typeof TelegramError>;
    expect(err.esperarSegundos).toBe(7);
    expect(err.vaiMelhorarComRetry).toBe(true);
  });

  it('trata 5xx como transitório', async () => {
    proximaFalha = { status: 502, corpo: { ok: false } };
    const err = (await criarTelegram('TOKEN', '1', base)
      .enviarTexto('oi')
      .catch((e) => e)) as InstanceType<typeof TelegramError>;
    expect(err.vaiMelhorarComRetry).toBe(true);
  });

  it('não trava quando o host não responde', async () => {
    const err = (await criarTelegram('TOKEN', '1', 'http://127.0.0.1:1')
      .enviarTexto('oi')
      .catch((e) => e)) as InstanceType<typeof TelegramError>;
    expect(err).toBeInstanceOf(TelegramError);
    // sem status é falha de rede: vale tentar de novo
    expect(err.status).toBeUndefined();
    expect(err.vaiMelhorarComRetry).toBe(true);
  });
});
