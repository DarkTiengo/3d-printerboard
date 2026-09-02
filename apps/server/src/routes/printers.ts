import type { FastifyInstance } from 'fastify';
import type { GcodePayload, JogPayload, PrinterConfigInput } from '@3dfarm/shared';
import { farm } from '../services/farm.js';
import { MoonrakerHttp } from '../moonraker/http.js';
import {
  acharPrinter,
  atualizarPrinter,
  criarPrinter,
  listarPrinters,
  removerPrinter
} from '../services/printers.repo.js';
import { exigirLogin, exigirPermissao } from '../lib/guard.js';
import { logger } from '../lib/logger.js';
import { capturarUmQuadro, descobrirCamera } from '../lib/camera-probe.js';

/** JPEG → data URL, para a prévia viajar junto da resposta do teste. */
function paraDataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

function validarEntrada(body: Partial<PrinterConfigInput>): string | null {
  if (!body?.nome?.trim()) return 'Informe o nome da impressora.';
  if (!body?.moonrakerUrl?.trim()) return 'Informe a URL do Moonraker.';
  try {
    const u = new URL(body.moonrakerUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'A URL do Moonraker deve ser http ou https.';
  } catch {
    return 'URL do Moonraker inválida.';
  }
  if (body.cameraUrl) {
    try {
      new URL(body.cameraUrl);
    } catch {
      return 'URL da câmera inválida.';
    }
  }
  return null;
}

export async function rotasPrinters(app: FastifyInstance): Promise<void> {
  /** Snapshot normalizado — o SSE cuida das atualizações. */
  app.get('/api/printers', { preHandler: exigirLogin }, async () => farm.printers());

  app.get<{ Params: { id: string } }>('/api/printers/:id', { preHandler: exigirLogin }, async (req, reply) => {
    const p = farm.printer(req.params.id);
    if (!p) return reply.code(404).send({ erro: 'impressora não encontrada' });
    return p;
  });

  // ── controles ────────────────────────────────────────────────────────────

  const comandos = {
    pause: (id: string) => farm.clienteVivo(id)?.pausar(),
    resume: (id: string) => farm.clienteVivo(id)?.continuar(),
    cancel: (id: string) => farm.clienteVivo(id)?.cancelar()
  } as const;

  for (const [rota, executar] of Object.entries(comandos)) {
    app.post<{ Params: { id: string } }>(
      `/api/printers/:id/${rota}`,
      {
        preHandler: exigirPermissao('controlarImpressao'),
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
      },
      async (req, reply) => {
        const promessa = executar(req.params.id);
        if (!promessa) return reply.code(503).send({ erro: 'impressora offline' });
        try {
          await promessa;
          logger.info({ printer: req.params.id, por: req.sessao!.usuario }, `comando ${rota}`);
          return { ok: true };
        } catch (err) {
          return reply.code(502).send({ erro: err instanceof Error ? err.message : 'falha no comando' });
        }
      }
    );
  }

  app.post<{ Params: { id: string }; Body: JogPayload }>(
    '/api/printers/:id/jog',
    { preHandler: exigirPermissao('controlarImpressao') },
    async (req, reply) => {
      const cliente = farm.clienteVivo(req.params.id);
      if (!cliente) return reply.code(503).send({ erro: 'impressora offline' });

      const { eixo, passo } = req.body ?? {};
      if (!['X', 'Y', 'Z'].includes(eixo) || !Number.isFinite(passo)) {
        return reply.code(400).send({ erro: 'eixo ou passo inválido' });
      }
      // G91 relativo → move → G90 absoluto, senão o próximo comando vai para o lugar errado
      const script = `SAVE_GCODE_STATE NAME=jog\nG91\nG1 ${eixo}${passo} F${eixo === 'Z' ? 600 : 3000}\nRESTORE_GCODE_STATE NAME=jog`;
      try {
        await cliente.gcode(script);
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ erro: err instanceof Error ? err.message : 'falha no jog' });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/printers/:id/home',
    { preHandler: exigirPermissao('controlarImpressao') },
    async (req, reply) => {
      const cliente = farm.clienteVivo(req.params.id);
      if (!cliente) return reply.code(503).send({ erro: 'impressora offline' });
      try {
        await cliente.gcode('G28');
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ erro: err instanceof Error ? err.message : 'falha no home' });
      }
    }
  );

  app.post<{ Params: { id: string }; Body: GcodePayload }>(
    '/api/printers/:id/gcode',
    {
      preHandler: exigirPermissao('controlarImpressao'),
      // G-code arbitrário é a rota mais poderosa do app: freio mais curto
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const cliente = farm.clienteVivo(req.params.id);
      if (!cliente) return reply.code(503).send({ erro: 'impressora offline' });
      const script = req.body?.script?.trim();
      if (!script) return reply.code(400).send({ erro: 'script vazio' });
      try {
        await cliente.gcode(script);
        logger.info({ printer: req.params.id, por: req.sessao!.usuario, script }, 'gcode manual');
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ erro: err instanceof Error ? err.message : 'falha no gcode' });
      }
    }
  );

  /**
   * Parada de emergência da fazenda inteira. Dispara em todas em paralelo e
   * relata o que falhou — numa emergência, uma impressora offline não pode
   * impedir as outras de parar.
   */
  app.post(
    '/api/emergency-stop',
    {
      preHandler: exigirPermissao('pararEmergencia'),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    },
    async (req) => {
      const clientes = farm.clientes_();
      const resultados = await Promise.allSettled(clientes.map((c) => c.paradaEmergencia()));
      const falhas = clientes
        .map((c, i) => ({ id: c.id, r: resultados[i] }))
        .filter((x) => x.r.status === 'rejected')
        .map((x) => x.id);
      logger.warn({ por: req.sessao!.usuario, falhas }, 'PARADA DE EMERGÊNCIA');
      return { ok: falhas.length === 0, total: clientes.length, falhas };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/printers/:id/emergency-stop',
    { preHandler: exigirPermissao('pararEmergencia') },
    async (req, reply) => {
      const cliente = farm.clienteVivo(req.params.id);
      if (!cliente) return reply.code(503).send({ erro: 'impressora offline' });
      await cliente.paradaEmergencia();
      logger.warn({ printer: req.params.id, por: req.sessao!.usuario }, 'parada de emergência');
      return { ok: true };
    }
  );

  // ── gestão (admin) ───────────────────────────────────────────────────────

  app.get('/api/config/printers', { preHandler: exigirPermissao('gerirImpressoras') }, async () =>
    // a API key nunca sai do servidor; o front só precisa saber se existe
    listarPrinters().map((p) => ({ ...p, apiKey: p.apiKey ? '••••••••' : null }))
  );

  app.post<{ Body: PrinterConfigInput }>(
    '/api/config/printers',
    { preHandler: exigirPermissao('gerirImpressoras') },
    async (req, reply) => {
      const erro = validarEntrada(req.body);
      if (erro) return reply.code(400).send({ erro });
      const criada = criarPrinter(req.body);
      farm.sincronizar();
      return { ...criada, apiKey: criada.apiKey ? '••••••••' : null };
    }
  );

  app.put<{ Params: { id: string }; Body: PrinterConfigInput }>(
    '/api/config/printers/:id',
    { preHandler: exigirPermissao('gerirImpressoras') },
    async (req, reply) => {
      const erro = validarEntrada(req.body);
      if (erro) return reply.code(400).send({ erro });
      const atual = acharPrinter(req.params.id);
      if (!atual) return reply.code(404).send({ erro: 'impressora não encontrada' });
      // campo mascarado voltando do front significa "não mexer na chave"
      const apiKey = req.body.apiKey === '••••••••' ? atual.apiKey : req.body.apiKey;
      const salva = atualizarPrinter(req.params.id, { ...req.body, apiKey });
      farm.sincronizar();
      return { ...salva!, apiKey: salva!.apiKey ? '••••••••' : null };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/config/printers/:id',
    { preHandler: exigirPermissao('gerirImpressoras') },
    async (req, reply) => {
      if (!removerPrinter(req.params.id)) return reply.code(404).send({ erro: 'impressora não encontrada' });
      farm.sincronizar();
      return { ok: true };
    }
  );

  app.post<{ Body: PrinterConfigInput }>(
    '/api/config/printers/testar',
    { preHandler: exigirPermissao('gerirImpressoras') },
    async (req, reply) => {
      const erro = validarEntrada(req.body);
      if (erro) return reply.code(400).send({ erro });
      // chave mascarada → testa com a que já está salva
      let apiKey = req.body.apiKey ?? null;
      if (apiKey === '••••••••' && req.body.id) apiKey = acharPrinter(req.body.id)?.apiKey ?? null;

      const http = new MoonrakerHttp({
        id: req.body.id ?? 'teste',
        nome: req.body.nome,
        moonrakerUrl: req.body.moonrakerUrl,
        apiKey,
        cameraUrl: req.body.cameraUrl ?? null,
        backupEnabled: false,
        ordem: 0
      });
      try {
        const info = await http.testar();
        const cabecalhos: Record<string, string> = apiKey ? { 'X-Api-Key': apiKey } : {};

        /*
         * A câmera é opcional e nunca reprova a impressora. Se a pessoa
         * informou uma URL, testamos aquela; se não, perguntamos ao Moonraker
         * o que ele tem configurado e só então tentamos os caminhos
         * convencionais. O quadro capturado volta junto, para o formulário
         * mostrar a prévia em vez de só afirmar que deu certo.
         */
        let camera: {
          ok: boolean;
          erro?: string;
          url?: string;
          nome?: string;
          descoberta?: boolean;
          preview?: string;
        } | null = null;

        if (req.body.cameraUrl) {
          try {
            const { jpeg } = await capturarUmQuadro(req.body.cameraUrl);
            camera = { ok: true, url: req.body.cameraUrl, preview: paraDataUrl(jpeg) };
          } catch (err) {
            camera = { ok: false, erro: err instanceof Error ? err.message : 'sem resposta' };
          }
        } else {
          const achada = await descobrirCamera(req.body.moonrakerUrl, cabecalhos);
          if (achada) {
            camera = {
              ok: true,
              url: achada.camera.url,
              nome: achada.camera.nome,
              descoberta: true,
              preview: paraDataUrl(achada.jpeg)
            };
            logger.info(
              { url: achada.camera.url, origem: achada.camera.origem },
              'câmera descoberta durante o teste de conexão'
            );
          }
        }

        return { ...info, ok: true as const, camera };
      } catch (err) {
        return reply.code(200).send({ ok: false, erro: err instanceof Error ? err.message : 'falha na conexão' });
      }
    }
  );
}
