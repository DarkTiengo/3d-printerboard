import { describe, expect, it, vi } from 'vitest';

/**
 * Regressões das falhas encontradas na auditoria de segurança.
 * Cada teste aqui existe porque o comportamento oposto já esteve no código.
 */

vi.mock('../src/db/index.js', () => ({ getDb: () => ({}), getSetting: () => null, setSetting: () => {} }));
vi.mock('../src/services/farm.js', () => ({ farm: { http: () => null, printers: () => [] } }));
vi.mock('../src/services/printers.repo.js', () => ({ listarPrinters: () => [], acharPrinter: () => null }));
vi.mock('../src/services/alerts.js', () => ({ criarAlerta: async () => null }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));

const { _caminhoSeguro } = await import('../src/services/backup.js');
const { pode } = await import('@3dfarm/shared');

describe('caminhoSeguro (travessia de diretório na restauração)', () => {
  const raiz = '/data/.tmp-restore/config';

  it('aceita caminhos comuns de configuração', () => {
    expect(_caminhoSeguro(raiz, 'printer.cfg')).toBe(true);
    expect(_caminhoSeguro(raiz, 'macros/cabecalho.cfg')).toBe(true);
  });

  it('barra subida de diretório', () => {
    expect(_caminhoSeguro(raiz, '../../../etc/passwd')).toBe(false);
    expect(_caminhoSeguro(raiz, 'macros/../../fora.cfg')).toBe(false);
  });

  it('barra caminho absoluto', () => {
    expect(_caminhoSeguro(raiz, '/etc/shadow')).toBe(false);
  });

  it('barra caminho vazio', () => {
    expect(_caminhoSeguro(raiz, '')).toBe(false);
  });

  it('não se deixa enganar por prefixo parecido', () => {
    // /data/.tmp-restore/config-outro não está dentro de /data/.tmp-restore/config
    expect(_caminhoSeguro(raiz, '../config-outro/x.cfg')).toBe(false);
  });
});

describe('matriz de permissões', () => {
  it('leitura não controla nada', () => {
    expect(pode('leitura', 'controlarImpressao')).toBe(false);
    expect(pode('leitura', 'pararEmergencia')).toBe(false);
    expect(pode('leitura', 'enfileirar')).toBe(false);
    expect(pode('leitura', 'restaurarBackup')).toBe(false);
    expect(pode('leitura', 'gerirImpressoras')).toBe(false);
    expect(pode('leitura', 'gerirUsuarios')).toBe(false);
    expect(pode('leitura', 'reiniciarMaquina')).toBe(false);
    expect(pode('leitura', 'gerirNotificacoes')).toBe(false);
    expect(pode('leitura', 'desligarMaquina')).toBe(false);
  });

  it('operador opera mas não administra', () => {
    expect(pode('operador', 'controlarImpressao')).toBe(true);
    expect(pode('operador', 'rodarBackup')).toBe(true);
    expect(pode('operador', 'restaurarBackup')).toBe(false);
    expect(pode('operador', 'gerirImpressoras')).toBe(false);
    expect(pode('operador', 'gerirUsuarios')).toBe(false);
    // o token do bot é credencial: mesmo nível de cadastrar impressoras
    expect(pode('operador', 'gerirNotificacoes')).toBe(false);
    expect(pode('admin', 'gerirNotificacoes')).toBe(true);
  });

  it('reiniciar o host é operação; desligar é administração', () => {
    // o reinício se desfaz sozinho e é a saída para um Klipper travado; o
    // desligamento só volta com alguém no lugar apertando o botão
    expect(pode('operador', 'reiniciarMaquina')).toBe(true);
    expect(pode('operador', 'desligarMaquina')).toBe(false);
    expect(pode('admin', 'reiniciarMaquina')).toBe(true);
    expect(pode('admin', 'desligarMaquina')).toBe(true);
  });

  it('papel ausente nunca autoriza', () => {
    expect(pode(undefined, 'controlarImpressao')).toBe(false);
  });
});
