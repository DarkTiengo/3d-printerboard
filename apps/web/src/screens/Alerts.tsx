import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Video } from 'lucide-react';
import type { Alert, User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { api } from '../lib/api';
import { usePrinters } from '../store/printers';
import { useUi } from '../store/ui';
import { IconButton } from '../components/IconButton';
import { Ponto } from '../components/Tag';
import { CORES_SEVERIDADE } from '../lib/status';
import { useT } from '../i18n';
import { useFormato } from '../i18n/formato';
import type { Dicionario } from '../i18n/pt';

/**
 * Alertas — design/README.md § 6.
 * Lista de 420px à esquerda, detalhe com frame do momento à direita.
 */
/** Título traduzido pelo código; cai no texto do servidor se o código for novo. */
function tituloDoAlerta(a: Alert, t: Dicionario): string {
  return t.alertas.titulos[a.codigo] ?? a.titulo;
}

export function Alerts({ usuario }: { usuario: User }) {
  const t = useT();
  const f = useFormato();
  const alertas = usePrinters((s) => s.alertas);
  const definirAlertas = usePrinters((s) => s.definirAlertas);
  const alertaSel = useUi((s) => s.alertaSel);
  const abrirAlerta = useUi((s) => s.abrirAlerta);
  const abrirImpressora = useUi((s) => s.abrirImpressora);

  const { data, isLoading } = useQuery({ queryKey: ['alertas'], queryFn: api.alertas });

  useEffect(() => {
    if (data) definirAlertas(data);
  }, [data, definirAlertas]);

  // seleção default: o alerta mais recente
  useEffect(() => {
    if (alertaSel == null && alertas.length > 0) abrirAlerta(alertas[0].id);
  }, [alertaSel, alertas, abrirAlerta]);

  const resolver = useMutation({
    mutationFn: (id: number) => api.resolverAlerta(id),
    onSuccess: (a) => definirAlertas(alertas.filter((x) => x.id !== a.id))
  });

  const selecionado = alertas.find((a) => a.id === alertaSel) ?? alertas[0] ?? null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div
        style={{
          width: 'var(--lista-alertas)',
          flex: 'none',
          borderRight: '2px solid var(--color-neutral-700)',
          overflow: 'auto'
        }}
      >
        {isLoading && alertas.length === 0 && (
          <div style={{ padding: 18 }}>
            <span className="mono">{t.alertas.carregando}</span>
          </div>
        )}
        {!isLoading && alertas.length === 0 && (
          <div style={{ padding: 18 }}>
            <span className="mono">{t.alertas.nenhum}</span>
          </div>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {alertas.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => abrirAlerta(a.id)}
                aria-current={a.id === selecionado?.id ? 'true' : undefined}
                style={{
                  display: 'flex',
                  gap: 12,
                  width: '100%',
                  padding: '15px 18px',
                  borderBottom: '1px solid var(--color-neutral-800)',
                  borderLeft: 0,
                  borderRight: 0,
                  borderTop: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: a.id === selecionado?.id ? 'var(--color-neutral-900)' : 'transparent'
                }}
              >
                <span style={{ paddingTop: 5 }}>
                  <Ponto cor={CORES_SEVERIDADE[a.sev]} tamanho={8} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: 'var(--font-heading)',
                      fontWeight: 800,
                      fontSize: 13,
                      textWrap: 'pretty'
                    }}
                  >
                    {tituloDoAlerta(a, t)}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--color-neutral-400)',
                      marginTop: 2
                    }}
                  >
                    {f.quando(a.criadoEm)} · {a.impressora}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 28 }}>
        {selecionado ? (
          <Detalhe
            t={t}
            f={f}
            alerta={selecionado}
            podeResolver={pode(usuario.role, 'resolverAlerta')}
            resolvendo={resolver.isPending}
            aoResolver={() => resolver.mutate(selecionado.id)}
            aoAbrirImpressora={() => selecionado.printerId && abrirImpressora(selecionado.printerId)}
          />
        ) : (
          <span className="mono">{t.alertas.selecione}</span>
        )}
      </div>
    </div>
  );
}

function Detalhe({
  t,
  f,
  alerta,
  podeResolver,
  resolvendo,
  aoResolver,
  aoAbrirImpressora
}: {
  t: Dicionario;
  f: ReturnType<typeof useFormato>;
  alerta: Alert;
  podeResolver: boolean;
  resolvendo: boolean;
  aoResolver: () => void;
  aoAbrirImpressora: () => void;
}) {
  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
      <div className="mono">
        {f.quando(alerta.criadoEm)} · {alerta.impressora} · {t.alertas.severidade(t.alertas.sevNomes[alerta.sev])}
      </div>

      <h2 style={{ fontSize: 28, letterSpacing: '-0.01em', textWrap: 'pretty' }}>{tituloDoAlerta(alerta, t)}</h2>

      <p style={{ fontSize: 14, color: 'var(--color-neutral-300)', maxWidth: 520, textWrap: 'pretty', margin: 0 }}>
        {alerta.detalhe}
      </p>

      <figure
        className={alerta.frameUrl ? undefined : 'listrado'}
        style={{
          margin: 0,
          position: 'relative',
          aspectRatio: '16 / 9',
          maxWidth: 640,
          background: 'var(--color-neutral-900)'
        }}
      >
        {alerta.frameUrl && (
          <img
            src={alerta.frameUrl}
            alt={t.alertas.frameDe(alerta.impressora)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        <figcaption
          style={{
            position: 'absolute',
            left: 12,
            bottom: 10,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            color: 'var(--color-neutral-300)',
            textShadow: '0 1px 3px rgba(0,0,0,.85)'
          }}
        >
          {alerta.frame || t.alertas.semImagem}
        </figcaption>
      </figure>

      <div style={{ display: 'flex', gap: 10 }}>
        <IconButton
          rotulo={podeResolver ? t.alertas.resolver : t.alertas.resolverSemPermissao}
          variante="primaria"
          disabled={!podeResolver || resolvendo}
          onClick={aoResolver}
          icone={<Check size={17} strokeWidth={2} aria-hidden />}
        />
        <IconButton
          rotulo={t.alertas.abrirImpressora}
          variante="secundaria"
          disabled={!alerta.printerId}
          onClick={aoAbrirImpressora}
          icone={<Video size={16} strokeWidth={2} aria-hidden />}
        />
      </div>
    </article>
  );
}
