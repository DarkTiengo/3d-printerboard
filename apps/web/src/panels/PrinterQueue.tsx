import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu, Play, RotateCcw } from 'lucide-react';
import type { Printer, QueueJob } from '@3dfarm/shared';
import { api } from '../lib/api';
import { IconButton } from '../components/IconButton';
import { useT } from '../i18n';
import { usePrinters } from '../store/printers';

/**
 * A fila desta impressora, dentro do painel dela.
 *
 * Nada aqui começa sozinho. A fila mostra o que está esperando e quem autoriza
 * é a pessoa, com um clique — porque quando uma impressão termina a peça
 * continua na mesa, e a máquina não tem como saber se alguém já a tirou.
 */
export function PrinterQueue({ printer, podeControlar }: { printer: Printer; podeControlar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const filaGlobal = usePrinters((s) => s.fila);
  const [erro, definirErro] = useEstadoErro();

  // o SSE avisa quando a fila muda; a consulta traz a ordem já resolvida
  const { data: fila } = useQuery({
    queryKey: ['fila-impressora', printer.id, filaGlobal.length],
    queryFn: () => api.filaDaImpressora(printer.id),
    staleTime: 2_000
  });

  const iniciar = useMutation({
    mutationFn: (jobId: number) => api.iniciarJob(jobId, printer.id),
    onSuccess: () => {
      definirErro(null);
      void qc.invalidateQueries({ queryKey: ['fila'] });
      void qc.invalidateQueries({ queryKey: ['fila-impressora'] });
    },
    onError: (e) => definirErro(e instanceof Error ? e.message : t.impressora.falhaIniciar)
  });

  const podeComecar = podeControlar && printer.status === 'ociosa' && printer.online;
  const lista = fila ?? [];

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Menu size={13} strokeWidth={2} aria-hidden style={{ color: 'var(--color-neutral-400)' }} />
        <span className="mono">{t.impressora.fila}</span>
        <span className="mono" style={{ marginLeft: 'auto' }}>
          {lista.length}
        </span>
      </div>

      {lista.length === 0 ? (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-500)' }}>
          {t.impressora.filaVazia}
        </span>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map((job, i) => (
            <ItemDaFila
              key={job.id}
              job={job}
              /* só o primeiro pode começar: a máquina imprime uma peça por vez */
              proximo={i === 0}
              podeComecar={podeComecar}
              iniciando={iniciar.isPending && iniciar.variables === job.id}
              rotuloIniciar={
                podeComecar ? t.impressora.iniciar(job.arquivo) : t.impressora.iniciarOcupada
              }
              deOutraMaquina={job.destino === null ? t.impressora.daFazenda : null}
              aoIniciar={() => iniciar.mutate(job.id)}
            />
          ))}
        </ul>
      )}

      {erro && (
        <span role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-accent)' }}>
          {erro}
        </span>
      )}
    </section>
  );
}

function ItemDaFila({
  job,
  proximo,
  podeComecar,
  iniciando,
  rotuloIniciar,
  deOutraMaquina,
  aoIniciar
}: {
  job: QueueJob;
  proximo: boolean;
  podeComecar: boolean;
  iniciando: boolean;
  rotuloIniciar: string;
  deOutraMaquina: string | null;
  aoIniciar: () => void;
}) {
  const t = useT();
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 10px',
        // o próximo ganha destaque: é o único que o botão vai iniciar
        border: `1px solid ${proximo ? 'var(--color-neutral-700)' : 'var(--color-neutral-800)'}`,
        background: proximo ? 'var(--color-neutral-900)' : 'transparent'
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={job.arquivo}
        >
          {job.arquivo}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-500)' }}>
          {job.tempo}
          {deOutraMaquina && ` · ${deOutraMaquina}`}
          {proximo && ` · ${t.impressora.aguardandoAutorizacao}`}
        </div>
      </div>

      {proximo && (
        <IconButton
          rotulo={rotuloIniciar}
          variante="primaria"
          pequeno
          disabled={!podeComecar || iniciando}
          onClick={aoIniciar}
          icone={<Play size={15} strokeWidth={2} aria-hidden />}
        />
      )}
    </li>
  );
}

/**
 * Oferta de reimpressão.
 *
 * Só aparece quando a peça anterior saiu inteira — depois de um cancelamento
 * ou de um erro, repetir a mesma coisa às cegas seria só desperdiçar filamento.
 */
export function OfertaDeReimpressao({ printer, podeControlar }: { printer: Printer; podeControlar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [erro, definirErro] = useEstadoErro();

  const reimprimir = useMutation({
    mutationFn: () => api.reimprimir(printer.id),
    onSuccess: () => {
      definirErro(null);
      void qc.invalidateQueries({ queryKey: ['fila'] });
    },
    onError: (e) => definirErro(e instanceof Error ? e.message : t.impressora.falhaIniciar)
  });

  if (!printer.concluiuComSucesso || printer.status !== 'ociosa') return null;

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono">{t.impressora.concluida}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={printer.job}
          >
            {printer.job}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-500)' }}>
            {t.impressora.retirarPeca}
          </div>
        </div>

        <IconButton
          rotulo={t.impressora.reimprimir(printer.job)}
          variante="secundaria"
          pequeno
          disabled={!podeControlar || reimprimir.isPending}
          onClick={() => reimprimir.mutate()}
          icone={<RotateCcw size={15} strokeWidth={2} aria-hidden />}
        />
      </div>

      {erro && (
        <span role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-accent)' }}>
          {erro}
        </span>
      )}
    </section>
  );
}

/** Erro local e efêmero — não vale poluir o store por isso. */
function useEstadoErro(): [string | null, (v: string | null) => void] {
  const [erro, setErro] = useState<string | null>(null);
  return [erro, setErro];
}
