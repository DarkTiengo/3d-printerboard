import type { FastifyInstance } from 'fastify';
import { cameras } from '../services/cameras.js';
import { cabecalhoMultipart, envelopar } from '../lib/mjpeg.js';
import { config } from '../config.js';
import { exigirLogin } from '../lib/guard.js';
import { acharPrinter } from '../services/printers.repo.js';

export async function rotasCameras(app: FastifyInstance): Promise<void> {
  /**
   * Proxy MJPEG. `?fps=` define a taxa entregue a este cliente:
   * a parede pede 2, a impressora selecionada e a tela de Câmeras pedem taxa cheia.
   */
  app.get<{ Params: { id: string }; Querystring: { fps?: string } }>(
    '/api/printers/:id/camera',
    { preHandler: exigirLogin },
    async (req, reply) => {
      const cfg = acharPrinter(req.params.id);
      if (!cfg) return reply.code(404).send({ erro: 'impressora não encontrada' });
      if (!cfg.cameraUrl) return reply.code(404).send({ erro: 'impressora sem câmera configurada' });

      const fps = Number(req.query.fps) || config.cameraFpsPadrao;

      reply.raw.writeHead(200, {
        'Content-Type': cabecalhoMultipart(),
        'Cache-Control': 'no-store, no-cache, private',
        Pragma: 'no-cache',
        Connection: 'close',
        'X-Accel-Buffering': 'no'
      });

      const cancelar = cameras.assinar(req.params.id, fps, (jpeg) => {
        // se o socket encheu, pula o quadro em vez de acumular memória
        if (reply.raw.writableLength > 2 * 1024 * 1024) return;
        reply.raw.write(envelopar(jpeg));
      });

      if (!cancelar) {
        reply.raw.end();
        return reply;
      }

      req.raw.on('close', cancelar);
      req.raw.on('error', cancelar);
      return reply;
    }
  );

  /**
   * Um JPEG só. É o modo padrão da parede e das miniaturas: o navegador só
   * abre 6 conexões por origem no HTTP/1.1, e um MJPEG por tile consumiria
   * todas elas — deixando a própria API sem vez. Requisições curtas não têm
   * esse problema. `maxIdade` diz o quão velho o quadro pode ser.
   */
  app.get<{ Params: { id: string }; Querystring: { maxIdade?: string } }>(
    '/api/printers/:id/snapshot',
    { preHandler: exigirLogin },
    async (req, reply) => {
      const cfg = acharPrinter(req.params.id);
      if (!cfg?.cameraUrl) return reply.code(404).send({ erro: 'impressora sem câmera configurada' });

      const maxIdade = Math.max(200, Math.min(Number(req.query.maxIdade) || 800, 30_000));
      /*
       * Timeout curto de propósito, bem abaixo do padrão de 8 s de `capturar`.
       * Isto aqui é um tile de parede: uma câmera que não fecha um quadro em
       * 4 s não vai parecer ao vivo de jeito nenhum, e enquanto a requisição
       * fica pendurada ela ocupa uma das 6 conexões que o navegador dá por
       * origem — as mesmas que a API usa para pausar e cancelar impressão.
       * O tile tenta de novo no ciclo seguinte.
       */
      const jpeg = await cameras.capturar(req.params.id, maxIdade, 4_000);
      if (!jpeg) return reply.code(503).send({ erro: 'câmera não respondeu' });

      return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'no-store').send(jpeg);
    }
  );
}
