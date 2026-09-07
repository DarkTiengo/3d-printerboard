import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Alert, Printer, PrinterConfig } from '@3dfarm/shared';
import { CODIGOS_DE_ALERTA, CODIGOS_PADRAO } from '@3dfarm/shared';

/**
 * Desligar não é sumir.
 *
 * O que motivou o arquivo: desligar uma impressora — inclusive pelo botão do
 * próprio painel — disparava "Impressora fora do ar" com severidade alta e
 * mandava para o Telegram. Quem desligou a máquina não precisa ser avisado de
 * que ela desligou; quem perdeu uma máquina sem querer precisa. O que separa os
 * dois é `desligamento`, e é isso que se testa aqui.
 */

/** Uma tabela `alerts` de mentira: só o que `alerts.ts` de fato consulta. */
const banco = vi.hoisted(() => ({ linhas: [] as any[], seq: 0 }));

vi.mock('../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (...args: any[]) => {
        if (sql.includes('WHERE dedupe_key')) {
          return banco.linhas.find((l) => l.dedupe_key === args[0] && !l.resolved_at);
        }
        if (sql.includes('WHERE id = ?')) return banco.linhas.find((l) => l.id === args[0]);
        return undefined;
      },
      all: () => [],
      run: (...args: any[]) => {
        if (sql.includes('INSERT INTO alerts')) {
          const [printer_id, printer_name, severity, codigo, title, detail, frame_label, dedupe_key] = args;
          banco.seq += 1;
          banco.linhas.push({
            id: banco.seq,
            printer_id,
            printer_name,
            severity,
            codigo,
            title,
            detail,
            frame_label,
            dedupe_key,
            frame_path: null,
            created_at: '2026-09-06 12:00:00',
            resolved_at: null,
            resolved_by: null
          });
          return { lastInsertRowid: banco.seq };
        }
        if (sql.includes('SET resolved_at')) {
          const linha = banco.linhas.find((l) => l.id === args[1] && !l.resolved_at);
          if (linha) {
            linha.resolved_at = '2026-09-06 12:05:00';
            linha.resolved_by = args[0];
          }
        }
        return {};
      }
    })
  })
}));

const farmFalso = vi.hoisted(() => {
  const ouvintes: Record<string, ((...a: any[]) => void)[]> = {};
  return {
    on: (evento: string, fn: (...a: any[]) => void) => void (ouvintes[evento] ??= []).push(fn),
    emitir: (evento: string, ...args: any[]) => (ouvintes[evento] ?? []).forEach((fn) => fn(...args)),
    /* o alerta de Klipper relê o estado no fim da espera; é isto que ele lê */
    agora: null as any,
    printer: () => farmFalso.agora
  };
});
vi.mock('../src/services/farm.js', () => ({ farm: farmFalso }));

