import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '@3dfarm/shared';

/**
 * As regras de quem vira mensagem e de quantas mensagens saem.
 *
 * O caso que motivou o arquivo: todo alerta com câmera é emitido duas vezes —
 * uma na hora e outra quando o JPEG chega ao disco — e a versão ingênua disso
 * mandava duas mensagens no celular por alerta.
 */

const banco = vi.hoisted(() => ({ linhas: new Map<string, string>() }));
vi.mock('../src/db/index.js', () => ({
  getDb: () => ({}),
  getSetting: (k: string) => banco.linhas.get(k) ?? null,
  setSetting: (k: string, v: string) => void banco.linhas.set(k, v)
}));

const alertas = vi.hoisted(() => ({ frames: new Map<number, string>() }));

/*
 * O disco é falso de propósito. Com timers falsos, um `fs.readFile` de verdade
 * não resolve dentro de `advanceTimersByTimeAsync` — ele precisa de voltas reais
 * do event loop — e o envio vazava para o teste seguinte.
 */
const disco = vi.hoisted(() => ({ arquivos: new Map<string, Buffer>() }));
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: async (caminho: string) => {
      const bytes = disco.arquivos.get(caminho);
      if (!bytes) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return bytes;
    }
  }
}));
vi.mock('../src/services/alerts.js', () => ({
  aoCriarAlerta: () => {},
  acharAlerta: (id: number) => ({ alert: null, framePath: alertas.frames.get(id) ?? null })
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const notif = await import('../src/services/notificacoes.js');

type Enviado = { tipo: 'texto' | 'foto'; conteudo: string };
let enviados: Enviado[] = [];
let falharCom: Error | null = null;

function pref(patch: Partial<ReturnType<typeof notif.prefs>> = {}) {
  notif.salvarToken('TOKEN');
  notif.salvarPrefs({
    ligado: true,
    chatId: '123',
    codigos: ['klipper_parado', 'impressao_concluida'],
    avisarResolucao: true,
    ...patch
  });
}

function alerta(patch: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    codigo: 'klipper_parado',
    titulo: 'Klipper parado',
    impressora: 'Voron 0.2',
    printerId: 'P05',
    criadoEm: '2026-09-04T11:00:00Z',
    sev: 'critica',
    detalhe: "MCU 'mcu' shutdown: Lost communication",
    frame: 'CAM P05',
    frameUrl: null,
    resolvidoEm: null,
    resolvidoPor: null,
    ...patch
  };
}

/** Passa a janela de debounce e deixa a fila drenar. */
async function passarJanela() {
  await vi.advanceTimersByTimeAsync(2_500);
  await vi.advanceTimersByTimeAsync(2_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  banco.linhas.clear();
  alertas.frames.clear();
  disco.arquivos.clear();
  enviados = [];
  falharCom = null;
  notif._limparEstado();
  notif._usarFabrica(() => ({
    async enviarTexto(texto) {
      if (falharCom) throw falharCom;
      enviados.push({ tipo: 'texto', conteudo: texto });
    },
    async enviarFoto(_jpeg, legenda) {
      if (falharCom) throw falharCom;
      enviados.push({ tipo: 'foto', conteudo: legenda });
    }
  }));
});

afterEach(() => {
  notif._limparEstado();
  vi.useRealTimers();
});

describe('o que vira mensagem', () => {
  it('manda uma só mensagem quando o alerta é emitido duas vezes', async () => {
    pref();
    // é o que acontece de verdade: a segunda emissão traz o frame
    notif.aoAlerta(alerta());
    notif.aoAlerta(alerta({ frameUrl: '/api/alertas/1/frame' }));
    await passarJanela();

    expect(enviados).toHaveLength(1);
    expect(enviados[0].conteudo).toContain('Klipper parado');
    expect(enviados[0].conteudo).toContain('Voron 0.2');
  });

  it('barra o código que está desligado nas preferências', async () => {
    pref({ codigos: ['impressao_concluida'] });
    notif.aoAlerta(alerta());
    await passarJanela();
    expect(enviados).toHaveLength(0);
  });

  it('não manda nada com as notificações desligadas, nem sem token ou chat', async () => {
    pref({ ligado: false });
    notif.aoAlerta(alerta());
    await passarJanela();
    expect(enviados).toHaveLength(0);

    pref({ chatId: '' });
    notif.aoAlerta(alerta({ id: 2 }));
    await passarJanela();
    expect(enviados).toHaveLength(0);
  });

  it('espaça as mensagens quando a fazenda inteira cai junto', async () => {
    pref();
    for (let i = 1; i <= 3; i++) notif.aoAlerta(alerta({ id: i }));
    await vi.advanceTimersByTimeAsync(2_500);
    // a janela venceu para os três, mas eles saem um a um
    expect(enviados).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(enviados).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(enviados).toHaveLength(3);
  });
});

describe('a foto do momento', () => {
  it('manda como foto quando o frame chegou dentro da janela', async () => {
    pref();
    alertas.frames.set(1, '/frames/alerta-1.jpg');
    disco.arquivos.set('/frames/alerta-1.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    notif.aoAlerta(alerta());
    await passarJanela();

    expect(enviados).toHaveLength(1);
    expect(enviados[0].tipo).toBe('foto');
  });

  it('cai para texto quando o arquivo do frame sumiu — o alerta vale mais que a imagem', async () => {
    pref();
    alertas.frames.set(1, '/nao/existe/frame.jpg');
    notif.aoAlerta(alerta());
    await passarJanela();

    expect(enviados).toHaveLength(1);
    expect(enviados[0].tipo).toBe('texto');
  });
});

describe('aviso de recuperação', () => {
  it('avisa que voltou apenas para quem foi avisado que caiu', async () => {
    pref();
    notif.aoAlerta(alerta());
    await passarJanela();
    enviados = [];

    notif.aoAlerta(alerta({ resolvidoEm: '2026-09-04T11:05:00Z', resolvidoPor: 'sistema' }));
    await passarJanela();

    expect(enviados).toHaveLength(1);
    expect(enviados[0].conteudo).toContain('Resolvido');
    expect(enviados[0].tipo).toBe('texto'); // resolução não leva foto
  });

  it('fica calado quando o alerta resolvido nunca foi notificado', async () => {
    pref({ codigos: [] });
    notif.aoAlerta(alerta());
    await passarJanela();

    notif.aoAlerta(alerta({ resolvidoEm: '2026-09-04T11:05:00Z' }));
    await passarJanela();
    expect(enviados).toHaveLength(0);
  });

  it('respeita avisarResolucao desligado', async () => {
    pref({ avisarResolucao: false });
    notif.aoAlerta(alerta());
    await passarJanela();
    enviados = [];

    notif.aoAlerta(alerta({ resolvidoEm: '2026-09-04T11:05:00Z' }));
    await passarJanela();
    expect(enviados).toHaveLength(0);
  });
});

describe('falhas', () => {
  it('guarda no banco o motivo da recusa, para a tela mostrar depois', async () => {
    const { TelegramError } = await import('../src/notificadores/telegram.js');
    pref();
    falharCom = new TelegramError('Bad Request: chat not found', 400);
    notif.aoAlerta(alerta());
    await passarJanela();

    expect(enviados).toHaveLength(0);
    expect(notif.estado().ultimoErro).toContain('chat not found');
    expect(notif.estado().ultimoErroEm).not.toBeNull();
  });

  it('não repete um 4xx — token ou chat errado não melhora tentando de novo', async () => {
    const { TelegramError } = await import('../src/notificadores/telegram.js');
    pref();
    let tentativas = 0;
    notif._usarFabrica(() => ({
      async enviarTexto() {
        tentativas += 1;
        throw new TelegramError('Unauthorized', 401);
      },
      async enviarFoto() {
        tentativas += 1;
        throw new TelegramError('Unauthorized', 401);
      }
    }));

    notif.aoAlerta(alerta());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tentativas).toBe(1);
  });

  it('repete uma falha de rede e desiste depois de três', async () => {
    const { TelegramError } = await import('../src/notificadores/telegram.js');
    pref();
    let tentativas = 0;
    notif._usarFabrica(() => ({
      async enviarTexto() {
        tentativas += 1;
        throw new TelegramError('sem resposta dentro do tempo limite');
      },
      async enviarFoto() {
        tentativas += 1;
        throw new TelegramError('sem resposta dentro do tempo limite');
      }
    }));

    notif.aoAlerta(alerta());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tentativas).toBe(3);
  });
});

describe('compor', () => {
  it('escapa o que veio do Klipper e marca a severidade', () => {
    const texto = notif.compor(alerta({ detalhe: 'falhou em <b>x</b> & y' }), false);
    expect(texto).toContain('🔴');
    expect(texto).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(texto).not.toContain('<b>x</b>');
  });

  it('limita o detalhe para a mensagem inteira caber na legenda de uma foto', () => {
    const texto = notif.compor(alerta({ detalhe: 'z'.repeat(5_000) }), false);
    expect(texto.length).toBeLessThan(1024);
  });
});
