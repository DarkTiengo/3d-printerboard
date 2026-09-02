/**
 * Demultiplexador de MJPEG.
 *
 * Em vez de interpretar as fronteiras do multipart — que variam bastante entre
 * mjpg-streamer, ustreamer e crowsnest, e às vezes vêm sem Content-Length —
 * localizamos os próprios marcadores JPEG: SOI (FF D8 FF) e EOI (FF D9).
 * Dentro do fluxo entropy-coded todo FF real é escapado como FF 00, então um
 * FF D9 solto só aparece no fim de verdade. A exceção seria uma miniatura EXIF
 * embutida, que nenhuma das fontes de webcam acima gera.
 */

const SOI = Buffer.from([0xff, 0xd8, 0xff]);
const EOI = Buffer.from([0xff, 0xd9]);

/** Acima disso não é mais um quadro: é lixo acumulado por dessincronia. */
const MAX_QUADRO = 8 * 1024 * 1024;

export class MjpegDemuxer {
  private buf: Buffer = Buffer.alloc(0);

  /** Consome um pedaço do fluxo e devolve os quadros completos que fecharam. */
  push(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const quadros: Buffer[] = [];

    for (;;) {
      const inicio = this.buf.indexOf(SOI);
      if (inicio < 0) {
        // nada aproveitável; guarda só a cauda que pode ser um SOI partido
        if (this.buf.length > 2) this.buf = this.buf.subarray(this.buf.length - 2);
        break;
      }
      const fim = this.buf.indexOf(EOI, inicio + SOI.length);
      if (fim < 0) {
        if (inicio > 0) this.buf = this.buf.subarray(inicio);
        if (this.buf.length > MAX_QUADRO) this.buf = Buffer.alloc(0); // dessincronizou
        break;
      }
      quadros.push(this.buf.subarray(inicio, fim + EOI.length));
      this.buf = this.buf.subarray(fim + EOI.length);
    }

    return quadros;
  }

  reset(): void {
    this.buf = Buffer.alloc(0);
  }
}

export const BOUNDARY = 'quadro3dfarm';

export function cabecalhoMultipart(): string {
  return `multipart/x-mixed-replace; boundary=${BOUNDARY}`;
}

/** Envelopa um JPEG como uma parte do multipart que mandamos ao navegador. */
export function envelopar(jpeg: Buffer): Buffer {
  const cabecalho = Buffer.from(
    `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
    'ascii'
  );
  return Buffer.concat([cabecalho, jpeg, Buffer.from('\r\n', 'ascii')]);
}
