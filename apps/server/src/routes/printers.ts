import type { FastifyInstance } from 'fastify';
import type { GcodePayload, HeaterPayload, JogPayload, PrinterConfigInput } from '@3dfarm/shared';
import { farm } from '../services/farm.js';
import { nomeDePecaValido, type MoonrakerClient } from '../moonraker/client.js';
import { mesaDePecas } from '../moonraker/normalize.js';
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

  /**
   * Alvo de um aquecedor.
   *
   * `chave` é a do `Temperatura` que o snapshot publicou, e a busca é por
   * igualdade exata: é isso que garante que o nome que entra no G-code veio da
   * config da impressora, e não do corpo do pedido. Um sensor de leitura — o
   * MCU, o Raspberry — recusa, porque não há o que ligar nele.
   */
  app.post<{ Params: { id: string }; Body: HeaterPayload }>(
    '/api/printers/:id/heater',
    {
      preHandler: exigirPermissao('controlarImpressao'),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const printer = farm.printer(req.params.id);
      const cliente = farm.clienteVivo(req.params.id);
      if (!printer || !cliente) return reply.code(503).send({ erro: 'impressora offline' });

      const { chave, alvo } = req.body ?? {};
      const sensor = printer.temperaturas.find((t) => t.chave === chave);
      if (!sensor) return reply.code(404).send({ erro: 'sensor não encontrado' });
      if (sensor.tipo === 'sensor') return reply.code(400).send({ erro: 'este sensor não aquece' });
      if (!Number.isFinite(alvo) || alvo < 0) return reply.code(400).send({ erro: 'alvo inválido' });

      /*
       * O zero é o desligamento e escapa da faixa de propósito — é o que o
       * próprio Klipper faz, e recusá-lo tiraria o botão de desligar de um
       * aquecedor cujo min_temp é 40.
       */
      const fora =
        alvo > 0 &&
        ((sensor.min != null && alvo < sensor.min) || (sensor.max != null && alvo > sensor.max));
      if (fora) {
        return reply.code(400).send({ erro: `alvo fora da faixa (${sensor.min ?? '—'}–${sensor.max ?? '—'} °C)` });
      }

      try {
        await cliente.definirAlvo(sensor.chave, sensor.tipo, Math.round(alvo));
        logger.info({ printer: req.params.id, por: req.sessao!.usuario, sensor: chave, alvo }, 'alvo de temperatura');
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ erro: err instanceof Error ? err.message : 'falha ao definir o alvo' });
      }
    }
  );

  /** Zera todos os alvos de uma vez. A saída rápida quando algo vai mal. */
  app.post<{ Params: { id: string } }>(
    '/api/printers/:id/heaters/off',
    {
      preHandler: exigirPermissao('controlarImpressao'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const cliente = farm.clienteVivo(req.params.id);
      if (!cliente) return reply.code(503).send({ erro: 'impressora offline' });
      try {
        await cliente.desligarAquecedores();
        logger.info({ printer: req.params.id, por: req.sessao!.usuario }, 'aquecedores desligados');
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ erro: err instanceof Error ? err.message : 'falha ao desligar' });
      }
    }
  );

  /**
   * O mapa da mesa: as peças rotuladas nesta impressão, com contorno, quem já
   * saiu e qual está em curso.
   *
   * Sob demanda, e não no snapshot do SSE: os contornos pesam mais que todo o
   * resto do `Printer` somado e não mudam durante a impressão. Sai do estado
   * que a conexão já mantém, então não custa uma volta ao Moonraker.
   */
  app.get<{ Params: { id: string } }>(
    '/api/printers/:id/objects',
    { preHandler: exigirLogin },
    async (req, reply) => {
      const cliente = farm.clienteVivo(req.params.id);
      if (!cliente) return reply.code(503).send({ erro: 'impressora offline' });
      return mesaDePecas(cliente.getEstado());
    }
  );

  /**
   * Tira uma peça da impressão — as outras da mesa continuam.
   *
   * Sem `nome`, é a peça em curso, pelo `EXCLUDE_OBJECT CURRENT=1`: quem diz
   * qual é ela é a impressora, e nada do pedido chega ao G-code. Com `nome`, é
   * uma escolhida no mapa; aí o nome pedido é casado com a lista que o Klipper
   * reportou e o que segue para o G-code é a string *reportada*, nunca a que
   * veio no corpo. Um nome que não está na mesa é 404, e não um comando torto.
   */
  app.post<{ Params: { id: string }; Body: { nome?: string } }>(
    '/api/printers/:id/exclude-object',
    {
      preHandler: exigirPermissao('controlarImpressao'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    },
    async (req, reply) => {
      const printer = farm.printer(req.params.id);
      const cliente = farm.clienteVivo(req.params.id);
      if (!printer || !cliente) return reply.code(503).send({ erro: 'impressora offline' });

      const pedido = req.body?.nome;
      const alvo = pedido ? mesaDePecas(cliente.getEstado()).pecas.find((p) => p.nome === pedido) : null;

      if (pedido) {
        if (!alvo) return reply.code(404).send({ erro: 'esta peça não está na mesa' });
        if (alvo.excluida) return reply.code(409).send({ erro: 'peça já excluída' });
        if (!nomeDePecaValido(alvo.nome)) {
          // nome que não cabe numa linha de G-code: melhor recusar do que
          // mandar o comando cortado no meio e excluir outra coisa
          return reply.code(422).send({ erro: 'nome de peça que o G-code não aceita' });
        }
      } else if (!printer.pecaAtual) {
        return reply.code(409).send({ erro: 'nenhuma peça em impressão' });
      }

      try {
        // a peça em curso sai pelo CURRENT=1 mesmo quando foi escolhida no
        // mapa: é o caminho que não depende de escapar o nome
        if (!alvo || alvo.atual) await cliente.excluirPecaAtual();
        else await cliente.excluirPeca(alvo.nome);

        logger.info(
          { printer: req.params.id, por: req.sessao!.usuario, peca: alvo?.nome ?? printer.pecaAtual },
          'peça excluída da impressão'
        );
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ erro: err instanceof Error ? err.message : 'falha ao excluir a peça' });
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

  /*
   * Energia do host — `machine.reboot` e `machine.shutdown`.
   *
   * Falam com o Moonraker, não com o Klipper, então respondem mesmo com o
   * firmware caído: é o caminho para levantar uma máquina que travou. O que
   * precisa estar de pé é o próprio Moonraker, e é isso que `clienteVivo`
   * garante.
   */
  const energia = {
    reboot: {
      permissao: 'reiniciarMaquina',
      executar: (c: MoonrakerClient) => c.reiniciarMaquina()
    },
    shutdown: {
      permissao: 'desligarMaquina',
      executar: (c: MoonrakerClient) => c.desligarMaquina()
    }
  } as const;

  for (const [rota, { permissao, executar }] of Object.entries(energia)) {
    app.post<{ Params: { id: string } }>(
      `/api/printers/:id/machine/${rota}`,
      {
        preHandler: exigirPermissao(permissao),
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
      },
      async (req, reply) => {
        const cliente = farm.clienteVivo(req.params.id);
        if (!cliente) return reply.code(503).send({ erro: 'impressora offline' });
        try {
          await executar(cliente);
        } catch (err) {
          // recusa do Moonraker: quase sempre container ou sudo faltando
          const motivo = err instanceof Error ? err.message : 'falha no comando';
          logger.warn({ printer: req.params.id, motivo }, `${rota} recusado`);
          return reply.code(502).send({ erro: motivo });
        }
        logger.warn({ printer: req.params.id, por: req.sessao!.usuario }, `máquina: ${rota}`);
        return { ok: true };
      }
    );
  }

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
