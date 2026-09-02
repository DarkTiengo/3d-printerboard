import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { rotasAuth } from './routes/auth.js';
import { rotasPrinters } from './routes/printers.js';
import { rotasCameras } from './routes/cameras.js';
import { rotasFiles } from './routes/files.js';
import { rotasAlerts } from './routes/alerts.js';
import { rotasBackups } from './routes/backups.js';
import { rotasStream } from './routes/stream.js';
import { rotasResumo } from './routes/resumo.js';
import { rotasMockCamera } from './routes/mock-camera.js';

export async function criarApp() {
  const app = Fastify({
    loggerInstance: logger,
    // proxy de câmera e SSE ficam abertos por horas
    connectionTimeout: 0,
    requestTimeout: 0,
    trustProxy: true,
    bodyLimit: 32 * 1024 * 1024
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute'
  });

  await app.register(rotasAuth);
  await app.register(rotasPrinters);
  await app.register(rotasCameras);
  await app.register(rotasFiles);
  await app.register(rotasAlerts);
  await app.register(rotasBackups);
  await app.register(rotasStream);
  await app.register(rotasResumo);

  if (config.mockPrinters) await app.register(rotasMockCamera);

  app.get('/api/saude', async () => ({ ok: true, versao: '0.1.0' }));

  // ── front ────────────────────────────────────────────────────────────────
  if (fs.existsSync(config.webDir)) {
    // index: a raiz serve o index.html; as rotas fundas caem no notFoundHandler
    await app.register(fastifyStatic, { root: config.webDir, index: ['index.html'] });

    // SPA: qualquer rota que não seja /api cai no index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ erro: 'rota não encontrada' });
      }
      return reply.type('text/html').send(fs.createReadStream(path.join(config.webDir, 'index.html')));
    });
  } else {
    logger.warn(`build do front não encontrado em ${config.webDir} — só a API está no ar`);
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ erro: 'rota não encontrada' }));
  }

  return app;
}
