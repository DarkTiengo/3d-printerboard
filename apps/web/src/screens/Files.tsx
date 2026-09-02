import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import type { GcodeFile, User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { api } from '../lib/api';
import { IconButton } from '../components/IconButton';
import { usePrintersVisiveis } from '../store/printers';

/**
 * Arquivos — design/README.md § 4.
 * Grade de cards com prévia 4:3, perfil de fatiamento e métricas.
 */
export function Files({ usuario }: { usuario: User }) {
  const printers = usePrintersVisiveis();
  const podeEnfileirar = pode(usuario.role, 'enfileirar');
  const [destino, setDestino] = useState<string>('');
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: arquivos, isLoading, error } = useQuery({
    queryKey: ['arquivos'],
    queryFn: api.arquivos,
    staleTime: 30_000
  });

  const qc = useQueryClient();
  const enfileirar = useMutation({
    mutationFn: (arquivo: string) => api.enfileirar(arquivo, destino || null),
    onSuccess: (job) => {
      setAviso(`${job.arquivo} enviado para a fila (${job.destinoNome}).`);
      void qc.invalidateQueries({ queryKey: ['fila'] });
      setTimeout(() => setAviso(null), 4000);
    },
    onError: (err) => setAviso(err instanceof Error ? err.message : 'Falha ao enfileirar.')
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
        <span className="mono">BIBLIOTECA — {arquivos?.length ?? 0} ARQUIVOS</span>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <span className="mono">ENVIAR PARA</span>
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
            <option value="">próxima livre</option>
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

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 22 }}>
        {isLoading && <span className="mono">CARREGANDO BIBLIOTECA…</span>}
        {error && <span className="mono">NÃO FOI POSSÍVEL LISTAR OS ARQUIVOS.</span>}
        {arquivos?.length === 0 && !isLoading && (
          <span className="mono">NENHUM G-CODE ENCONTRADO NAS IMPRESSORAS DA FAZENDA.</span>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
          {arquivos?.map((a) => (
            <CardArquivo
              key={`${a.printerId}:${a.path}`}
              arquivo={a}
              podeEnfileirar={podeEnfileirar}
              enviando={enfileirar.isPending && enfileirar.variables === a.path}
              aoEnviar={() => enfileirar.mutate(a.path)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CardArquivo({
  arquivo,
  podeEnfileirar,
  enviando,
  aoEnviar
}: {
  arquivo: GcodeFile;
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
            alt={`Prévia de ${arquivo.nome}`}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        )}
        <span
          style={{
            position: 'absolute',
            left: 10,
            bottom: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            color: 'var(--color-neutral-300)',
            textShadow: '0 1px 3px rgba(0,0,0,.85)'
          }}
        >
          {arquivo.printerId}
        </span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <h3
          style={{
            fontSize: 15,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={arquivo.nome}
        >
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
              rotulo={
                podeEnfileirar ? `Enviar ${arquivo.nome} para a fila` : 'Enviar para a fila (sem permissão)'
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
