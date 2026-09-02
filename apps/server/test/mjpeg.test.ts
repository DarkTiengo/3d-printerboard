import { describe, expect, it } from 'vitest';
import { MjpegDemuxer, envelopar, BOUNDARY } from '../src/lib/mjpeg.js';

/** JPEG mínimo: SOI + carga + EOI. */
function quadro(carga: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(carga), Buffer.from([0xff, 0xd9])]);
}

const CABECALHO = Buffer.from('--limite\r\nContent-Type: image/jpeg\r\n\r\n');

describe('MjpegDemuxer', () => {
  it('extrai um quadro completo cercado de cabeçalhos multipart', () => {
    const d = new MjpegDemuxer();
    const quadros = d.push(Buffer.concat([CABECALHO, quadro('AAA'), Buffer.from('\r\n')]));
    expect(quadros).toHaveLength(1);
    expect(quadros[0].toString('binary')).toContain('AAA');
  });

  it('junta um quadro partido entre vários pedaços do socket', () => {
    const d = new MjpegDemuxer();
    const completo = Buffer.concat([CABECALHO, quadro('PARTIDO')]);
    const meio = Math.floor(completo.length / 2);

    expect(d.push(completo.subarray(0, meio))).toHaveLength(0);
    const quadros = d.push(completo.subarray(meio));
    expect(quadros).toHaveLength(1);
    expect(quadros[0].toString('binary')).toContain('PARTIDO');
  });

  it('devolve vários quadros que chegaram no mesmo pedaço', () => {
    const d = new MjpegDemuxer();
    const quadros = d.push(
      Buffer.concat([CABECALHO, quadro('UM'), CABECALHO, quadro('DOIS'), CABECALHO, quadro('TRES')])
    );
    expect(quadros).toHaveLength(3);
    expect(quadros.map((q) => q.toString('binary').replace(/[^A-Z]/g, ''))).toEqual(['UM', 'DOIS', 'TRES']);
  });

  it('não emite nada quando só veio lixo, e não acumula sem limite', () => {
    const d = new MjpegDemuxer();
    expect(d.push(Buffer.from('nada de jpeg aqui'))).toHaveLength(0);
    // depois do lixo, um quadro válido ainda é reconhecido
    expect(d.push(quadro('DEPOIS'))).toHaveLength(1);
  });
});

describe('envelopar', () => {
  it('gera a parte multipart com o Content-Length certo', () => {
    const jpeg = quadro('X');
    const texto = envelopar(jpeg).toString('binary');
    expect(texto.startsWith(`--${BOUNDARY}\r\n`)).toBe(true);
    expect(texto).toContain(`Content-Length: ${jpeg.length}`);
    expect(texto.endsWith('\r\n')).toBe(true);
  });
});
