import { describe, expect, it } from 'vitest';
import { ehNomeLocal, lerRespostaA, montarConsulta } from '../src/lib/mdns.js';

/**
 * mDNS é falado no multicast, que não dá para exercitar de forma estável num
 * teste. O que tem lógica de verdade é a codificação dos pacotes — e é ela
 * que estes testes cobrem.
 */

/** Monta uma resposta mDNS com um registro A, para o decodificador ler. */
function respostaA(nome: string, ip: string, ttl = 120): Buffer {
  const rotulos = nome.split('.');
  const partes: Buffer[] = [];

  const cabecalho = Buffer.alloc(12);
  cabecalho.writeUInt16BE(0x8400, 2); // resposta autoritativa
  cabecalho.writeUInt16BE(0, 4); // sem perguntas
  cabecalho.writeUInt16BE(1, 6); // uma resposta
  partes.push(cabecalho);

  for (const r of rotulos) partes.push(Buffer.from([r.length]), Buffer.from(r));
  partes.push(Buffer.from([0]));

  const meta = Buffer.alloc(10);
  meta.writeUInt16BE(1, 0); // tipo A
  meta.writeUInt16BE(1, 2); // classe IN
  meta.writeUInt32BE(ttl, 4);
  meta.writeUInt16BE(4, 8); // tamanho
  partes.push(meta, Buffer.from(ip.split('.').map(Number)));

  return Buffer.concat(partes);
}

describe('ehNomeLocal', () => {
  it('reconhece nomes .local, com e sem ponto final', () => {
    expect(ehNomeLocal('ender-a.local')).toBe(true);
    expect(ehNomeLocal('ender-a.local.')).toBe(true);
    expect(ehNomeLocal('ENDER-A.LOCAL')).toBe(true);
  });

  it('ignora o resto', () => {
    expect(ehNomeLocal('fazenda.example.com')).toBe(false);
    expect(ehNomeLocal('192.168.1.50')).toBe(false);
    expect(ehNomeLocal('localhost')).toBe(false);
  });
});

describe('montarConsulta', () => {
  it('codifica o nome em rótulos com tamanho', () => {
    const q = montarConsulta('ender-a.local');
    expect(q.readUInt16BE(4)).toBe(1); // uma pergunta
    // 7 = "ender-a", 5 = "local"
    expect(q[12]).toBe(7);
    expect(q.subarray(13, 20).toString()).toBe('ender-a');
    expect(q[20]).toBe(5);
    expect(q.subarray(21, 26).toString()).toBe('local');
    expect(q[26]).toBe(0); // fim do nome
    expect(q.readUInt16BE(27)).toBe(1); // tipo A
    expect(q.readUInt16BE(29)).toBe(1); // classe IN
  });

  it('recusa rótulo acima do limite do protocolo', () => {
    expect(() => montarConsulta(`${'a'.repeat(64)}.local`)).toThrow();
  });
});

describe('lerRespostaA', () => {
  it('extrai nome e IP', () => {
    expect(lerRespostaA(respostaA('ender-a.local', '192.168.1.50'))).toEqual([
      { nome: 'ender-a.local', ip: '192.168.1.50', ttlMs: 120_000 }
    ]);
  });

  it('prende o TTL entre 5 s e 2 min — impressora troca de IP', () => {
    expect(lerRespostaA(respostaA('a.local', '10.0.0.1', 1))[0].ttlMs).toBe(5_000);
    expect(lerRespostaA(respostaA('a.local', '10.0.0.1', 86_400))[0].ttlMs).toBe(120_000);
  });

  it('não estoura com pacote vazio, curto ou truncado', () => {
    expect(lerRespostaA(Buffer.alloc(0))).toEqual([]);
    expect(lerRespostaA(Buffer.from([1, 2, 3]))).toEqual([]);
    const truncado = respostaA('ender-a.local', '192.168.1.50').subarray(0, 20);
    expect(lerRespostaA(truncado)).toEqual([]);
  });

  it('ignora resposta que não seja registro A', () => {
    const pacote = respostaA('a.local', '10.0.0.1');
    pacote.writeUInt16BE(28, pacote.length - 14); // vira AAAA
    expect(lerRespostaA(pacote)).toEqual([]);
  });

  it('sobrevive a ponteiro de compressão em laço', () => {
    // ponteiro apontando para si mesmo: o decodificador precisa desistir, não travar
    const cabecalho = Buffer.alloc(12);
    cabecalho.writeUInt16BE(1, 6);
    const laco = Buffer.from([0xc0, 0x0c]);
    expect(() => lerRespostaA(Buffer.concat([cabecalho, laco]))).not.toThrow();
  });
});
