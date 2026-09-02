import { Menu, X } from 'lucide-react';
import type { User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { usePrinters, usePrintersVisiveis } from '../store/printers';
import { useT } from '../i18n';
import { IconButton } from '../components/IconButton';
import { api } from '../lib/api';

/**
 * Fila — o que a coluna direita mostra quando nenhuma impressora está
 * selecionada (design/README.md § 2, "Sem seleção").
 */
export function QueuePanel({ usuario }: { usuario: User }) {
  const t = useT();
  const fila = usePrinters((s) => s.fila);
  const printers = usePrintersVisiveis();
  const definirFila = usePrinters((s) => s.definirFila);

  // o rótulo do destino é montado aqui: o servidor não sabe o idioma da tela
  const nomeDoDestino = (id: string | null) =>
    id ? (printers.find((p) => p.id === id)?.nome ?? id) : t.fila.proximaLivre;
  const podeMexer = pode(usuario.role, 'enfileirar');

  async function cancelar(id: number) {
    try {
      await api.cancelarJob(id);
      definirFila(fila.filter((j) => j.id !== id));
    } catch {
      /* o SSE traz a verdade no próximo evento */
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 18px 14px' }}>
        <Menu size={15} strokeWidth={2} aria-hidden style={{ color: 'var(--color-neutral-400)' }} />
        <span className="mono">{t.fila.titulo(fila.length)}</span>
      </header>

      {fila.length === 0 ? (
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--color-neutral-500)',
            padding: '0 18px',
            lineHeight: 1.8,
            margin: 0
          }}
        >
          {t.fila.vazia}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {fila.map((job) => (
            <li
              key={job.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '13px 18px',
                borderTop: '1px solid var(--color-neutral-800)'
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 800,
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={job.arquivo}
                >
                  {job.arquivo}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-400)' }}>
                  {nomeDoDestino(job.destino)} · {job.tempo}
                  {job.status !== 'pendente' && ` · ${t.fila.estados[job.status]}`}
                </div>
                {job.erro && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-accent-400)' }}>
                    {job.erro}
                  </div>
                )}
              </div>
              {podeMexer && (job.status === 'pendente' || job.status === 'atribuido') && (
                <IconButton
                  rotulo={t.fila.tirarDaFila(job.arquivo)}
                  variante="secundaria"
                  pequeno
                  onClick={() => void cancelar(job.id)}
                  icone={<X size={14} strokeWidth={2} aria-hidden />}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-neutral-500)',
          padding: '18px',
          marginTop: 'auto',
          lineHeight: 1.8
        }}
      >
        {t.fila.dica}
      </p>
    </div>
  );
}
