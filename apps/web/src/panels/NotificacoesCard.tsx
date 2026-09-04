import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Send, X } from 'lucide-react';
import type { NotificacaoPrefs, Severidade } from '@3dfarm/shared';
import { CODIGOS_DE_ALERTA, SEGREDO_MASCARADO } from '@3dfarm/shared';
import { api } from '../lib/api';
import { CORES_SEVERIDADE } from '../lib/status';
import { Ponto } from '../components/Tag';
import { useT } from '../i18n';
import { useFormato } from '../i18n/formato';
import type { Dicionario } from '../i18n/pt';

/**
 * Notificações por Telegram — o card na tela de gestão e o diálogo que o edita.
 *
 * Mora fora de Settings.tsx porque aquela tela já é grande, e segue o molde do
 * diálogo de configuração de backup: fieldset por grupo, campos de raio 10 e
 * rodapé em pílulas.
 */

const ORDEM_SEV: Severidade[] = ['critica', 'alta', 'media', 'baixa'];

export function NotificacoesCard() {
  const t = useT();
  const f = useFormato();
  const [aberto, setAberto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['notificacoes'], queryFn: api.notificacoes });

  const ligado = !!data?.prefs.ligado && !!data?.tokenDefinido;
  const estado = data?.estado;

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
        <span className="mono">{t.notificacoes.titulo}</span>
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
          <Ponto cor={ligado ? CORES_SEVERIDADE.alta : 'var(--color-neutral-600)'} tamanho={8} />
          <h3 style={{ fontSize: 17 }}>{t.notificacoes.subtitulo}</h3>
          <span className="mono" style={{ marginLeft: 'auto' }}>
            {ligado ? t.notificacoes.ligadas : t.notificacoes.desligadas}
          </span>
        </div>

        {isLoading ? (
          <span className="mono">{t.comum.carregando}</span>
        ) : (
          <>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-400)' }}>
              {data?.tokenDefinido
                ? data.prefs.chatId
                  ? t.notificacoes.paraChat(data.prefs.chatId)
                  : t.notificacoes.semToken
                : t.notificacoes.semToken}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-500)' }}>
              {estado?.ultimoEnvioEm
                ? t.notificacoes.ultimoEnvio(f.quando(estado.ultimoEnvioEm))
                : t.notificacoes.nenhumEnvio}
            </div>
            {/* a falha fica visível até um envio dar certo: um token errado de
                madrugada precisa continuar contando a história de manhã */}
            {estado?.ultimoErro && (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--color-accent-400)',
                  borderLeft: '2px solid var(--color-accent)',
                  paddingLeft: 10,
                  overflowWrap: 'anywhere'
                }}
              >
                {t.notificacoes.ultimaFalha(estado.ultimoErro)}
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={() => setAberto(true)} style={botaoSecundario}>
            {t.comum.editar}
          </button>
        </div>
      </article>

      {aberto && data && (
        <Dialogo
          t={t}
          inicial={data.prefs}
          tokenDefinido={data.tokenDefinido}
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

function Dialogo({
  t,
  inicial,
  tokenDefinido,
  aoFechar,
  aoConcluir
}: {
  t: Dicionario;
  inicial: NotificacaoPrefs;
  tokenDefinido: boolean;
  aoFechar: () => void;
  aoConcluir: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [ligado, setLigado] = useState(inicial.ligado);
  const [chatId, setChatId] = useState(inicial.chatId);
  const [codigos, setCodigos] = useState<string[]>(inicial.codigos);
  const [avisarResolucao, setAvisarResolucao] = useState(inicial.avisarResolucao);
  const [responderComandos, setResponderComandos] = useState(inicial.responderComandos);
  /* vazio quer dizer "mantém o que está guardado", não "apaga o token" — mesma
     sentinela que a chave do Moonraker usa */
  const [token, setToken] = useState('');
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarNotificacoes({
        ligado,
        chatId,
        codigos,
        avisarResolucao,
        responderComandos,
        token: token.trim() || SEGREDO_MASCARADO
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notificacoes'] });
      aoConcluir(t.notificacoes.salvo);
    },
    onError: (err) => aoConcluir(err instanceof Error ? err.message : t.notificacoes.falhaSalvar)
  });

  const testar = useMutation({
    mutationFn: () => api.testarNotificacoes({ token: token.trim() || SEGREDO_MASCARADO, chatId }),
    // a rota responde 200 com { ok, erro }: a recusa do Telegram aparece aqui
    // do lado do botão, e não sumindo num catch
    onSuccess: (r) => setTeste({ ok: r.ok, texto: r.ok ? t.notificacoes.testeOk : (r.erro ?? '') }),
    onError: (err) => setTeste({ ok: false, texto: err instanceof Error ? err.message : '' })
  });

  const alternar = (codigo: string) =>
    setCodigos((atual) => (atual.includes(codigo) ? atual.filter((c) => c !== codigo) : [...atual, codigo]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.notificacoes.configurar}
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
      style={fundoModal}
    >
      <div style={caixaModal}>
        <div>
          <div className="mono">{t.notificacoes.titulo}</div>
          <h2 style={{ fontSize: 24, marginTop: 8 }}>{t.notificacoes.subtitulo}</h2>
        </div>

        <label style={linhaCheck}>
          <input type="checkbox" checked={ligado} onChange={(e) => setLigado(e.target.checked)} />
          {t.notificacoes.ligar}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono">{t.notificacoes.token}</span>
          <input
            type="password"
            value={token}
            autoComplete="off"
            placeholder={tokenDefinido ? SEGREDO_MASCARADO : ''}
            onChange={(e) => setToken(e.target.value)}
            style={campo}
          />
          <span style={dica}>
            {tokenDefinido ? `${t.notificacoes.tokenGuardado} · ${t.notificacoes.tokenDica}` : t.notificacoes.tokenDica}
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono">{t.notificacoes.chat}</span>
          <input value={chatId} onChange={(e) => setChatId(e.target.value)} style={campo} />
          <span style={dica}>{t.notificacoes.chatDica}</span>
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => testar.mutate()}
            disabled={testar.isPending || !chatId.trim()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid var(--color-neutral-700)',
              background: 'transparent',
              color: testar.isPending ? 'var(--color-neutral-500)' : 'var(--color-bg)',
              borderRadius: 999,
              padding: '9px 16px',
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 12,
              whiteSpace: 'nowrap',
              flex: 'none',
              cursor: testar.isPending ? 'progress' : 'pointer'
            }}
          >
            <Send size={14} strokeWidth={2} aria-hidden style={{ flex: 'none' }} />
            {testar.isPending ? t.notificacoes.testando : t.notificacoes.testar}
          </button>
          {teste && (
            <span
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: teste.ok ? 'var(--color-accent-400)' : 'var(--color-accent)',
                overflowWrap: 'anywhere'
              }}
            >
              {teste.ok ? (
                <Check size={13} strokeWidth={3} aria-hidden />
              ) : (
                <X size={13} strokeWidth={3} aria-hidden />
              )}
              {teste.texto}
            </span>
          )}
        </div>

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="mono" style={{ padding: 0, marginBottom: 4 }}>
            {t.notificacoes.quais}
          </legend>
          {ORDEM_SEV.map((sev) => {
            const doGrupo = CODIGOS_DE_ALERTA.filter((c) => c.sev === sev);
            if (doGrupo.length === 0) return null;
            return (
              <div key={sev} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {doGrupo.map(({ codigo }) => (
                  <label key={codigo} style={linhaCheck}>
                    <input
                      type="checkbox"
                      checked={codigos.includes(codigo)}
                      onChange={() => alternar(codigo)}
                    />
                    <Ponto cor={CORES_SEVERIDADE[sev]} tamanho={7} />
                    {t.alertas.titulos[codigo] ?? codigo}
                  </label>
                ))}
              </div>
            );
          })}
        </fieldset>

        <label style={linhaCheck}>
          <input
            type="checkbox"
            checked={avisarResolucao}
            onChange={(e) => setAvisarResolucao(e.target.checked)}
          />
          {t.notificacoes.resolucao}
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={linhaCheck}>
            <input
              type="checkbox"
              checked={responderComandos}
              onChange={(e) => setResponderComandos(e.target.checked)}
            />
            {t.notificacoes.comandos}
          </label>
          <span style={{ ...dica, paddingLeft: 26 }}>{t.notificacoes.comandosDica}</span>
        </div>

        <p style={{ ...dica, margin: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Bell size={12} strokeWidth={2} aria-hidden style={{ flex: 'none', marginTop: 3 }} />
          {t.notificacoes.idioma}
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
            {salvar.isPending ? t.notificacoes.salvando : t.notificacoes.salvar}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── estilos, iguais aos de Settings.tsx e Backups.tsx ────────────────────────

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