vi.mock('../src/services/cameras.js', () => ({
  cameras: { on: () => {}, capturar: async () => null }
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const alerts = await import('../src/services/alerts.js');
const { MoonrakerClient } = await import('../src/moonraker/client.js');
const { normalizar } = await import('../src/moonraker/normalize.js');

function impressora(patch: Partial<Printer> = {}): Printer {
  return {
    id: 'P05',
    nome: 'Voron 0.2',
    job: 'suporte.gcode',
    concluiuComSucesso: false,
    pct: 42,
    restanteSegundos: 1_800,
    camada: '84/210',
    status: 'ociosa',
    online: true,
    desligamento: null,
    klippy: 'ready',
    mensagemKlippy: null,
    temTaCamera: false,
    cameraRotacao: 0,
    pecaAtual: null,
    temPecas: false,
    minExtrusao: null,
    temperaturas: [],
    posicao: null,
    macros: [],
    ...patch
  };
}

const noAr = impressora();
const desligada = impressora({ online: false, desligamento: 'desligada' });
const sumida = impressora({ online: false, desligamento: null });

let vistos: Alert[];

beforeEach(() => {
  banco.linhas.length = 0;
  banco.seq = 0;
  vistos = [];
  farmFalso.agora = null;
  alerts._limparEsperas();
  alerts._limparInscritos();
  alerts.aoCriarAlerta((a) => vistos.push(a));
  alerts.ligarGeradorDeAlertas();
});

// nenhum relógio falso atravessa de um caso para o outro
afterEach(() => vi.useRealTimers());

const codigos = () => vistos.map((a) => a.codigo);

describe('desligamento a pedido', () => {
  it('não vira "fora do ar" — vira aviso de desligada', () => {
    farmFalso.emitir('printer', desligada, noAr);

    expect(codigos()).not.toContain('impressora_offline');
    const aviso = vistos.find((a) => a.codigo === 'impressora_desligada');
    expect(aviso).toBeDefined();
    expect(aviso!.sev).toBe('baixa');
    expect(aviso!.detalhe).toContain('desligou');
  });

  it('fica fora do que notifica por padrão: quem desligou já sabe', () => {
    expect(CODIGOS_DE_ALERTA.map((c) => c.codigo)).toContain('impressora_desligada');
    expect(CODIGOS_PADRAO).not.toContain('impressora_desligada');
  });

  it('vale também com uma impressão em curso: quem mandou desligar, mandou', () => {
    farmFalso.emitir('printer', impressora({ online: false, desligamento: 'desligada' }),
      impressora({ status: 'imprimindo' }));
    expect(codigos()).toEqual(['impressora_desligada']);
  });

  it('seguir desligada não gera um aviso a cada update', () => {
    farmFalso.emitir('printer', desligada, noAr);
    farmFalso.emitir('printer', impressora({ online: false, desligamento: 'desligada', pct: 0 }), desligada);
    expect(vistos.filter((a) => a.codigo === 'impressora_desligada')).toHaveLength(1);
  });

  it('ligar de novo fecha o aviso sozinho', () => {
    farmFalso.emitir('printer', desligada, noAr);
    vistos = [];

    farmFalso.emitir('printer', noAr, desligada);
    const resolvido = vistos.find((a) => a.codigo === 'impressora_desligada');
    expect(resolvido?.resolvidoEm).toBeTruthy();
    expect(resolvido?.resolvidoPor).toBe('sistema');
  });
});

describe('sumiço sem explicação', () => {
  it('continua alertando, e crítico quando havia impressão', () => {
    farmFalso.emitir('printer', impressora({ online: false }), impressora({ status: 'imprimindo' }));

    const alerta = vistos.find((a) => a.codigo === 'impressora_offline');
    expect(alerta).toBeDefined();
    expect(alerta!.sev).toBe('critica');
    expect(codigos()).not.toContain('impressora_desligada');
  });

  it('ociosa continua sendo alta, não crítica', () => {
    farmFalso.emitir('printer', sumida, noAr);
    expect(vistos.find((a) => a.codigo === 'impressora_offline')!.sev).toBe('alta');
  });
});

describe('reinício', () => {
  const reiniciando = impressora({ online: false, desligamento: 'reiniciando' });

  it('não alerta e não deixa rastro: volta em um minuto', () => {
    farmFalso.emitir('printer', reiniciando, noAr);
    expect(vistos).toHaveLength(0);
  });

  it('passado o prazo sem voltar, a ausência fica sem explicação e alerta', () => {
    farmFalso.emitir('printer', reiniciando, noAr);
    // é o que o cliente faz quando a janela do reinício expira: solta a marca
    farmFalso.emitir('printer', sumida, reiniciando);

    expect(codigos()).toContain('impressora_offline');
  });
});

describe('a marca no cliente', () => {
  const cfg: PrinterConfig = {
    id: 'P05',
    nome: 'Voron 0.2',
    moonrakerUrl: 'http://p05.local:7125',
    apiKey: null,
    cameraUrl: null,
    cameraRotacao: 0,
    backupEnabled: true,
    ordem: 0
  };

  /* O socket não existe nos testes, e é o `conectado` que o prazo do
     desligamento lê para decidir se o comando pegou. */
  class ClienteDeTeste extends MoonrakerClient {
    fingirConectado(): void {
      (this as unknown as { estado: { conectado: boolean } }).estado.conectado = true;
    }
  }

  it('marcar e limpar: o comando recusado não deixa a máquina "desligada"', () => {
    const cliente = new MoonrakerClient(cfg);
    cliente.marcarDesligamento('desligada');
    expect(cliente.getEstado().desligamento).toBe('desligada');

    cliente.limparDesligamento();
    expect(cliente.getEstado().desligamento).toBeNull();
  });

  it('o reinício tem prazo: expirado, a ausência volta a ser sumiço', () => {
    vi.useFakeTimers();
    const cliente = new MoonrakerClient(cfg);
    cliente.marcarDesligamento('reiniciando');

    vi.advanceTimersByTime(60_000);
    expect(cliente.getEstado().desligamento).toBe('reiniciando');

    vi.advanceTimersByTime(5 * 60_000);
    expect(cliente.getEstado().desligamento).toBeNull();
  });

  it('a marca vale já com a máquina de pé: é nessa janela que o Klipper morre', () => {
    const bruto = {
      conectado: true,
      klippy: 'ready' as const,
      macros: [],
      limites: {},
      minExtrusao: null,
      desligamento: 'desligada' as const,
      ultimoErro: null,
      mensagemKlippy: null,
      objetos: {}
    };
    expect(normalizar(cfg, bruto).desligamento).toBe('desligada');
  });

  it('desligamento que não pegou se desmente: a máquina continua respondendo', () => {
    vi.useFakeTimers();
    const cliente = new ClienteDeTeste(cfg);
    cliente.marcarDesligamento('desligada');
    cliente.fingirConectado();

    vi.advanceTimersByTime(3 * 60_000);
    expect(cliente.getEstado().desligamento).toBeNull();
  });

  it('mas desligada de verdade continua marcada — não expira', () => {
    vi.useFakeTimers();
    const cliente = new MoonrakerClient(cfg);
    cliente.marcarDesligamento('desligada');

    vi.advanceTimersByTime(30 * 60_000);
    expect(cliente.getEstado().desligamento).toBe('desligada');
  });
});

describe('Klipper parado durante um desligamento', () => {
  const noArComKlippyMorto = impressora({ klippy: 'disconnected' });

  it('a queda do Klipper com desligamento pedido não vira alerta crítico', () => {
    farmFalso.emitir('printer', impressora({ klippy: 'disconnected', desligamento: 'desligada' }), noAr);
    expect(codigos()).not.toContain('klipper_parado');
  });

  it('sem desligamento pedido, espera antes de gritar — pode ser o host caindo', () => {
    vi.useFakeTimers();
    farmFalso.emitir('printer', noArComKlippyMorto, noAr);
    expect(codigos()).not.toContain('klipper_parado');

    // o host sumiu no meio da espera: era desligamento, e quem fala é o outro
    farmFalso.agora = impressora({ online: false, desligamento: 'desligada', klippy: 'disconnected' });
    vi.advanceTimersByTime(30_000);
    expect(codigos()).not.toContain('klipper_parado');
  });

  it('host de pé com o Klipper fora no fim da espera: era queda mesmo', () => {
    vi.useFakeTimers();
    farmFalso.emitir('printer', noArComKlippyMorto, noAr);
    farmFalso.agora = noArComKlippyMorto;
    vi.advanceTimersByTime(30_000);

    const alerta = vistos.find((a) => a.codigo === 'klipper_parado');
    expect(alerta?.sev).toBe('critica');
  });

  it('falha de firmware não espera nada: o host está de pé e o motivo é claro', () => {
    farmFalso.emitir('printer', impressora({ klippy: 'shutdown', mensagemKlippy: "MCU 'mcu' shutdown" }), noAr);
    expect(codigos()).toContain('klipper_parado');
  });
});
