import type { FastifyInstance } from 'fastify';
import { farm } from '../services/farm.js';
import { contarFila } from '../services/queue.js';
import { listarAlertas } from '../services/alerts.js';
import { exigirLogin } from '../lib/guard.js';

/** A linha mono da barra superior: "5 ativas · fila 7 · 1 atenção". */
export async function rotasResumo(app: FastifyInstance): Promise<void> {
  app.get('/api/resumo', { preHandler: exigirLogin }, async () => {
    const printers = farm.printers();
    const ativas = printers.filter((p) => p.status === 'imprimindo' || p.status === 'atenção').length;
    const atencao = printers.filter((p) => p.status === 'atenção').length;
    const fila = contarFila();
    return {
      ativas,
      fila,
      atencao,
      alertasAbertos: listarAlertas().length,
      texto: `${ativas} ativas · fila ${fila} · ${atencao} atenção`
    };
  });
}
