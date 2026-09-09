import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, ShieldAlert } from 'lucide-react';
import type { DeteccaoPadroes, DeteccaoPrefs, EstadoModelo, PrinterConfig } from '@gridfarm/shared';
import { ACOES_DETECCAO } from '@gridfarm/shared';
import { api } from '../lib/api';
import { CORES_SEVERIDADE } from '../lib/status';
import { Ponto } from '../components/Tag';
import { useT } from '../i18n';
import type { Dicionario } from '../i18n/pt';

/**
 * Detecção de falha pela câmera — o card na tela de gestão e o diálogo que o
 * edita.
 *
 * Segue o molde do card de notificações ao lado: mesma moldura, mesmo diálogo
 * de raio 10, mesmas pílulas no rodapé. A diferença é que aqui a configuração é
 * por máquina, então o corpo do diálogo é uma linha por impressora — e as que
 * não têm câmera aparecem esmaecidas com o motivo escrito, em vez de sumirem:
 * quem procura a impressora na lista precisa achá-la e entender por que ela não
 * pode ser vigiada.
 */

type Linha = { printer: PrinterConfig; prefs: DeteccaoPrefs };

/** Uma volta ao servidor por máquina, só quando a tela abre. */
async function carregar(): Promise<{ linhas: Linha[]; padroes: DeteccaoPadroes; modelo: EstadoModelo }> {
  const [printers, { modelo, padroes }] = await Promise.all([api.configPrinters(), api.modeloDeteccao()]);
  const linhas = await Promise.all(
    printers.map(async (printer) => ({ printer, prefs: (await api.deteccao(printer.id)).prefs }))
  );
  return { linhas, padroes, modelo };
}

export function DeteccaoCard() {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['deteccao'], queryFn: carregar });

  const vigiadas = data?.linhas.filter((l) => l.prefs.ligado).length ?? 0;
  const disponivel = data?.padroes.disponivel ?? false;
  const ativo = disponivel && vigiadas > 0 && data?.modelo.estado === 'pronto';

  return (
    <section style={{ marginTop: 28 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingBottom: 12,
          borderBottom: '2px solid var(--color-neutral-700)'
        }}
      >
        <span className="mono">{t.deteccao.titulo}</span>
        {aviso && (
          <span
            role="status"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-accent-400)' }}
          >
            {aviso}
          </span>
        )}
      </div>

      <article
        style={{
          border: '2px solid var(--color-neutral-700)',
          borderTop: 0,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxWidth: 520
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Ponto cor={ativo ? CORES_SEVERIDADE.alta : 'var(--color-neutral-600)'} tamanho={8} />
          <h3 style={{ fontSize: 17 }}>{t.deteccao.subtitulo}</h3>
          <span className="mono" style={{ marginLeft: 'auto' }}>
            {vigiadas > 0 ? t.deteccao.vigiando(vigiadas) : t.deteccao.nenhuma}
          </span>
        </div>

        {isLoading ? (
          <span className="mono">{t.comum.carregando}</span>
        ) : !disponivel ? (
          <div style={{ ...dica, color: 'var(--color-accent-400)' }}>{t.deteccao.indisponivel}</div>
        ) : (
          <>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-400)' }}>
              {t.deteccao.modelo}: {data && descreverModelo(t, data.modelo)}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-500)' }}>
              {data && t.deteccao.comoFunciona(data.padroes.confirmacoes, data.padroes.intervaloS)}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={() => setAberto(true)} disabled={!disponivel} style={botaoSecundario}>
            {t.comum.editar}
          </button>
        </div>
      </article>

      {aberto && data && (
        <Dialogo
          t={t}
          inicial={data}
          aoFechar={() => setAberto(false)}
          aoConcluir={(msg) => {
            setAberto(false);
            setAviso(msg);
          }}
        />
      )}
    </section>
  );
}

