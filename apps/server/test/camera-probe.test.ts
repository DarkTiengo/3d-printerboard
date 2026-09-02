import { describe, expect, it } from 'vitest';
import { resolverUrlDaCamera } from '../src/lib/camera-probe.js';

/**
 * O Moonraker devolve URLs de webcam ora relativas, ora absolutas, e quase
 * nunca na porta dele. Resolver isso errado é o que faria a descoberta
 * automática apontar para o lugar errado.
 */
describe('resolverUrlDaCamera', () => {
  const moonraker = 'http://ender-a.local:7125';

  it('resolve caminho relativo contra o host, mantendo a porta do Moonraker', () => {
    expect(resolverUrlDaCamera(moonraker, '/webcam/?action=stream')).toBe(
      'http://ender-a.local:7125/webcam/?action=stream'
    );
  });

  it('mantém URL absoluta como está, inclusive em outra porta', () => {
    expect(resolverUrlDaCamera(moonraker, 'http://ender-a.local:8080/?action=stream')).toBe(
      'http://ender-a.local:8080/?action=stream'
    );
  });

  it('preserva https', () => {
    expect(resolverUrlDaCamera('https://fazenda.example.com', '/webcam/')).toBe(
      'https://fazenda.example.com/webcam/'
    );
  });

  it('aceita caminho sem barra inicial', () => {
    expect(resolverUrlDaCamera(moonraker, 'webcam/?action=stream')).toBe(
      'http://ender-a.local:7125/webcam/?action=stream'
    );
  });

  it('devolve null quando a URL base é inválida', () => {
    expect(resolverUrlDaCamera('não é url', '/webcam/')).toBeNull();
  });
});
