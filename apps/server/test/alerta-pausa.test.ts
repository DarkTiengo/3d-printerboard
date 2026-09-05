import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Alert, Printer } from '@3dfarm/shared';
import { CODIGOS_DE_ALERTA, CODIGOS_PADRAO } from '@3dfarm/shared';

/**
 * Impressão pausada vira alerta.
 *
 * O que motivou o arquivo: uma pausa não gerava nada — nem card, nem mensagem
 * no Telegram. Uma máquina parada com M600 ficava esquentando a noite inteira
 * sem ninguém saber. Aqui a transição é o que se testa, porque é ela que
 * dispara: o estado 'pausada' sozinho se repetiria a cada update do Klipper.
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
            created_at: '2026-09-05 12:00:00',
            resolved_at: null,
            resolved_by: null
          });
          return { lastInsertRowid: banco.seq };
        }
        if (sql.includes('SET resolved_at')) {
          const linha = banco.linhas.find((l) => l.id === args[1] && !l.resolved_at);
          if (linha) {
            linha.resolved_at = '2026-09-05 12:05:00';
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
    printer: () => null
  };
});
vi.mock('../src/services/farm.js', () => ({ farm: farmFalso }));

// sem câmera o alerta sai igual, só sem foto — é o que interessa aqui
vi.mock('../src/services/cameras.js', () => ({
  cameras: { on: () => {}, capturar: async () => null }
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const alerts = await import('../src/services/alerts.js');

function impressora(patch: Partial<Printer> = {}): Printer {
  return {
    id: 'P05',
    nome: 'Voron 0.2',
    job: 'suporte.gcode',
    concluiuComSucesso: false,
    pct: 42,
    restanteSegundos: 1_800,
    camada: '84/210',
    status: 'imprimindo',
    online: true,
    klippy: 'ready',
    mensagemKlippy: null,
    temTaCamera: false,
    pecaAtual: null,
    temPecas: false,
    temperaturas: [],
    posicao: null,
    macros: [],
    ...patch
  };
}

let vistos: Alert[];

beforeEach(() => {
  banco.linhas.length = 0;
  banco.seq = 0;
  vistos = [];
  alerts._limparInscritos();
  alerts.aoCriarAlerta((a) => vistos.push(a));
  alerts.ligarGeradorDeAlertas();
});

describe('impressão pausada', () => {
  const imprimindo = impressora();
  const pausada = impressora({ status: 'pausada' });

  it('a pausa vira alerta, com o que a máquina estava fazendo', () => {
    farmFalso.emitir('printer', pausada, imprimindo);

    const alerta = vistos.find((a) => a.codigo === 'impressao_pausada');
    expect(alerta).toBeDefined();
    expect(alerta!.sev).toBe('media');
    expect(alerta!.impressora).toBe('Voron 0.2');
    expect(alerta!.detalhe).toContain('suporte.gcode');
    expect(alerta!.detalhe).toContain('84/210');
  });

  it('continuar imprimindo fecha o alerta sozinho', () => {
    farmFalso.emitir('printer', pausada, imprimindo);
    vistos = [];

    farmFalso.emitir('printer', imprimindo, pausada);
    const resolvido = vistos.find((a) => a.codigo === 'impressao_pausada');
    expect(resolvido?.resolvidoEm).toBeTruthy();
    expect(resolvido?.resolvidoPor).toBe('sistema');
  });

  it('cancelar também fecha: em ambos alguém já foi até a máquina', () => {
    farmFalso.emitir('printer', pausada, imprimindo);
    vistos = [];

    farmFalso.emitir('printer', impressora({ status: 'cancelada' }), pausada);
    expect(vistos.find((a) => a.codigo === 'impressao_pausada')?.resolvidoEm).toBeTruthy();
  });

  it('seguir pausada não gera um alerta a cada update', () => {
    farmFalso.emitir('printer', pausada, imprimindo);
    farmFalso.emitir('printer', impressora({ status: 'pausada', pct: 43 }), pausada);
    farmFalso.emitir('printer', impressora({ status: 'pausada', pct: 44 }), pausada);

    expect(vistos.filter((a) => a.codigo === 'impressao_pausada')).toHaveLength(1);
  });

  it('o primeiro snapshot não alerta — sem anterior não há transição', () => {
    farmFalso.emitir('printer', pausada, null);
    expect(vistos).toHaveLength(0);
  });

  it('notifica sem ninguém configurar nada', () => {
    // era este o sintoma: o alerta existia na tela e nunca virava mensagem
    expect(CODIGOS_PADRAO).toContain('impressao_pausada');
    expect(CODIGOS_DE_ALERTA.map((c) => c.codigo)).toContain('impressao_pausada');
  });
});
