import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { acharAlerta, listarAlertas, resolverAlerta } from '../services/alerts.js';
import { exigirLogin, exigirPermissao } from '../lib/guard.js';

export async function rotasAlerts(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { resolvidos?: string } }>('/api/alertas', { preHandler: exigirLogin }, async (req) =>
    listarAlertas(req.query.resolvidos === '1')
  );

  app.get<{ Params: { id: string } }>('/api/alertas/:id/frame', { preHandler: exigirLogin }, async (req, reply) => {
    const achado = acharAlerta(Number(req.params.id));
    if (!achado?.framePath || !fs.existsSync(achado.framePath)) {
      return reply.code(404).send({ erro: 'sem frame guardado' });
    }
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'private, max-age=86400')
      .send(fs.createReadStream(achado.framePath));
  });

  app.post<{ Params: { id: string } }>(
    '/api/alertas/:id/resolver',
    { preHandler: exigirPermissao('resolverAlerta') },
    async (req, reply) => {
      const alert = resolverAlerta(Number(req.params.id), req.sessao!.usuario);
      if (!alert) return reply.code(404).send({ erro: 'alerta não encontrado' });
      return alert;
    }
  );
}
