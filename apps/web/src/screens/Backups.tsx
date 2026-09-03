import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Clock, Download, HardDriveDownload, SlidersHorizontal, Upload } from 'lucide-react';
import type { BackupCard, BackupPadroes, BackupSecao, User } from '@3dfarm/shared';
import { BACKUP_SECOES, pode } from '@3dfarm/shared';
import { api, urlDownloadBackup } from '../lib/api';
import { IconButton } from '../components/IconButton';
import { Tag } from '../components/Tag';
import { Confirm } from '../components/Confirm';
import { usePrinters, usePrintersVisiveis } from '../store/printers';
import { useT } from '../i18n';
import { useFormato } from '../i18n/formato';
import type { Dicionario } from '../i18n/pt';

/**
 * Backups — design/README.md § 5.
 * Faixa de quatro números no topo e um card por impressora.
 */
export function Backups({ usuario }: { usuario: User }) {
  const t = useT();
  const f = useFormato();
  const qc = useQueryClient();
  // seletores separados de propósito: um seletor que monta objeto novo a cada
  // render faz o zustand v5 re-renderizar em loop
  const resumoStream = usePrinters((s) => s.backupResumo);
  const cardsStream = usePrinters((s) => s.backupCards);

  const { data, isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: api.backups,
    refetchInterval: 30_000
  });

  // o SSE avisa quando um ciclo termina; o fetch é só o estado inicial
  const resumo = resumoStream ?? data?.resumo;
  const cards = cardsStream.length > 0 ? cardsStream : (data?.cards ?? []);

  const podeRodar = pode(usuario.role, 'rodarBackup');
  const podeConfigurar = pode(usuario.role, 'restaurarBackup');
  const [restaurando, setRestaurando] = useState<BackupCard | null>(null);
  const [configurando, setConfigurando] = useState<BackupCard | null>(null);
  const [vendoCopias, setVendoCopias] = useState<BackupCard | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const rodarTodas = useMutation({
    mutationFn: api.rodarBackupTodas,
    onSuccess: (r) => {
      // só as ociosas começam agora: dizer isso evita o usuário achar que travou
      setAviso(t.backups.resultado(r.iniciados, r.adiados, r.offline));
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['backups'] }), 3000);
    },
    onError: (err) => setAviso(err instanceof Error ? err.message : t.backups.falha)
  });

  const rodarUma = useMutation({
    mutationFn: (id: string) => api.rodarBackup(id),
    onSuccess: (r) => {
      setAviso(r.resultado === 'adiado' ? t.backups.adiado(r.nome) : t.backups.iniciado(r.nome));
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['backups'] }), 3000);
    },
    onError: (err) => setAviso(err instanceof Error ? err.message : t.backups.falha)
  });

  // a rotina agendada mais a rede de segurança de quem estava desligado
  const hora = resumo ? f.horaDoCron(resumo.cron) : null;
  const numeros = [
    { rotulo: t.backups.rotina, valor: hora ? t.backups.diario(hora) : (resumo?.cron ?? '—'), alerta: false },
    { rotulo: t.backups.ultimoCiclo, valor: f.quandoCurto(resumo?.ultimoCicloEm), alerta: false },
    { rotulo: t.backups.armazenado, valor: f.bytes(resumo?.bytes), alerta: false },
    { rotulo: t.backups.falhas, valor: String(resumo?.falhas ?? 0), alerta: (resumo?.falhas ?? 0) > 0 }
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '0 22px 0 0',
          borderBottom: '2px solid var(--color-neutral-700)'
        }}
      >
        {numeros.map((n) => (
          <div key={n.rotulo} style={{ padding: '16px 22px', minWidth: 150 }}>
            <div className="mono">{n.rotulo}</div>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: 26,
                marginTop: 4,
                color: n.alerta ? 'var(--color-accent)' : 'var(--color-bg)'
              }}
            >
              {n.valor}
            </div>
          </div>
        ))}

        <div style={{ marginLeft: 'auto' }}>
          <IconButton
            rotulo={podeRodar ? t.backups.rodarTodas : t.backups.rodarSemPermissao}
            variante="primaria"
            disabled={!podeRodar || rodarTodas.isPending}
            onClick={() => rodarTodas.mutate()}
            icone={<Download size={17} strokeWidth={2} aria-hidden />}
          />
        </div>
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
        {isLoading && cards.length === 0 && <span className="mono">{t.comum.carregando}</span>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
          {cards.map((c) => (
            <CardBackup
              key={c.printerId}
              t={t}
              f={f}
              card={c}
              padroes={resumo?.padroes}
              podeRodar={podeRodar}
              podeRestaurar={podeConfigurar}
              aoRodar={() => rodarUma.mutate(c.printerId)}
              aoRestaurar={() => setRestaurando(c)}
              aoConfigurar={() => setConfigurando(c)}
              aoVerCopias={() => setVendoCopias(c)}
            />
          ))}
        </div>
      </div>

      <DialogoRestauracao
        t={t}
        f={f}
        card={restaurando}
        aoFechar={() => setRestaurando(null)}
        aoConcluir={(msg) => {
          setRestaurando(null);
          setAviso(msg);
        }}
      />

      <DialogoConfiguracao
        t={t}
        f={f}
        card={configurando}
        podeEditar={podeConfigurar}
        aoFechar={() => setConfigurando(null)}
        aoConcluir={(msg) => {
          setConfigurando(null);
          setAviso(msg);
          void qc.invalidateQueries({ queryKey: ['backups'] });
        }}
      />

      <DialogoCopias
        t={t}
        f={f}
        card={vendoCopias}
        padroes={resumo?.padroes}
        aoFechar={() => setVendoCopias(null)}
      />
    </div>
  );
}

