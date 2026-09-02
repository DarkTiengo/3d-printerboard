import dgram from 'node:dgram';
import dns from 'node:dns';

/**
 * Resolução de nomes `.local` (mDNS) dentro do processo.
 *
 * A imagem roda sobre musl (Alpine), cujo resolvedor não tem NSS e portanto
 * ignora mDNS por completo: `ender-a.local` simplesmente não resolve, nem com
 * `network_mode: host`. Em vez de trocar a base por glibc e depender de um
 * socket do Avahi montado do host, perguntamos direto no multicast — é o
 * protocolo inteiro para o caso de uso, cabe em um arquivo e não tem dependência.
 *
 * Requer que o container enxergue a rede local (NETWORK_MODE=host): multicast
 * não atravessa a bridge padrão do Docker.
 */

const GRUPO = '224.0.0.251';
const PORTA = 5353;
const TIMEOUT_MS = 1_500;

/** Respostas ficam em cache pelo TTL do registro, com teto — impressoras trocam de IP. */
const TTL_MAX_MS = 120_000;
const TTL_MIN_MS = 5_000;

type Entrada = { ip: string; expiraEm: number };
const cache = new Map<string, Entrada>();
/** Consultas em voo, para oito impressoras subindo juntas não virarem oito pacotes iguais. */
const emVoo = new Map<string, Promise<string | null>>();

export function ehNomeLocal(hostname: string): boolean {
  return /\.local\.?$/i.test(hostname);
}

// ── codificação DNS ─────────────────────────────────────────────────────────

/** Monta uma pergunta padrão: um QNAME, tipo A, classe IN. */
export function montarConsulta(nome: string, tipo = 1): Buffer {
  const rotulos = nome.replace(/\.$/, '').split('.');
  const partes: Buffer[] = [];

  // cabeçalho: id 0 (mDNS ignora), sem flags, 1 pergunta
  const cabecalho = Buffer.alloc(12);
  cabecalho.writeUInt16BE(0, 0);
  cabecalho.writeUInt16BE(0, 2);
  cabecalho.writeUInt16BE(1, 4);
  partes.push(cabecalho);

  for (const rotulo of rotulos) {
    const bytes = Buffer.from(rotulo, 'utf8');
    if (bytes.length > 63) throw new Error(`rótulo longo demais em ${nome}`);
    partes.push(Buffer.from([bytes.length]), bytes);
  }
  partes.push(Buffer.from([0]));

  const fim = Buffer.alloc(4);
  fim.writeUInt16BE(tipo, 0); // A
  fim.writeUInt16BE(1, 2); // IN
  partes.push(fim);

  return Buffer.concat(partes);
}

/** Lê um nome, seguindo ponteiros de compressão. Devolve o nome e onde parar. */
function lerNome(buf: Buffer, offset: number): { nome: string; proximo: number } {
  const rotulos: string[] = [];
  let i = offset;
  let proximo = -1;
  let saltos = 0;

  while (i < buf.length) {
    const tamanho = buf[i];
    if (tamanho === 0) {
      i++;
      break;
    }
    if ((tamanho & 0xc0) === 0xc0) {
      // ponteiro de compressão
      if (i + 1 >= buf.length) break;
      const alvo = ((tamanho & 0x3f) << 8) | buf[i + 1];
      if (proximo === -1) proximo = i + 2;
      if (++saltos > 10 || alvo >= buf.length) break; // pacote malformado ou em laço
      i = alvo;
      continue;
    }
    if (i + 1 + tamanho > buf.length) break;
    rotulos.push(buf.subarray(i + 1, i + 1 + tamanho).toString('utf8'));
    i += 1 + tamanho;
  }

  return { nome: rotulos.join('.'), proximo: proximo === -1 ? i : proximo };
}

export type RegistroA = { nome: string; ip: string; ttlMs: number };

