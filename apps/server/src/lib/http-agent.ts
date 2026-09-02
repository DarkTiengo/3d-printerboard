import { Agent } from 'undici';
import { lookupComMdns } from './mdns.js';

/**
 * Agente HTTP usado em toda chamada que sai para a fazenda.
 *
 * Existe por dois motivos: ensinar o `fetch` a resolver nomes `.local` (a libc
 * da imagem não resolve) e manter as conexões vivas — o proxy de câmera e o
 * polling de snapshot abririam um handshake novo a cada quadro sem isso.
 */
const agente = new Agent({
  connect: { lookup: lookupComMdns as never, timeout: 10_000 },
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 120_000,
  // streams MJPEG ficam abertos por horas
  bodyTimeout: 0,
  headersTimeout: 30_000
});

/**
 * O `dispatcher` não existe no RequestInit padrão do DOM, e os tipos do undici
 * instalado brigam com os que vêm embutidos no Node. Exportamos já apagado
 * para o cast ficar num lugar só, aqui, em vez de em cada chamada.
 */
export const agenteDaFazenda = agente as unknown as undefined;
