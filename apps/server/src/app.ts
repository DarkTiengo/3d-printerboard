import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
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

  /**
   * Cabeçalhos de segurança.
   *
   * A CSP é apertada: nada de script externo, nada de inline. O que sobra
   * frouxo é `style-src 'unsafe-inline'`, porque o design é implementado com
   * atributos `style` — trocar isso exigiria reescrever as telas em classes.
   * HSTS fica desligado: a fazenda é servida por http:// na rede local, e
   * mandar o navegador exigir HTTPS deixaria o app inacessível.
   */
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        // as câmeras e miniaturas passam todas pelo nosso proxy, então 'self' basta
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // O helmet liga isto por padrão. Numa fazenda servida por http:// ele
        // reescreve todo asset para https://, nada responde, e a página fica
        // preta — mesma armadilha do cookie Secure. Quem colocar um proxy
        // TLS na frente pode religar via COOKIE_SECURE/proxy.
        upgradeInsecureRequests: null
      }
    },
    // o app roda em http:// na LAN; HSTS o tornaria inalcançável
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
    // os feeds MJPEG são consumidos por <img> da mesma origem
    crossOriginResourcePolicy: { policy: 'same-origin' }
  });

  /**
   * Rate limit por rota, não global: a parede de câmeras faz polling de
   * snapshot em oito tiles, o que passa de mil requisições por minuto vindas
   * de uma aba legítima. Um teto global derrubaria o painel. As rotas que
   * merecem freio são as sensíveis, e cada uma pede o seu.
   */
  await app.register(rateLimit, { global: false });

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
