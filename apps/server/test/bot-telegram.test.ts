import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Printer } from '@3dfarm/shared';

/**
 * As respostas do bot e a regra de quem ele atende.
 *
 * O laço de long polling não é exercitado aqui — o que importa e o que erra é a
 * composição das respostas e a autorização por chat.
 */

const fazenda = vi.hoisted(() => ({ printers: [] as Printer[] }));
vi.mock('../src/services/farm.js', () => ({ farm: { printers: () => fazenda.printers } }));

const camera = vi.hoisted(() => ({ jpeg: null as Buffer | null }));
vi.mock('../src/services/cameras.js', () => ({
  cameras: { capturar: async () => camera.jpeg }
}));

vi.mock('../src/services/notificacoes.js', () => ({
  prefs: () => ({ chatId: '-100999', responderComandos: true }),
  token: () => 'TOKEN'
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const bot = await import('../src/services/bot-telegram.js');

function impressora(patch: Partial<Printer> = {}): Printer {
  return {
    id: 'P05',
    nome: 'Voron 0.2',
    job: 'ventoinha_duto.gcode',
    pct: 48,
    restanteSegundos: 4470,
    camada: '96/204',
    status: 'imprimindo',
    concluiuComSucesso: false,
    online: true,
    klippy: 'ready',
    mensagemKlippy: null,
    temTaCamera: true,
    temperaturas: [
      { chave: 'extruder', rotulo: null, tipo: 'aquecedor', atual: 210.42, alvo: 210, min: 0, max: 300 },
      { chave: 'heater_bed', rotulo: null, tipo: 'aquecedor', atual: 59.81, alvo: 60, min: 0, max: 120 },
      // a câmara aquece e entra na linha; o MCU só mede e fica de fora
      { chave: 'heater_generic Chamber', rotulo: 'Chamber', tipo: 'aquecedor', atual: 44.2, alvo: 45, min: 0, max: 60 },
      { chave: 'temperature_sensor MCU', rotulo: 'MCU', tipo: 'sensor', atual: 38.2, alvo: null, min: null, max: null }
    ],
    posicao: null,
    macros: [],
    ...patch
  };
}

let enviados: { tipo: 'texto' | 'foto'; conteudo: string }[] = [];
const tg = {
  async enviarTexto(t: string) {
    enviados.push({ tipo: 'texto', conteudo: t });
  },
  async enviarFoto(_j: Buffer, legenda: string) {
    enviados.push({ tipo: 'foto', conteudo: legenda });
  },
  async receberAtualizacoes() {
    return [];
  }
};

beforeEach(() => {
  enviados = [];
  camera.jpeg = null;
  fazenda.printers = [impressora()];
});

describe('/status da fazenda', () => {
  it('dá uma linha por máquina, com o que falta de quem está imprimindo', async () => {
    fazenda.printers = [
      impressora(),
      impressora({ id: 'P04', nome: 'Prusa MK4', status: 'ociosa', job: '—', restanteSegundos: null })
    ];
    await bot.responder(tg, '/status');

    const texto = enviados[0].conteudo;
    expect(texto).toContain('1 imprimindo');
    expect(texto).toContain('Voron 0.2 · 48% · ventoinha_duto · falta 1h 14m');
    expect(texto).toContain('Prusa MK4 · ociosa');
  });

  it('conta como problema tanto quem está fora do ar quanto quem está com o Klipper parado', async () => {
    fazenda.printers = [
      impressora({ online: false, klippy: 'disconnected' }),
      impressora({ id: 'P07', nome: 'Sovol SV06', klippy: 'shutdown', status: 'atenção' })
    ];
    await bot.responder(tg, '/status');
    expect(enviados[0].conteudo).toContain('2 com problema');
    expect(enviados[0].conteudo).toContain('⚫ Voron 0.2 · fora do ar');
    expect(enviados[0].conteudo).toContain('🔴 Sovol SV06 · Klipper parado');
  });

  it('num grupo, o Telegram entrega /status@meubot', async () => {
    await bot.responder(tg, '/status@printerboard_bot');
    expect(enviados[0].conteudo).toContain('Fazenda');
  });
});

describe('/status de uma impressora', () => {
  it('manda a foto da câmera com o andamento na legenda', async () => {
    camera.jpeg = Buffer.from([0xff, 0xd8]);
    await bot.responder(tg, '/status P05');

    expect(enviados[0].tipo).toBe('foto');
    expect(enviados[0].conteudo).toContain('Voron 0.2');
    expect(enviados[0].conteudo).toContain('48% · camada 96/204 · falta 1h 14m');
    expect(enviados[0].conteudo).toContain('Bico 210,4 °C / 210 °C');
    // a câmara é aquecedor e entra pelo nome do printer.cfg
    expect(enviados[0].conteudo).toContain('Chamber 44,2 °C / 45 °C');
    // o MCU só mede: a linha do /status é uma linha só, e ele fica no painel
    expect(enviados[0].conteudo).not.toContain('MCU');
  });

  it('cai para texto quando não há câmera ou ela não responde', async () => {
    camera.jpeg = null;
    await bot.responder(tg, '/status voron');
    expect(enviados[0].tipo).toBe('texto');
    expect(enviados[0].conteudo).toContain('Voron 0.2');
  });

  it('conta o motivo do Klipper em vez de progresso congelado', async () => {
    fazenda.printers = [
      impressora({ klippy: 'shutdown', status: 'atenção', mensagemKlippy: "MCU 'mcu' shutdown: Lost communication" })
    ];
    await bot.responder(tg, '/status P05');
    const texto = enviados[0].conteudo;
    expect(texto).toContain('Klipper está parado');
    expect(texto).toContain('Lost communication');
    expect(texto).not.toContain('48%');
  });

  it('pede que escolha quando o nome combina com mais de uma', async () => {
    fazenda.printers = [
      impressora({ id: 'P01', nome: 'Ender 3 V2 — A' }),
      impressora({ id: 'P02', nome: 'Ender 3 V2 — B' })
    ];
    await bot.responder(tg, '/status ender');
    expect(enviados[0].conteudo).toContain('mais de uma');
    expect(enviados[0].conteudo).toContain('P01');
    expect(enviados[0].conteudo).toContain('P02');
  });

  it('lista as impressoras quando não acha a que foi pedida', async () => {
    await bot.responder(tg, '/status bambu');
    expect(enviados[0].conteudo).toContain('Não achei');
    expect(enviados[0].conteudo).toContain('P05');
  });
});

describe('ajuda', () => {
  it('responde a /ajuda e a qualquer coisa que não seja comando', async () => {
    await bot.responder(tg, '/ajuda');
    await bot.responder(tg, 'oi, tudo bem?');
    expect(enviados).toHaveLength(2);
    for (const e of enviados) expect(e.conteudo).toContain('/status');
  });
});

describe('acharImpressora', () => {
  it('prefere o código exato ao pedaço de nome', () => {
    const p1 = impressora({ id: 'P01', nome: 'Voron 0.2' });
    const p2 = impressora({ id: 'P02', nome: 'a P01 velha' });
    expect(bot.acharImpressora([p1, p2], 'p01')).toEqual([p1]);
  });

  it('não acha nada com busca vazia', () => {
    expect(bot.acharImpressora([impressora()], '   ')).toEqual([]);
  });
});

describe('escape', () => {
  it('escapa o nome da máquina — ele vem do cadastro e pode ter < ou &', async () => {
    fazenda.printers = [impressora({ nome: 'Ender <A> & B' })];
    await bot.responder(tg, '/status');
    expect(enviados[0].conteudo).toContain('Ender &lt;A&gt; &amp; B');
  });
});