function CardBackup({
  t,
  f,
  card,
  padroes,
  podeRodar,
  podeRestaurar,
  aoRodar,
  aoRestaurar,
  aoConfigurar,
  aoVerCopias
}: {
  t: Dicionario;
  f: ReturnType<typeof useFormato>;
  card: BackupCard;
  padroes: BackupPadroes | undefined;
  podeRodar: boolean;
  podeRestaurar: boolean;
  aoRodar: () => void;
  aoRestaurar: () => void;
  aoConfigurar: () => void;
  aoVerCopias: () => void;
}) {
  const ok = card.estado === 'OK';
  const linhas = [
    { rotulo: t.backups.perfis, valor: f.quandoCurto(card.ultimoEm) },
    { rotulo: t.backups.firmware, valor: card.firmware },
    { rotulo: t.backups.gcode, valor: card.ultimoEm ? `${card.gcodeArquivos} · ${f.bytes(card.bytes)}` : '—' },
    { rotulo: t.backups.plano, valor: descreverPlano(t, card, padroes) }
  ];

  return (
    <article
      style={{
        border: '2px solid var(--color-neutral-700)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {card.nome}
        </h3>
        <Tag
          bg={ok ? 'var(--color-neutral-800)' : 'var(--color-accent)'}
          fg={ok ? 'var(--color-neutral-300)' : 'var(--color-bg)'}
          style={{ marginLeft: 'auto' }}
        >
          {t.backups.estados[card.estado]}
        </Tag>
      </div>

      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {linhas.map((l) => (
          <div key={l.rotulo} style={{ display: 'flex', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <dt style={{ color: 'var(--color-neutral-500)', minWidth: 118 }}>{l.rotulo}</dt>
            <dd style={{ margin: 0, color: 'var(--color-neutral-300)', minWidth: 0, overflowWrap: 'anywhere' }}>
              {l.valor}
            </dd>
          </div>
        ))}
      </dl>

      {card.pendente && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            color: 'var(--color-accent-400)'
          }}
        >
          <Clock size={12} strokeWidth={2} aria-hidden />
          {t.backups.naFila}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <IconButton
          rotulo={t.backups.rodarUma(card.nome)}
          variante="primaria"
          disabled={!podeRodar}
          onClick={aoRodar}
          icone={<Download size={16} strokeWidth={2} aria-hidden />}
        />
        <IconButton
          rotulo={t.backups.copias(card.nome)}
          variante="secundaria"
          disabled={card.copias === 0}
          onClick={aoVerCopias}
          icone={<Archive size={16} strokeWidth={2} aria-hidden />}
        />
        <IconButton
          rotulo={t.backups.configurar(card.nome)}
          variante="secundaria"
          onClick={aoConfigurar}
          icone={<SlidersHorizontal size={16} strokeWidth={2} aria-hidden />}
        />
        <IconButton
          rotulo={t.backups.restaurarDe(card.nome)}
          variante="secundaria"
          disabled={!podeRestaurar || card.estado === 'NUNCA'}
          onClick={aoRestaurar}
          icone={<Upload size={16} strokeWidth={2} aria-hidden />}
        />
      </div>
    </article>
  );
}

/**
 * Restauração: escolhe o snapshot de origem e a impressora de destino.
 * Sobrescreve a config da máquina de destino, então passa por confirmação.
 */
function DialogoRestauracao({
  t,
  f,
  card,
  aoFechar,
  aoConcluir
}: {
  t: Dicionario;
  f: ReturnType<typeof useFormato>;
  card: BackupCard | null;
  aoFechar: () => void;
  aoConcluir: (msg: string) => void;
}) {
  const printers = usePrintersVisiveis();
  const [snapshotId, setSnapshotId] = useState<number | null>(null);
  const [destino, setDestino] = useState<string>('');
  const [confirmando, setConfirmando] = useState(false);

  const { data: snapshots } = useQuery({
    queryKey: ['snapshots', card?.printerId],
    queryFn: () => api.snapshots(card!.printerId),
    enabled: !!card
  });

  const restaurar = useMutation({
    mutationFn: () => api.restaurar(snapshotId!, destino),
    onSuccess: (r) => aoConcluir(t.backups.restaurado(r.arquivos)),
    onError: (err) => aoConcluir(err instanceof Error ? err.message : t.backups.falhaRestaurar)
  });

  if (!card) return null;

  const escolhido = snapshotId ?? snapshots?.[0]?.id ?? null;
  const alvo = destino || card.printerId;
  const nomeAlvo = printers.find((p) => p.id === alvo)?.nome ?? alvo;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Restaurar backup de ${card.nome}`}
        onClick={(e) => e.target === e.currentTarget && aoFechar()}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 70,
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'rgba(20, 19, 18, 0.72)'
        }}
      >
        <div
          style={{
            width: 'min(520px, 100%)',
            background: 'var(--color-text)',
            border: '2px solid var(--color-neutral-700)',
            padding: 28,
            display: 'flex',
            flexDirection: 'column',
            gap: 18
          }}
        >
          <div>
            <div className="mono">{t.backups.restaurarTitulo}</div>
            <h2 style={{ fontSize: 24, marginTop: 8 }}>{card.nome}</h2>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="mono">{t.backups.snapshotOrigem}</span>
            <select
              value={escolhido ?? ''}
              onChange={(e) => setSnapshotId(Number(e.target.value))}
              style={campoSelect}
            >
              {(snapshots ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {f.quandoCurto(s.criadoEm)} · {t.backups.estados[s.estado]} · {s.arquivos} · {f.bytes(s.bytes)}
                </option>
              ))}
              {(snapshots ?? []).length === 0 && <option value="">{t.backups.semSnapshot}</option>}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="mono">{t.backups.destino}</span>
            <select value={alvo} onChange={(e) => setDestino(e.target.value)} style={campoSelect}>
              {printers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {p.id === card.printerId ? t.backups.mesmaMaquina : ''}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={aoFechar} style={botaoSecundario}>
              {t.comum.cancelar}
            </button>
            <button
              type="button"
              disabled={!escolhido || restaurar.isPending}
              onClick={() => setConfirmando(true)}
              style={{ ...botaoPrimario, opacity: !escolhido || restaurar.isPending ? 0.5 : 1 }}
            >
              {restaurar.isPending ? t.backups.restaurando : t.backups.restaurar}
            </button>
          </div>
        </div>
      </div>

      <Confirm
        aberto={confirmando}
        titulo={t.backups.confirmaTitulo}
        descricao={t.backups.confirmaTexto(nomeAlvo)}
        rotuloConfirmar={t.backups.sobrescrever}
        onConfirmar={() => {
          setConfirmando(false);
          restaurar.mutate();
        }}
        onCancelar={() => setConfirmando(false)}
      />
    </>
  );
}

const campoSelect: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-neutral-700)',
  borderRadius: 10,
  color: 'var(--color-bg)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  padding: '12px 14px'
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


/** 'config, perfis, firmware · 24 h · 7 cópias' — o plano do card, em uma linha. */
function descreverPlano(t: Dicionario, card: BackupCard, padroes: BackupPadroes | undefined): string {
  const secoes = card.prefs.secoes.map((s) => t.backups.secoesCurtas[s]).join(', ') || t.backups.semSecao;
  const horas = card.prefs.intervaloHoras ?? padroes?.intervaloHoras ?? 24;
  const copias = card.prefs.retencao ?? padroes?.retencao ?? 7;
  return t.backups.resumoPlano(secoes, horas, copias);
}

/**
 * O que esta máquina copia, de quanto em quanto tempo e quantas cópias guarda.
 *
 * A lista de arquivos vem ao vivo da impressora, e não do último backup: o que
 * interessa marcar é o que está lá agora. Com a máquina fora da rede o resto do
 * diálogo continua editável — só a seleção fina de arquivos fica indisponível.
 */
function DialogoConfiguracao({
  t,
  f,
  card,
  podeEditar,
  aoFechar,
  aoConcluir
}: {
  t: Dicionario;
  f: ReturnType<typeof useFormato>;
  card: BackupCard | null;
  podeEditar: boolean;
  aoFechar: () => void;
  aoConcluir: (msg: string) => void;
}) {
  const [secoes, setSecoes] = useState<BackupSecao[]>([]);
  const [excluidos, setExcluidos] = useState<string[]>([]);
  const [intervalo, setIntervalo] = useState('');
  const [retencao, setRetencao] = useState('');

  const { data } = useQuery({
    queryKey: ['backup-prefs', card?.printerId],
    queryFn: () => api.prefsBackup(card!.printerId),
    enabled: !!card
  });

  const arquivos = useQuery({
    queryKey: ['backup-arquivos', card?.printerId],
    queryFn: () => api.arquivosDeConfig(card!.printerId),
    enabled: !!card,
    retry: false
  });

  // recarrega o formulário quando o diálogo abre em outra impressora
  useEffect(() => {
    if (!data) return;
    setSecoes(data.prefs.secoes);
    setExcluidos(data.prefs.excluidos);
    setIntervalo(data.prefs.intervaloHoras == null ? '' : String(data.prefs.intervaloHoras));
    setRetencao(data.prefs.retencao == null ? '' : String(data.prefs.retencao));
  }, [data]);

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarPrefsBackup(card!.printerId, {
        secoes,
        excluidos,
        // vazio quer dizer "usa o padrão da fazenda", não zero
        intervaloHoras: intervalo.trim() === '' ? null : Number(intervalo),
        retencao: retencao.trim() === '' ? null : Number(retencao)
      }),
    onSuccess: () => aoConcluir(t.backups.salvo(card!.nome)),
    onError: (err) => aoConcluir(err instanceof Error ? err.message : t.backups.falhaSalvar)
  });

  if (!card) return null;

  const padroes = data?.padroes;
  const alternar = (s: BackupSecao) =>
    setSecoes((atual) => (atual.includes(s) ? atual.filter((x) => x !== s) : [...atual, s]));
  const alternarArquivo = (caminho: string) =>
    setExcluidos((atual) =>
      atual.includes(caminho) ? atual.filter((x) => x !== caminho) : [...atual, caminho]
    );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.backups.configurar(card.nome)}
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
      style={fundoModal}
    >
      <div style={{ ...caixaModal, width: 'min(560px, 100%)' }}>
        <div>
          <div className="mono">{t.backups.configTitulo}</div>
          <h2 style={{ fontSize: 24, marginTop: 8 }}>{card.nome}</h2>
        </div>

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="mono" style={{ padding: 0, marginBottom: 4 }}>
            {t.backups.oQueCopiar}
          </legend>
          {BACKUP_SECOES.map((s) => (
            <label key={s} style={linhaCheck}>
              <input
                type="checkbox"
                checked={secoes.includes(s)}
                disabled={!podeEditar}
                onChange={() => alternar(s)}
              />
              {t.backups.secoes[s]}
            </label>
          ))}
        </fieldset>

        {secoes.includes('config') && (
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <legend className="mono" style={{ padding: 0, marginBottom: 4 }}>
              {t.backups.arquivosDeConfig}
            </legend>
            <p style={dica}>{t.backups.arquivosDica}</p>

            {arquivos.isLoading && <span className="mono">{t.comum.carregando}</span>}
            {arquivos.isError && <span style={dica}>{t.backups.arquivosOffline}</span>}
            {arquivos.data?.length === 0 && <span style={dica}>{t.backups.arquivosVazio}</span>}

            {(arquivos.data?.length ?? 0) > 0 && (
              <div style={listaArquivos}>
                {arquivos.data!.map((a) => (
                  <label key={a.caminho} style={linhaCheck}>
                    <input
                      type="checkbox"
                      checked={!excluidos.includes(a.caminho)}
                      disabled={!podeEditar}
                      onChange={() => alternarArquivo(a.caminho)}
                    />
                    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{a.caminho}</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--color-neutral-500)' }}>{f.bytes(a.bytes)}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="mono">{t.backups.intervalo}</span>
            <input
              type="number"
              min={1}
              max={2160}
              value={intervalo}
              disabled={!podeEditar}
              placeholder={padroes ? t.backups.padraoGlobal(padroes.intervaloHoras) : ''}
              onChange={(e) => setIntervalo(e.target.value)}
              style={campoSelect}
            />
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="mono">{t.backups.retencaoLabel}</span>
            <input
              type="number"
              min={1}
              max={365}
              value={retencao}
              disabled={!podeEditar}
              placeholder={padroes ? t.backups.padraoGlobal(padroes.retencao) : ''}
              onChange={(e) => setRetencao(e.target.value)}
              style={campoSelect}
            />
          </label>
        </div>
        <p style={dica}>
          {t.backups.retencaoAviso(retencao.trim() === '' ? (padroes?.retencao ?? 7) : Number(retencao))}
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={aoFechar} style={botaoSecundario}>
            {t.comum.cancelar}
          </button>
          <button
            type="button"
            disabled={!podeEditar || salvar.isPending}
            onClick={() => salvar.mutate()}
            style={{ ...botaoPrimario, opacity: !podeEditar || salvar.isPending ? 0.5 : 1 }}
          >
            {salvar.isPending ? t.backups.salvando : t.backups.salvar}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * As cópias guardadas desta impressora, da mais nova para a mais velha, com o
 * link para baixar cada uma. O zip guardado não repete a biblioteca de G-code
 * (ela é deduplicada entre máquinas e entre dias), então quem quer o pacote
 * completo pede a versão com G-code — montada na hora pelo servidor.
 */
function DialogoCopias({
  t,
  f,
  card,
  padroes,
  aoFechar
}: {
  t: Dicionario;
  f: ReturnType<typeof useFormato>;
  card: BackupCard | null;
  padroes: BackupPadroes | undefined;
  aoFechar: () => void;
}) {
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['snapshots', card?.printerId],
    queryFn: () => api.snapshots(card!.printerId),
    enabled: !!card
  });

  if (!card) return null;
  const guardadas = card.prefs.retencao ?? padroes?.retencao ?? 7;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.backups.copias(card.nome)}
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
      style={fundoModal}
    >
      <div style={{ ...caixaModal, width: 'min(620px, 100%)' }}>
        <div>
          <div className="mono">{t.backups.copiasTitulo}</div>
          <h2 style={{ fontSize: 24, marginTop: 8 }}>{card.nome}</h2>
        </div>

        {isLoading && <span className="mono">{t.comum.carregando}</span>}
        {snapshots?.length === 0 && <span style={dica}>{t.backups.copiasVazio}</span>}

        {(snapshots?.length ?? 0) > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflow: 'auto' }}>
            {snapshots!.map((s) => (
              <li
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--color-neutral-800)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11
                }}
              >
                <span style={{ minWidth: 120 }}>{f.quandoCurto(s.criadoEm)}</span>
                <span style={{ color: 'var(--color-neutral-500)' }}>{t.backups.estados[s.estado]}</span>
                <span style={{ color: 'var(--color-neutral-500)' }}>{f.bytes(s.bytes)}</span>
                {s.gcodeArquivos > 0 && (
                  <span style={{ color: 'var(--color-neutral-500)' }}>{t.backups.comGcode(s.gcodeArquivos)}</span>
                )}
                <a
                  href={urlDownloadBackup(s.id, false)}
                  style={{ ...linkBaixar, marginLeft: 'auto' }}
                  title={t.backups.baixar}
                >
                  <Download size={14} strokeWidth={2} aria-hidden />
                  {t.backups.baixar}
                </a>
                {s.gcodeArquivos > 0 && (
                  <a href={urlDownloadBackup(s.id, true)} style={linkBaixar} title={t.backups.baixarComGcode}>
                    <HardDriveDownload size={14} strokeWidth={2} aria-hidden />
                    {t.backups.baixarComGcode}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        <p style={dica}>{t.backups.retencaoAviso(guardadas)}</p>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={aoFechar} style={botaoSecundario}>
            {t.backups.fechar}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  background: 'var(--color-text)',
  border: '2px solid var(--color-neutral-700)',
  padding: 28,
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  maxHeight: 'calc(100vh - 48px)',
  overflow: 'auto'
};

const linhaCheck: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--color-neutral-300)',
  cursor: 'pointer'
};

const listaArquivos: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 200,
  overflow: 'auto',
  border: '1px solid var(--color-neutral-800)',
  padding: 10
};

const dica: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--color-neutral-500)'
};

const linkBaixar: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--color-neutral-700)',
  borderRadius: 999,
  padding: '6px 12px',
  color: 'var(--color-bg)',
  textDecoration: 'none',
  whiteSpace: 'nowrap'
};
