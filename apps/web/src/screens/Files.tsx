import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Send } from 'lucide-react';
import type { GcodeFile, Printer, User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { api } from '../lib/api';
import { IconButton } from '../components/IconButton';
import { Ponto } from '../components/Tag';
import { corDoPonto } from '../lib/status';
import { usePrintersVisiveis } from '../store/printers';
import { useT } from '../i18n';

/** Destino especial: cada arquivo vai para a impressora da própria seção. */
const DESTINO_GRUPO = '@grupo';
/** Destino especial: a fila escolhe a primeira máquina ociosa. */
const DESTINO_LIVRE = '';

/**
 * Arquivos — design/README.md § 4, agrupado por impressora.
 *
 * O agrupamento não é decoração: é o que responde "qual máquina vai imprimir
 * isso". Cada arquivo aparece sob a impressora onde ele já está, e o botão de
 * enfileirar manda para aquela mesma máquina — sem cópia entre hosts, sem
 * ambiguidade. O seletor no topo continua permitindo desviar para a próxima
 * livre ou para uma máquina específica, e aí o rótulo de cada botão muda junto.
 */
export function Files({ usuario }: { usuario: User }) {
  const t = useT();
  const printers = usePrintersVisiveis();
  const podeEnfileirar = pode(usuario.role, 'enfileirar');
  const [destino, setDestino] = useState<string>(DESTINO_GRUPO);
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);

  const {
    data: arquivos,
    isLoading,
    error
  } = useQuery({ queryKey: ['arquivos'], queryFn: api.arquivos, staleTime: 30_000 });

  const qc = useQueryClient();
  const enfileirar = useMutation({
    mutationFn: ({ arquivo, para }: { arquivo: string; para: string | null }) => api.enfileirar(arquivo, para),
    onSuccess: (job) => {
      const nome = job.destino ? (printers.find((p) => p.id === job.destino)?.nome ?? job.destino) : t.fila.proximaLivre;
      setAviso(t.arquivos.enviado(job.arquivo, nome));
      void qc.invalidateQueries({ queryKey: ['fila'] });
      setTimeout(() => setAviso(null), 4000);
    },
    onError: (err) => setAviso(err instanceof Error ? err.message : t.arquivos.falhaEnfileirar)
  });

  /** Uma seção por impressora cadastrada, mesmo as sem arquivo. */
  const secoes = useMemo(() => {
    const porImpressora = new Map<string, GcodeFile[]>();
    for (const a of arquivos ?? []) {
      const lista = porImpressora.get(a.printerId);
      if (lista) lista.push(a);
      else porImpressora.set(a.printerId, [a]);
    }
    return printers.map((p) => ({ printer: p, arquivos: porImpressora.get(p.id) ?? [] }));
  }, [arquivos, printers]);

  /** Para onde este arquivo vai, dado o seletor e a seção em que ele está. */
  const destinoDe = (secao: Printer): string | null => {
    if (destino === DESTINO_GRUPO) return secao.id;
    if (destino === DESTINO_LIVRE) return null;
    return destino;
  };

  const nomeDoDestino = (secao: Printer): string => {
    const id = destinoDe(secao);
    return id ? (printers.find((p) => p.id === id)?.nome ?? id) : t.fila.proximaLivre;
  };

  const alternar = (id: string) =>
    setRecolhidas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 22px',
          borderBottom: '2px solid var(--color-neutral-700)',
          flexWrap: 'wrap'
        }}
      >
        <span className="mono">{t.arquivos.biblioteca(arquivos?.length ?? 0)}</span>
        <span className="mono" style={{ color: 'var(--color-neutral-500)' }}>
          {t.arquivos.agrupadoPor}
        </span>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <span className="mono">{t.arquivos.enviarPara}</span>
          <select
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-neutral-700)',
              borderRadius: 999,
              color: 'var(--color-bg)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              padding: '7px 12px'
            }}
          >
            <option value={DESTINO_GRUPO}>{t.arquivos.destinoGrupo}</option>
            <option value={DESTINO_LIVRE}>{t.fila.proximaLivre}</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      {aviso && (
        <div
          role="status"
          style={{
            flex: 'none',
            padding: '10px 22px',
            borderBottom: '1px solid var(--color-neutral-800)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-accent-400)'
          }}
        >
          {aviso}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {isLoading && (
          <div style={{ padding: 22 }}>
            <span className="mono">{t.arquivos.carregando}</span>
          </div>
        )}
        {error && (
          <div style={{ padding: 22 }}>
            <span className="mono">{t.arquivos.erro}</span>
          </div>
        )}
        {!isLoading && !error && secoes.every((s) => s.arquivos.length === 0) && (
          <div style={{ padding: 22 }}>
            <span className="mono">{t.arquivos.vazio}</span>
          </div>
        )}

        {secoes.map(({ printer, arquivos: doGrupo }) => {
          const recolhida = recolhidas.has(printer.id);
          return (
            <section key={printer.id}>
              <button
                type="button"
                onClick={() => alternar(printer.id)}
                aria-expanded={!recolhida}
                aria-label={recolhida ? t.arquivos.expandir(printer.nome) : t.arquivos.recolher(printer.nome)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '14px 22px',
                  border: 0,
                  borderBottom: '1px solid var(--color-neutral-800)',
                  background: 'transparent',
                  color: 'var(--color-bg)',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                {recolhida ? (
                  <ChevronRight size={15} strokeWidth={2} aria-hidden style={{ color: 'var(--color-neutral-400)' }} />
                ) : (
                  <ChevronDown size={15} strokeWidth={2} aria-hidden style={{ color: 'var(--color-neutral-400)' }} />
                )}
                <Ponto cor={corDoPonto(printer.status, printer.online)} />
                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15 }}>{printer.nome}</span>
                <span className="mono">{printer.id}</span>
                <span className="mono" style={{ marginLeft: 'auto' }}>
                  {printer.online ? t.arquivos.contagem(doGrupo.length) : t.status.offline}
                </span>
              </button>

              {!recolhida && (
                <div style={{ padding: 22 }}>
                  {doGrupo.length === 0 ? (
                    <span className="mono" style={{ color: 'var(--color-neutral-500)' }}>
                      {printer.online ? t.arquivos.semArquivos : t.arquivos.impressoraOffline}
                    </span>
                  ) : (
                    <div
                      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}
                    >
                      {doGrupo.map((a) => (
                        <CardArquivo
                          key={`${a.printerId}:${a.path}`}
                          t={t}
                          arquivo={a}
                          destinoNome={nomeDoDestino(printer)}
                          podeEnfileirar={podeEnfileirar}
                          enviando={enfileirar.isPending && enfileirar.variables?.arquivo === a.path}
                          aoEnviar={() => enfileirar.mutate({ arquivo: a.path, para: destinoDe(printer) })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CardArquivo({
  t,
  arquivo,
  destinoNome,
  podeEnfileirar,
  enviando,
  aoEnviar
}: {
  t: ReturnType<typeof useT>;
  arquivo: GcodeFile;
  destinoNome: string;
  podeEnfileirar: boolean;
  enviando: boolean;
  aoEnviar: () => void;
}) {
  return (
    <article style={{ border: '2px solid var(--color-neutral-700)', display: 'flex', flexDirection: 'column' }}>
      <div
        className={arquivo.thumbnailUrl ? undefined : 'listrado'}
        style={{ position: 'relative', aspectRatio: '4 / 3', background: 'var(--color-neutral-900)' }}
      >
        {arquivo.thumbnailUrl && (
          <img
            src={arquivo.thumbnailUrl}
            alt={t.arquivos.previaDe(arquivo.nome)}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        )}
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <h3 style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={arquivo.nome}>
          {arquivo.nome}
        </h3>
        <div className="mono">{arquivo.perfil}</div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-neutral-400)'
          }}
        >
          <span>{arquivo.tempo}</span>
          <span>{arquivo.filamento}</span>
          <span>{arquivo.impressoes}×</span>
          <span style={{ marginLeft: 'auto' }}>
            <IconButton
              /* o rótulo diz a máquina de destino, não só "para a fila" */
              rotulo={
                podeEnfileirar
                  ? `${t.arquivos.enfileirar(arquivo.nome)} → ${destinoNome}`
                  : t.arquivos.enfileirarSemPermissao
              }
              variante="primaria"
              disabled={!podeEnfileirar || enviando}
              onClick={aoEnviar}
              icone={<Send size={16} strokeWidth={2} aria-hidden />}
            />
          </span>
        </div>
      </div>
    </article>
  );
}
