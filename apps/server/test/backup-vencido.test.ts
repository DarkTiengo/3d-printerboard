import { describe, expect, it, vi } from 'vitest';

// backup.ts arrasta banco, tar e fetch; o que interessa aqui é a regra pura
vi.mock('../src/db/index.js', () => ({ getDb: () => ({}), getSetting: () => null, setSetting: () => {} }));
vi.mock('../src/services/farm.js', () => ({ farm: { http: () => null, printers: () => [] } }));
vi.mock('../src/services/printers.repo.js', () => ({ listarPrinters: () => [], acharPrinter: () => null }));
vi.mock('../src/services/alerts.js', () => ({ criarAlerta: async () => null }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const { backupVencido, descreverCron } = await import('../src/services/backup.js');

const AGORA = new Date('2026-09-02T12:00:00Z').getTime();
const horasAtras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString();

describe('backupVencido', () => {
  it('nunca copiada está sempre vencida', () => {
    expect(backupVencido(null, 24, AGORA)).toBe(true);
  });

  it('dentro da janela não está vencido', () => {
    expect(backupVencido(horasAtras(5), 24, AGORA)).toBe(false);
    expect(backupVencido(horasAtras(23.9), 24, AGORA)).toBe(false);
  });

  it('vence exatamente ao completar o intervalo', () => {
    expect(backupVencido(horasAtras(24), 24, AGORA)).toBe(true);
    expect(backupVencido(horasAtras(96), 24, AGORA)).toBe(true);
  });

  it('respeita um intervalo customizado', () => {
    expect(backupVencido(horasAtras(8), 6, AGORA)).toBe(true);
    expect(backupVencido(horasAtras(8), 12, AGORA)).toBe(false);
  });

  it('data corrompida conta como vencida — melhor copiar de novo que confiar', () => {
    expect(backupVencido('não é uma data', 24, AGORA)).toBe(true);
  });

  it('não considera vencido um backup do futuro (relógio do host adiantado)', () => {
    expect(backupVencido(new Date(AGORA + 3_600_000).toISOString(), 24, AGORA)).toBe(false);
  });
});

describe('descreverCron', () => {
  it('traduz o padrão diário', () => {
    expect(descreverCron('0 3 * * *')).toBe('diário 03:00');
    expect(descreverCron('30 22 * * *')).toBe('diário 22:30');
  });

  it('devolve o cru quando o padrão não bate', () => {
    expect(descreverCron('*/15 * * * *')).toBe('*/15 * * * *');
  });
});