function descreverModelo(t: Dicionario, m: EstadoModelo): string {
  if (m.estado === 'baixando') return t.deteccao.modeloBaixando;
  if (m.estado === 'pronto') return t.deteccao.modeloPronto((m.bytes / 1048576).toFixed(1));
  if (m.estado === 'erro') return t.deteccao.modeloErro(m.erro ?? '');
  return t.deteccao.modeloAusente;
}

function Dialogo({
  t,
  inicial,
  aoFechar,
  aoConcluir
}: {
  t: Dicionario;
  inicial: { linhas: Linha[]; padroes: DeteccaoPadroes; modelo: EstadoModelo };
  aoFechar: () => void;
  aoConcluir: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [linhas, setLinhas] = useState(inicial.linhas);
  const [modelo, setModelo] = useState(inicial.modelo);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  const baixar = useMutation({
    mutationFn: api.baixarModeloDeteccao,
    onSuccess: (r) => setModelo(r.modelo)
  });

  /*
   * Salva só o que mudou. São até algumas dezenas de máquinas e uma volta por
   * uma, mas mandar a lista inteira faria o servidor reescrever preferências
   * que ninguém tocou — e o log de "detecção alterada" mentiria sobre elas.
   */
  const salvar = useMutation({
    mutationFn: async () => {
      const mudadas = linhas.filter((l, i) => !mesmasPrefs(l.prefs, inicial.linhas[i].prefs));
      for (const l of mudadas) {
        await api.salvarDeteccao(l.printer.id, {
          ligado: l.prefs.ligado,
          limiar: l.prefs.limiar,
          acao: l.prefs.acao
        });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deteccao'] });
      aoConcluir(t.deteccao.salvo);
    },
    onError: (err) => aoConcluir(err instanceof Error ? err.message : t.deteccao.falhaSalvar)
  });

  const mudar = (id: string, patch: Partial<DeteccaoPrefs>) =>
    setLinhas((atual) => atual.map((l) => (l.printer.id === id ? { ...l, prefs: { ...l.prefs, ...patch } } : l)));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.deteccao.configurar}
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
      style={fundoModal}
    >
      <div style={caixaModal}>
        <div>
          <div className="mono">{t.deteccao.titulo}</div>
          <h2 style={{ fontSize: 24, marginTop: 8 }}>{t.deteccao.subtitulo}</h2>
        </div>

        {/* o modelo primeiro: sem ele nada do resto funciona */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono">{t.deteccao.modelo}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-400)' }}>
              {descreverModelo(t, modelo)}
            </span>
            {modelo.estado !== 'pronto' && modelo.podeBaixar && (
              <button
                type="button"
                onClick={() => baixar.mutate()}
                disabled={baixar.isPending}
                style={{
                  ...botaoSecundario,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 16px',
                  fontSize: 12,
                  cursor: baixar.isPending ? 'progress' : 'pointer'
                }}
              >
                <Download size={14} strokeWidth={2} aria-hidden style={{ flex: 'none' }} />
                {baixar.isPending ? t.deteccao.baixando : t.deteccao.baixar}
              </button>
            )}
          </div>
          {!modelo.podeBaixar && modelo.estado !== 'pronto' && <span style={dica}>{t.deteccao.semUrl}</span>}
        </div>

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <legend className="mono" style={{ padding: 0, marginBottom: 4 }}>
            {t.deteccao.quais}
          </legend>

          {linhas.map(({ printer, prefs }) => {
            const temCamera = !!printer.cameraUrl;
            return (
              <div
                key={printer.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  paddingBottom: 12,
                  borderBottom: '1px solid var(--color-neutral-800)',
                  opacity: temCamera ? 1 : 0.5
                }}
              >
                <label style={{ ...linhaCheck, cursor: temCamera ? 'pointer' : 'default' }}>
                  <input
                    type="checkbox"
                    checked={prefs.ligado}
                    disabled={!temCamera}
                    onChange={(e) => mudar(printer.id, { ligado: e.target.checked })}
                  />
                  <Eye size={13} strokeWidth={2} aria-hidden style={{ flex: 'none' }} />
                  {printer.id} · {printer.nome}
                </label>

                {!temCamera ? (
                  <span style={{ ...dica, paddingLeft: 26 }}>{t.deteccao.semCamera}</span>
                ) : (
                  prefs.ligado && (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingLeft: 26 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span className="mono" style={{ fontSize: 10 }}>
                          {t.deteccao.acao}
                        </span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {ACOES_DETECCAO.map((a) => (
                            <button
                              key={a}
                              type="button"
                              onClick={() => mudar(printer.id, { acao: a })}
                              style={pilula((prefs.acao ?? inicial.padroes.acao) === a)}
                            >
                              {t.deteccao.acoes[a]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span className="mono" style={{ fontSize: 10 }}>
                          {t.deteccao.limiar}
                        </span>
                        <input
                          type="number"
                          min={0.1}
                          max={0.95}
                          step={0.05}
                          value={prefs.limiar ?? ''}
                          placeholder={String(inicial.padroes.limiar)}
                          onChange={(e) =>
                            mudar(printer.id, { limiar: e.target.value === '' ? null : Number(e.target.value) })
                          }
                          style={{ ...campo, width: 96, padding: '8px 10px', fontSize: 12 }}
                        />
                      </label>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </fieldset>

        <span style={dica}>{t.deteccao.limiarDica}</span>

        <p style={{ ...dica, margin: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <ShieldAlert size={12} strokeWidth={2} aria-hidden style={{ flex: 'none', marginTop: 3 }} />
          {t.deteccao.limites}
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={aoFechar} style={botaoSecundario}>
            {t.comum.cancelar}
          </button>
          <button
            type="button"
            disabled={salvar.isPending}
            onClick={() => salvar.mutate()}
            style={{ ...botaoPrimario, opacity: salvar.isPending ? 0.5 : 1 }}
          >
            {salvar.isPending ? t.deteccao.salvando : t.deteccao.salvar}
          </button>
        </div>
      </div>
    </div>
  );
}

function mesmasPrefs(a: DeteccaoPrefs, b: DeteccaoPrefs): boolean {
  return a.ligado === b.ligado && a.limiar === b.limiar && a.acao === b.acao;
}

// ── estilos, iguais aos de NotificacoesCard.tsx ──────────────────────────────

const fundoModal: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 70,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: 'rgba(20, 19, 18, 0.72)'
};

const caixaModal: React.CSSProperties = {
  width: 'min(560px, 100%)',
  maxHeight: 'calc(100vh - 48px)',
  overflow: 'auto',
  background: 'var(--color-text)',
  border: '2px solid var(--color-neutral-700)',
  padding: 28,
  display: 'flex',
  flexDirection: 'column',
  gap: 18
};

const campo: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-neutral-700)',
  borderRadius: 10,
  color: 'var(--color-bg)',
  fontFamily: 'var(--font-mono)',
  fontSize: 14,
  padding: '13px 14px'
};

const dica: React.CSSProperties = { fontSize: 11, color: 'var(--color-neutral-500)', textWrap: 'pretty' };

const linhaCheck: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--color-neutral-300)',
  cursor: 'pointer'
};

const botaoSecundario: React.CSSProperties = {
  border: '1px solid var(--color-neutral-700)',
  background: 'transparent',
  color: 'var(--color-bg)',
  borderRadius: 999,
  padding: '11px 20px',
  fontFamily: 'var(--font-heading)',
  fontWeight: 800,
  fontSize: 13,
  cursor: 'pointer'
};

const botaoPrimario: React.CSSProperties = {
  ...botaoSecundario,
  border: 0,
  background: 'var(--color-accent)',
  color: 'var(--color-bg)'
};

function pilula(ativa: boolean): React.CSSProperties {
  return {
    ...botaoSecundario,
    padding: '7px 14px',
    fontSize: 11,
    background: ativa ? 'var(--color-accent)' : 'transparent',
    border: ativa ? 0 : '1px solid var(--color-neutral-700)'
  };
}
