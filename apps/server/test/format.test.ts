import { describe, expect, it } from 'vitest';
import { bytes, duracao, quando, quandoCurto, semExtensao, temperatura, alvo } from '@3dfarm/shared';

describe('duracao', () => {
  it('formata como o design: 1h 14m', () => {
    expect(duracao(4470)).toBe('1h 14m');
    expect(duracao(480)).toBe('0h 08m');
    expect(duracao(0)).toBe('0h 00m');
  });
  it('devolve travessão para nulo e negativo', () => {
    expect(duracao(null)).toBe('—');
    expect(duracao(-5)).toBe('—');
    expect(duracao(NaN)).toBe('—');
  });
});

describe('quando', () => {
  const agora = new Date('2026-09-02T12:00:00Z').getTime();
  const atras = (ms: number) => new Date(agora - ms).toISOString();

  it('escala de agora até dias', () => {
    expect(quando(atras(30_000), agora)).toBe('agora');
    expect(quando(atras(6 * 60_000), agora)).toBe('há 6 min');
    expect(quando(atras(2 * 3_600_000), agora)).toBe('há 2 h');
    expect(quando(atras(26 * 3_600_000), agora)).toBe('ontem');
    expect(quando(atras(4 * 86_400_000), agora)).toBe('há 4 d');
  });
});

describe('quandoCurto', () => {
  it('usa hora do dia quando é hoje', () => {
    const agora = new Date(2026, 8, 2, 12, 0, 0).getTime();
    const hojeDeManha = new Date(2026, 8, 2, 3, 0, 0).toISOString();
    expect(quandoCurto(hojeDeManha, agora)).toBe('hoje 03:00');
  });
  it('diz nunca quando não há data', () => {
    expect(quandoCurto(null)).toBe('nunca');
  });
});

describe('bytes', () => {
  it('usa vírgula decimal, como o resto da UI', () => {
    expect(bytes(1_181_116_006)).toBe('1,1 GB');
    expect(bytes(1024)).toBe('1,0 KB');
    expect(bytes(500)).toBe('500 B');
    expect(bytes(0)).toBe('0 B');
  });
});

describe('temperatura e alvo', () => {
  it('formata com uma casa e vírgula', () => {
    expect(temperatura(210.42)).toBe('210,4 °C');
  });
  it('chama alvo zerado de desligado', () => {
    expect(alvo(0)).toBe('desligado');
    expect(alvo(60)).toBe('60 °C');
  });
});

describe('semExtensao', () => {
  it('tira as extensões de G-code conhecidas', () => {
    expect(semExtensao('suporte_camera_v3.gcode')).toBe('suporte_camera_v3');
    expect(semExtensao('peça.bgcode')).toBe('peça');
    expect(semExtensao('sem_extensao')).toBe('sem_extensao');
  });
});