/** Extrai os registros A de uma resposta mDNS. Pacote inválido devolve lista vazia. */
export function lerRespostaA(buf: Buffer): RegistroA[] {
  if (buf.length < 12) return [];
  const out: RegistroA[] = [];

  try {
    const qdcount = buf.readUInt16BE(4);
    const ancount = buf.readUInt16BE(6);
    let i = 12;

    for (let q = 0; q < qdcount; q++) {
      i = lerNome(buf, i).proximo + 4; // pula QTYPE e QCLASS
    }

    for (let a = 0; a < ancount && i < buf.length; a++) {
      const { nome, proximo } = lerNome(buf, i);
      i = proximo;
      if (i + 10 > buf.length) break;

      const tipo = buf.readUInt16BE(i);
      const ttl = buf.readUInt32BE(i + 4);
      const tamanho = buf.readUInt16BE(i + 8);
      i += 10;
      if (i + tamanho > buf.length) break;

      if (tipo === 1 && tamanho === 4) {
        out.push({
          nome: nome.toLowerCase(),
          ip: `${buf[i]}.${buf[i + 1]}.${buf[i + 2]}.${buf[i + 3]}`,
          ttlMs: Math.min(Math.max(ttl * 1000, TTL_MIN_MS), TTL_MAX_MS)
        });
      }
      i += tamanho;
    }
  } catch {
    return out; // pacote truncado: devolve o que já deu para ler
  }

  return out;
}

// ── consulta ────────────────────────────────────────────────────────────────

/** Pergunta no multicast e devolve o primeiro IP que responder pelo nome. */
function perguntar(nome: string): Promise<string | null> {
  const alvo = nome.replace(/\.$/, '').toLowerCase();

  return new Promise((resolve) => {
    let socket: dgram.Socket;
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      resolve(null);
      return;
    }

    let encerrado = false;
    const terminar = (ip: string | null) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* já fechado */
      }
      resolve(ip);
    };

    const timer = setTimeout(() => terminar(null), TIMEOUT_MS);

    socket.on('error', () => terminar(null));

    socket.on('message', (msg) => {
      for (const reg of lerRespostaA(msg)) {
        if (reg.nome === alvo) {
          cache.set(alvo, { ip: reg.ip, expiraEm: Date.now() + reg.ttlMs });
          terminar(reg.ip);
          return;
        }
      }
    });

    socket.bind(() => {
      try {
        socket.setMulticastTTL(255);
        socket.send(montarConsulta(alvo), PORTA, GRUPO, (err) => {
          if (err) terminar(null);
        });
      } catch {
        terminar(null);
      }
    });
  });
}

/** IP de um nome `.local`, com cache. Devolve null quando ninguém responde. */
export async function resolverLocal(hostname: string): Promise<string | null> {
  const nome = hostname.replace(/\.$/, '').toLowerCase();

  const emCache = cache.get(nome);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.ip;

  const jaEmVoo = emVoo.get(nome);
  if (jaEmVoo) return jaEmVoo;

  const promessa = perguntar(nome).finally(() => emVoo.delete(nome));
  emVoo.set(nome, promessa);
  return promessa;
}

export function limparCacheMdns(): void {
  cache.clear();
}

// ── integração com http/ws ──────────────────────────────────────────────────

type Callback = (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void;

/**
 * Substituto de `dns.lookup` que entende `.local`. É isto que se passa para o
 * `ws` e para o agente HTTP; qualquer outro nome segue pelo resolvedor normal.
 */
export function lookupComMdns(hostname: string, opcoes: any, callback?: Callback): void {
  const cb = (typeof opcoes === 'function' ? opcoes : callback) as Callback;
  const opts = typeof opcoes === 'function' ? {} : (opcoes ?? {});

  if (!ehNomeLocal(hostname)) {
    dns.lookup(hostname, opts, cb);
    return;
  }

  void resolverLocal(hostname).then((ip) => {
    if (ip) {
      // `all: true` espera uma lista; o resto espera endereço + família
      if (opts.all) cb(null, [{ address: ip, family: 4 }] as any);
      else cb(null, ip, 4);
      return;
    }
    // ninguém respondeu no multicast: ainda pode existir no DNS unicast
    dns.lookup(hostname, opts, (err, ...resto) => {
      if (err) {
        const erro: NodeJS.ErrnoException = new Error(
          `não foi possível resolver ${hostname} por mDNS nem por DNS. ` +
            `O container precisa enxergar a rede local — confira NETWORK_MODE=host.`
        );
        erro.code = 'ENOTFOUND';
        cb(erro);
        return;
      }
      cb(null, ...(resto as [any, number]));
    });
  });
}
