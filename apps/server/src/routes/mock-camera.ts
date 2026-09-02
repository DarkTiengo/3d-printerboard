import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNDARY, envelopar } from '../lib/mjpeg.js';
import { logger } from '../lib/logger.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const DIR_QUADROS = path.join(aqui, '..', 'mock-frames');

/**
 * Câmera falsa em MJPEG, registrada só com MOCK_PRINTERS.
 *
 * As impressoras simuladas apontam a `cameraUrl` para cá, então a parede de
 * câmeras, o proxy, o descarte de quadros e o snapshot de alerta rodam pelo
 * caminho real — só a fonte da imagem é sintética.
 */
export async function rotasMockCamera(app: FastifyInstance): Promise<void> {
  let quadros: Buffer[] = [];
  try {
    quadros = fs
      .readdirSync(DIR_QUADROS)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .map((f) => fs.readFileSync(path.join(DIR_QUADROS, f)));
  } catch (err) {
    logger.warn(`simulador sem quadros de câmera em ${DIR_QUADROS}: ${err}`);
  }

  if (quadros.length === 0) return;

  app.get<{ Querystring: { fase?: string } }>('/api/mock-camera', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Cache-Control': 'no-store',
      Connection: 'close'
    });

    // fase diferente por impressora, para a parede não pulsar em uníssono
    let i = Number(req.query.fase) || 0;
    const timer = setInterval(() => {
      if (reply.raw.writableEnded) {
        clearInterval(timer);
        return;
      }
      reply.raw.write(envelopar(quadros[i % quadros.length]));
      i++;
    }, 100);

    req.raw.on('close', () => clearInterval(timer));
    return reply;
  });
}
