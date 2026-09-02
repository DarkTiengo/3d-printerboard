import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plug, Plus, Trash2, X } from 'lucide-react';
import type { PrinterConfig } from '@3dfarm/shared';
import { api } from '../lib/api';
import { IconButton } from '../components/IconButton';
import { Confirm } from '../components/Confirm';
import { useT } from '../i18n';
import type { Dicionario } from '../i18n/pt';

type Rascunho = {
  id?: string;
  nome: string;
  moonrakerUrl: string;
  apiKey: string;
  cameraUrl: string;
  backupEnabled: boolean;
};

const VAZIO: Rascunho = {
  nome: '',
  moonrakerUrl: 'http://',
  apiKey: '',
  cameraUrl: '',
  backupEnabled: true
};

/**
 * Gestão de impressoras.
 *
 * Não está nas seis telas do design — o handoff presume a fazenda já cadastrada.
 * Segue os mesmos tokens e formatos: card de borda 2px, campos com raio 10px,
 * botões em pílula.
 */
export function Settings() {
  const t = useT();
  const qc = useQueryClient();
  const { data: printers, isLoading } = useQuery({ queryKey: ['configPrinters'], queryFn: api.configPrinters });

  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [removendo, setRemovendo] = useState<PrinterConfig | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['configPrinters'] });
    void qc.invalidateQueries({ queryKey: ['backups'] });
  };

  const salvar = useMutation({
    mutationFn: (r: Rascunho) => {
      const corpo = {
        nome: r.nome.trim(),
        moonrakerUrl: r.moonrakerUrl.trim(),
        apiKey: r.apiKey.trim() || null,
        cameraUrl: r.cameraUrl.trim() || null,
        backupEnabled: r.backupEnabled
      };
      return r.id ? api.atualizarPrinter(r.id, corpo) : api.criarPrinter(corpo);
    },
    onSuccess: () => {
      setEditando(null);
      setErro(null);
      invalidar();
    },
    onError: (e) => setErro(e instanceof Error ? e.message : t.gestao.naoSalvou)
  });

  const remover = useMutation({
    mutationFn: (id: string) => api.removerPrinter(id),
    onSuccess: () => {
      setRemovendo(null);
      invalidar();
    }
  });

  const testar = useMutation({
    mutationFn: (r: Rascunho) =>
      api.testarPrinter({
        id: r.id,
        nome: r.nome || 'teste',
        moonrakerUrl: r.moonrakerUrl,
        apiKey: r.apiKey || null,
        cameraUrl: r.cameraUrl || null,
        backupEnabled: r.backupEnabled
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setTeste({ ok: false, texto: t.gestao.testeFalhou(res.erro ?? '') });
        return;
      }
      // a câmera é opcional: se ela falhar, a impressora ainda está conectada
      const extra = !res.camera
        ? ''
        : res.camera.ok
          ? t.gestao.testeCameraOk
          : t.gestao.testeCameraFalhou(res.camera.erro ?? '');
      setTeste({
        ok: res.camera ? res.camera.ok : true,
        texto: t.gestao.testeOk(res.hostname ?? '?', res.versao ?? '?') + extra
      });
    },
    onError: (e) => setTeste({ ok: false, texto: e instanceof Error ? e.message : t.gestao.testeErro })
  });

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '16px 22px',
          borderBottom: '2px solid var(--color-neutral-700)'
        }}
      >
        <span className="mono">{t.gestao.titulo(printers?.length ?? 0)}</span>
        <span style={{ marginLeft: 'auto' }}>
          <IconButton
            rotulo={t.gestao.nova}
            variante="primaria"
            onClick={() => {
              setEditando({ ...VAZIO });
              setTeste(null);
              setErro(null);
            }}
            icone={<Plus size={18} strokeWidth={2} aria-hidden />}
          />
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 22 }}>
        {isLoading && <span className="mono">{t.comum.carregando}</span>}
        {printers?.length === 0 && !isLoading && (
          <p style={{ color: 'var(--color-neutral-300)', maxWidth: 480, textWrap: 'pretty' }}>
            {t.gestao.vazio}{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>{t.gestao.urlPlaceholder}</code>.
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
          {printers?.map((p) => (
            <article
              key={p.id}
              style={{
                border: '2px solid var(--color-neutral-700)',
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h3 style={{ fontSize: 17 }}>{p.nome}</h3>
                <span className="mono" style={{ marginLeft: 'auto' }}>
                  {p.id}
                </span>
              </div>

              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-400)', overflowWrap: 'anywhere' }}>
                {p.moonrakerUrl}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-500)', overflowWrap: 'anywhere' }}>
                {t.gestao.camera} {p.cameraUrl ?? t.gestao.semCamera}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-500)' }}>
                {t.gestao.backup} {p.backupEnabled ? t.gestao.backupLigado : t.gestao.backupDesligado} ·{' '}
                {t.gestao.chave} {p.apiKey ? t.gestao.chaveDefinida : t.gestao.chaveNenhuma}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    setEditando({
                      id: p.id,
                      nome: p.nome,
                      moonrakerUrl: p.moonrakerUrl,
                      apiKey: p.apiKey ?? '',
                      cameraUrl: p.cameraUrl ?? '',
                      backupEnabled: p.backupEnabled
                    });
                    setTeste(null);
                    setErro(null);
                  }}
                  style={botaoSecundario}
                >
                  {t.comum.editar}
                </button>
                <IconButton
                  rotulo={t.gestao.remover(p.nome)}
                  variante="secundaria"
                  pequeno
                  onClick={() => setRemovendo(p)}
                  icone={<Trash2 size={15} strokeWidth={2} aria-hidden />}
                />
              </div>
            </article>
          ))}
        </div>
      </div>

      {editando && (
        <Formulario
          t={t}
          rascunho={editando}
          erro={erro}
          teste={teste}
          salvando={salvar.isPending}
          testando={testar.isPending}
          aoMudar={setEditando}
          aoTestar={() => testar.mutate(editando)}
          aoSalvar={() => salvar.mutate(editando)}
          aoFechar={() => {
            setEditando(null);
            setTeste(null);
            setErro(null);
          }}
        />
      )}

      <Confirm
        aberto={!!removendo}
        titulo={t.gestao.removerTitulo}
        descricao={t.gestao.removerTexto(removendo?.nome ?? '')}
        rotuloConfirmar={t.gestao.removerTitulo}
        onConfirmar={() => removendo && remover.mutate(removendo.id)}
        onCancelar={() => setRemovendo(null)}
      />
    </div>
  );
}

