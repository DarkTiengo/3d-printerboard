import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { capturarUmQuadro, descobrirCamera } from '../src/lib/camera-probe.js';

/**
 * Estes testes sobem um HTTP de verdade porque o bug que motivou o arquivo só
 * aparece no transporte: abortar o fetch de dentro do `for await` fazia o
 * cancelamento do iterador estourar um AbortError que atropelava o quadro já
 * capturado — a captura "falhava" mesmo tendo funcionado.
 */

const SOI = Buffer.from([0xff, 0xd8, 0xff]);
const EOI = Buffer.from([0xff, 0xd9]);
const QUADRO = Buffer.concat([SOI, Buffer.from('conteudo-do-quadro'), EOI]);

let servidor: http.Server;
let base = '';

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    const caminho = (req.url ?? '').split('?')[0];

    if (caminho === '/server/webcams/list') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result: { webcams: [{ name: 'mesa', stream_url: '/webcam/' }] } }));
      return;
    }
    if (caminho === '/webcam/') {
      // stream infinito: precisa ser interrompido assim que o quadro fechar
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=b' });
      const timer = setInterval(() => {
        if (res.writableEnded) return clearInterval(timer);
        res.write(`--b\r\nContent-Type: image/jpeg\r\n\r\n`);
        res.write(QUADRO);
        res.write('\r\n');
      }, 20);
      req.on('close', () => clearInterval(timer));
      return;
    }
    if (caminho === '/snapshot.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(QUADRO);
      return;
    }
    if (caminho === '/html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>não é uma câmera</h1>');
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
});

describe('capturarUmQuadro', () => {
  it('tira um quadro de um stream MJPEG que nunca termina', async () => {
    const { jpeg } = await capturarUmQuadro(`${base}/webcam/`, 5_000);
    expect(jpeg).toEqual(QUADRO);
  });

  it('aceita também um snapshot JPEG simples', async () => {
    const { jpeg, tipo } = await capturarUmQuadro(`${base}/snapshot.jpg`, 5_000);
    expect(jpeg).toEqual(QUADRO);
    expect(tipo).toContain('image/jpeg');
  });

  it('recusa uma URL que não é imagem nem vídeo', async () => {
    await expect(capturarUmQuadro(`${base}/html`, 5_000)).rejects.toThrow(/não parece/);
  });

  it('reporta o status quando o servidor recusa', async () => {
    await expect(capturarUmQuadro(`${base}/nada`, 5_000)).rejects.toThrow(/404/);
  });

  it('não trava quando o host não existe', async () => {
    await expect(capturarUmQuadro('http://127.0.0.1:1/webcam', 2_000)).rejects.toThrow();
  });
});

describe('descobrirCamera', () => {
  it('usa a webcam declarada pelo Moonraker', async () => {
    const achada = await descobrirCamera(base, {});
    expect(achada).not.toBeNull();
    expect(achada!.camera.nome).toBe('mesa');
    expect(achada!.camera.origem).toBe('moonraker');
    expect(achada!.jpeg).toEqual(QUADRO);
  });

  it('devolve null quando nada responde com imagem', async () => {
    // porta fechada: nem a lista do Moonraker nem as convenções respondem
    await expect(descobrirCamera('http://127.0.0.1:1', {})).resolves.toBeNull();
  }, 30_000);
});
