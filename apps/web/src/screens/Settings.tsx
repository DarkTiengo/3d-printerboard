import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plug, Plus, Trash2 } from 'lucide-react';
import type { PrinterConfig } from '@3dfarm/shared';
import { api } from '../lib/api';
import { IconButton } from '../components/IconButton';
import { Confirm } from '../components/Confirm';

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
  const qc = useQueryClient();
  const { data: printers, isLoading } = useQuery({ queryKey: ['configPrinters'], queryFn: api.configPrinters });

  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [removendo, setRemovendo] = useState<PrinterConfig | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [teste, setTeste] = useState<string | null>(null);

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
    onError: (e) => setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
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
    onSuccess: (res) =>
      setTeste(res.ok ? `Conectado: ${res.hostname} rodando ${res.versao}.` : `Falhou: ${res.erro}`),
    onError: (e) => setTeste(e instanceof Error ? e.message : 'Falha no teste.')
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
        <span className="mono">IMPRESSORAS DA FAZENDA — {printers?.length ?? 0}</span>
        <span style={{ marginLeft: 'auto' }}>
          <IconButton
            rotulo="Cadastrar nova impressora"
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
        {isLoading && <span className="mono">CARREGANDO…</span>}
        {printers?.length === 0 && !isLoading && (
          <p style={{ color: 'var(--color-neutral-300)', maxWidth: 480, textWrap: 'pretty' }}>
            Nenhuma impressora cadastrada. Adicione o endereço do Moonraker de cada máquina — normalmente{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>http://nome-do-host.local:7125</code>.
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
                CÂMERA {p.cameraUrl ?? 'não configurada'}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-500)' }}>
                BACKUP {p.backupEnabled ? 'ligado' : 'desligado'} · CHAVE {p.apiKey ? 'definida' : 'nenhuma'}
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
                  Editar
                </button>
                <IconButton
                  rotulo={`Remover ${p.nome} da fazenda`}
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
        titulo="Remover impressora"
        descricao={
          <>
            <strong>{removendo?.nome}</strong> sai do painel, da parede de câmeras e do ciclo de backup. Os snapshots
            já guardados dessa máquina também são apagados. A impressora em si não é alterada.
          </>
        }
        rotuloConfirmar="Remover"
        onConfirmar={() => removendo && remover.mutate(removendo.id)}
        onCancelar={() => setRemovendo(null)}
      />
    </div>
  );
}

function Formulario({
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
  rascunho: Rascunho;
  erro: string | null;
  teste: string | null;
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
    props: { placeholder?: string; mono?: boolean; type?: string } = {}
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
    </label>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={rascunho.id ? `Editar ${rascunho.nome}` : 'Cadastrar impressora'}
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
          <div className="mono">{rascunho.id ? `EDITANDO ${rascunho.id}` : 'NOVA IMPRESSORA'}</div>
          <h2 style={{ fontSize: 26, marginTop: 8 }}>{rascunho.id ? rascunho.nome || 'Impressora' : 'Cadastrar'}</h2>
        </div>

        {campo('NOME', 'nome', { placeholder: 'Ender 3 V2 — A' })}
        {campo('URL DO MOONRAKER', 'moonrakerUrl', { placeholder: 'http://ender-a.local:7125', mono: true })}
        {campo('API KEY (OPCIONAL)', 'apiKey', { placeholder: 'em branco se o Moonraker não exige', mono: true, type: 'password' })}
        {campo('URL DA CÂMERA (OPCIONAL)', 'cameraUrl', {
          placeholder: 'http://ender-a.local/webcam/?action=stream',
          mono: true
        })}

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
          <span>Incluir no backup diário</span>
        </button>

        {teste && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: teste.startsWith('Conectado') ? 'var(--color-accent-400)' : 'var(--color-accent)',
              borderLeft: '2px solid currentColor',
              paddingLeft: 10
            }}
          >
            {teste}
          </div>
        )}
        {erro && (
          <div
            role="alert"
            style={{ fontSize: 13, color: 'var(--color-accent-400)', borderLeft: '2px solid var(--color-accent)', paddingLeft: 10 }}
          >
            {erro}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <IconButton
            rotulo="Testar conexão com o Moonraker"
            variante="secundaria"
            disabled={testando}
            onClick={aoTestar}
            icone={<Plug size={16} strokeWidth={2} aria-hidden />}
          />
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button type="button" onClick={aoFechar} style={botaoSecundario}>
              Cancelar
            </button>
            <button type="submit" disabled={salvando} style={{ ...botaoPrimario, opacity: salvando ? 0.5 : 1 }}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </span>
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