function Formulario({
  t,
  rascunho,
  erro,
  teste,
  salvando,
  testando,
  aoMudar,
  aoTestar,
  aoSalvar,
  aoFechar
}: {
  t: Dicionario;
  rascunho: Rascunho;
  erro: string | null;
  teste: { ok: boolean; texto: string } | null;
  salvando: boolean;
  testando: boolean;
  aoMudar: (r: Rascunho) => void;
  aoTestar: () => void;
  aoSalvar: () => void;
  aoFechar: () => void;
}) {
  const campo = (
    rotulo: string,
    chave: 'nome' | 'moonrakerUrl' | 'apiKey' | 'cameraUrl',
    props: { placeholder?: string; mono?: boolean; type?: string; dica?: string } = {}
  ) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="mono">{rotulo}</span>
      <input
        value={rascunho[chave]}
        type={props.type ?? 'text'}
        onChange={(e) => aoMudar({ ...rascunho, [chave]: e.target.value })}
        placeholder={props.placeholder}
        spellCheck={false}
        style={{
          background: 'transparent',
          border: '1px solid var(--color-neutral-700)',
          borderRadius: 10,
          color: 'var(--color-bg)',
          fontFamily: props.mono ? 'var(--font-mono)' : 'var(--font-body)',
          fontSize: props.mono ? 14 : 15,
          padding: '13px 14px'
        }}
      />
      {props.dica && (
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{props.dica}</span>
      )}
    </label>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={rascunho.id ? `${t.comum.editar} ${rascunho.nome}` : t.gestao.cadastrar}
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(20, 19, 18, 0.72)',
        overflow: 'auto'
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          aoSalvar();
        }}
        style={{
          width: 'min(560px, 100%)',
          background: 'var(--color-text)',
          border: '2px solid var(--color-neutral-700)',
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 18
        }}
      >
        <div>
          <div className="mono">{rascunho.id ? t.gestao.editando(rascunho.id) : t.gestao.novaKicker}</div>
          <h2 style={{ fontSize: 26, marginTop: 8 }}>
            {rascunho.id ? rascunho.nome || rascunho.id : t.gestao.cadastrar}
          </h2>
        </div>

        {campo(t.gestao.nome, 'nome', { placeholder: t.gestao.nomePlaceholder })}
        {campo(t.gestao.url, 'moonrakerUrl', {
          placeholder: t.gestao.urlPlaceholder,
          mono: true,
          dica: t.gestao.urlDica
        })}

        {/* O teste fica logo abaixo da URL, com rótulo: é aqui que ele serve,
            enquanto a pessoa ainda está digitando o endereço. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: -6 }}>
          <button
            type="button"
            onClick={aoTestar}
            disabled={testando || !rascunho.moonrakerUrl.trim()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid var(--color-neutral-700)',
              background: 'transparent',
              color: testando ? 'var(--color-neutral-500)' : 'var(--color-bg)',
              borderRadius: 999,
              padding: '9px 16px',
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 12,
              cursor: testando ? 'progress' : 'pointer'
            }}
          >
            <Plug size={14} strokeWidth={2} aria-hidden />
            {testando ? t.gestao.testando : t.gestao.testar}
          </button>

          {teste && (
            <span
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: teste.ok ? 'var(--color-accent-400)' : 'var(--color-accent)'
              }}
            >
              {teste.ok ? <Check size={13} strokeWidth={3} aria-hidden /> : <X size={13} strokeWidth={3} aria-hidden />}
              {teste.texto}
            </span>
          )}
        </div>

        {campo(t.gestao.apiKey, 'apiKey', {
          placeholder: t.gestao.apiKeyPlaceholder,
          mono: true,
          type: 'password'
        })}
        {campo(t.gestao.cameraUrl, 'cameraUrl', { placeholder: t.gestao.cameraPlaceholder, mono: true })}

        <button
          type="button"
          onClick={() => aoMudar({ ...rascunho, backupEnabled: !rascunho.backupEnabled })}
          aria-pressed={rascunho.backupEnabled}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            border: 0,
            background: 'transparent',
            color: 'var(--color-neutral-300)',
            fontSize: 13,
            cursor: 'pointer',
            padding: 0
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 5,
              background: rascunho.backupEnabled ? 'var(--color-accent)' : 'transparent',
              border: `1px solid ${rascunho.backupEnabled ? 'var(--color-accent)' : 'var(--color-neutral-600)'}`,
              color: 'var(--color-bg)'
            }}
          >
            {rascunho.backupEnabled && <Check size={12} strokeWidth={3} aria-hidden />}
          </span>
          <span>{t.gestao.incluirBackup}</span>
        </button>

        {erro && (
          <div
            role="alert"
            style={{ fontSize: 13, color: 'var(--color-accent-400)', borderLeft: '2px solid var(--color-accent)', paddingLeft: 10 }}
          >
            {erro}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={aoFechar} style={botaoSecundario}>
            {t.comum.cancelar}
          </button>
          <button type="submit" disabled={salvando} style={{ ...botaoPrimario, opacity: salvando ? 0.5 : 1 }}>
            {salvando ? t.comum.salvando : t.comum.salvar}
          </button>
        </div>
      </form>
    </div>
  );
}

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
