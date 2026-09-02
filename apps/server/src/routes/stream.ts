import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Printer, StreamEvent } from '@3dfarm/shared';
import { farm } from '../services/farm.js';
import { exigirLogin } from '../lib/guard.js';
import { logger } from '../lib/logger.js';

/**
 * Hub SSE. Um EventSource por aba; o navegador reconecta sozinho.
 * Só precisamos de push servidor→cliente — comandos vão por POST normal.
 */
class Hub {
  private clientes = new Set<FastifyReply>();

  inscrever(reply: FastifyReply): void {
    this.clientes.add(reply);
    reply.raw.on('close', () => this.clientes.delete(reply));
  }

  publicar(evento: StreamEvent): void {
    const payload = `data: ${JSON.stringify(evento)}\n\n`;
    for (const reply of this.clientes) {
      try {
        reply.raw.write(payload);
      } catch {
        this.clientes.delete(reply);
      }
    }
  }

  get quantidade(): number {
    return this.clientes.size;
  }
}

export const hub = new Hub();

export async function rotasStream(app: FastifyInstance): Promise<void> {
  app.get('/api/stream', { preHandler: exigirLogin }, async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // desliga o buffer de proxies reversos, senão o SSE chega em blocos
      'X-Accel-Buffering': 'no'
    });

    hub.inscrever(reply);
    logger.debug(`SSE: cliente conectado (${hub.quantidade} ativos)`);

    // estado inicial completo, para a tela pintar sem esperar a próxima mudança
    const inicial: StreamEvent = { tipo: 'printers', printers: farm.printers() };
    reply.raw.write(`data: ${JSON.stringify(inicial)}\n\n`);

    // comentário-ping: mantém a conexão viva através de proxies com timeout curto
    const ping = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        clearInterval(ping);
      }
    }, 25_000);

    req.raw.on('close', () => clearInterval(ping));

    // a resposta fica aberta; não retornamos nada
    return reply;
  });
}

/** Liga o Farm no hub. Chamado uma vez no boot. */
export function ligarFarmAoHub(): void {
  farm.on('printer', (printer: Printer) => {
    hub.publicar({ tipo: 'printer', printer });
  });
  farm.on('removida', () => {
    hub.publicar({ tipo: 'printers', printers: farm.printers() });
  });
}
