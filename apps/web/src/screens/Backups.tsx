import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Download, Upload } from 'lucide-react';
import type { BackupCard, User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { api } from '../lib/api';
import { IconButton } from '../components/IconButton';
import { Tag } from '../components/Tag';
import { Confirm } from '../components/Confirm';
import { usePrinters, usePrintersVisiveis } from '../store/printers';

/**
 * Backups — design/README.md § 5.
 * Faixa de quatro números no topo e um card por impressora.
 */
export function Backups({ usuario }: { usuario: User }) {
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
  const [restaurando, setRestaurando] = useState<BackupCard | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const rodarTodas = useMutation({
    mutationFn: api.rodarBackupTodas,
    onSuccess: (r) => {
      // só as ociosas começam agora: dizer isso evita o usuário achar que travou
      const partes = [`${r.iniciados} em andamento`];
      if (r.adiados > 0) partes.push(`${r.adiados} imprimindo (serão copiadas ao ficarem ociosas)`);
      if (r.offline > 0) partes.push(`${r.offline} offline`);
      setAviso(`Backup: ${partes.join(' · ')}.`);
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['backups'] }), 3000);
    },
    onError: (err) => setAviso(err instanceof Error ? err.message : 'Falha ao iniciar o backup.')
  });

  const rodarUma = useMutation({
    mutationFn: (id: string) => api.rodarBackup(id),
    onSuccess: (r) => {
      setAviso(
        r.resultado === 'adiado'
          ? `${r.nome} está imprimindo — o backup vai rodar assim que ela ficar ociosa.`
          : `Backup de ${r.nome} iniciado.`
      );
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['backups'] }), 3000);
    },
    onError: (err) => setAviso(err instanceof Error ? err.message : 'Falha ao iniciar o backup.')
  });

  const numeros = [
    { rotulo: 'ROTINA', valor: resumo?.rotina ?? '—', alerta: false },
    { rotulo: 'ÚLTIMO CICLO', valor: resumo?.ultimoCiclo ?? '—', alerta: false },
    { rotulo: 'ARMAZENADO', valor: resumo?.armazenado ?? '—', alerta: false },
    { rotulo: 'FALHAS', valor: String(resumo?.falhas ?? 0), alerta: (resumo?.falhas ?? 0) > 0 }
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
            rotulo={podeRodar ? 'Backup de toda a fazenda agora' : 'Backup agora (sem permissão)'}
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
        {isLoading && cards.length === 0 && <span className="mono">CARREGANDO…</span>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
          {cards.map((c) => (
            <CardBackup
              key={c.printerId}
              card={c}
              podeRodar={podeRodar}
              podeRestaurar={pode(usuario.role, 'restaurarBackup')}
              aoRodar={() => rodarUma.mutate(c.printerId)}
              aoRestaurar={() => setRestaurando(c)}
            />
          ))}
        </div>
      </div>

      <DialogoRestauracao
        card={restaurando}
        aoFechar={() => setRestaurando(null)}
        aoConcluir={(msg) => {
          setRestaurando(null);
          setAviso(msg);
        }}
      />
    </div>
  );
}

function CardBackup({
  card,
  podeRodar,
  podeRestaurar,
  aoRodar,
  aoRestaurar
}: {
  card: BackupCard;
  podeRodar: boolean;
  podeRestaurar: boolean;
  aoRodar: () => void;
  aoRestaurar: () => void;
}) {
  const ok = card.estado === 'OK';
  const linhas = [
    { rotulo: 'PERFIS', valor: card.perfis },
    { rotulo: 'FIRMWARE/CALIB.', valor: card.firmware },
    { rotulo: 'G-CODE', valor: card.gcode }
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
          {card.estado}
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
          NA FILA — AGUARDANDO FICAR OCIOSA
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <IconButton
          rotulo={`Fazer backup de ${card.nome} agora`}
          variante="primaria"
          disabled={!podeRodar}
          onClick={aoRodar}
          icone={<Download size={16} strokeWidth={2} aria-hidden />}
        />
        <IconButton
          rotulo={`Restaurar um backup de ${card.nome} em outra impressora`}
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
  card,
  aoFechar,
  aoConcluir
}: {
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
    onSuccess: (r) => aoConcluir(`Restauração concluída: ${r.arquivos} arquivos de configuração enviados.`),
    onError: (err) => aoConcluir(err instanceof Error ? err.message : 'Falha na restauração.')
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
            <div className="mono">RESTAURAR CONFIGURAÇÃO</div>
            <h2 style={{ fontSize: 24, marginTop: 8 }}>{card.nome}</h2>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="mono">SNAPSHOT DE ORIGEM</span>
            <select
              value={escolhido ?? ''}
              onChange={(e) => setSnapshotId(Number(e.target.value))}
              style={campoSelect}
            >
              {(snapshots ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.quando} · {s.estado} · {s.arquivos} arq. · {s.tamanho}
                </option>
              ))}
              {(snapshots ?? []).length === 0 && <option value="">nenhum snapshot guardado</option>}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="mono">IMPRESSORA DE DESTINO</span>
            <select value={alvo} onChange={(e) => setDestino(e.target.value)} style={campoSelect}>
              {printers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {p.id === card.printerId ? ' (mesma máquina)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={aoFechar} style={botaoSecundario}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={!escolhido || restaurar.isPending}
              onClick={() => setConfirmando(true)}
              style={{ ...botaoPrimario, opacity: !escolhido || restaurar.isPending ? 0.5 : 1 }}
            >
              {restaurar.isPending ? 'Restaurando…' : 'Restaurar'}
            </button>
          </div>
        </div>
      </div>

      <Confirm
        aberto={confirmando}
        titulo="Sobrescrever configuração"
        descricao={
          <>
            Os arquivos de configuração de <strong>{nomeAlvo}</strong> serão substituídos pelos do snapshot escolhido.
            O que estiver lá agora e não estiver no backup se perde. A máquina precisa de um FIRMWARE_RESTART depois.
          </>
        }
        rotuloConfirmar="Sobrescrever"
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
