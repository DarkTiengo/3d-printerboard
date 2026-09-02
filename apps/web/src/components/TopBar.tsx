import { useState } from 'react';
import { Archive, Clock, FileText, LayoutGrid, LogOut, OctagonX, SlidersHorizontal, Video } from 'lucide-react';
import type { User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { useUi, type Tela } from '../store/ui';
import { usePrinters, usePrintersVisiveis } from '../store/printers';
import { IconButton } from './IconButton';
import { Confirm } from './Confirm';
import { api } from '../lib/api';

const ABAS: { tela: Tela; rotulo: string; Icone: typeof LayoutGrid }[] = [
  { tela: 'dash', rotulo: 'Painel', Icone: LayoutGrid },
  { tela: 'cams', rotulo: 'Câmeras', Icone: Video },
  { tela: 'files', rotulo: 'Arquivos', Icone: FileText },
  { tela: 'backup', rotulo: 'Backups', Icone: Archive },
  { tela: 'alerts', rotulo: 'Alertas', Icone: Clock }
];

/**
 * Barra superior — design/README.md § 2.
 *
 * As cinco abas primárias são o grupo do design. Gestão e sair entram como
 * botões secundários à direita, para não diluir esse grupo.
 */
export function TopBar({ usuario, aoSair }: { usuario: User; aoSair: () => void }) {
  const tela = useUi((s) => s.tela);
  const irPara = useUi((s) => s.irPara);
  const printers = usePrintersVisiveis();
  const alertas = usePrinters((s) => s.alertas);
  const fila = usePrinters((s) => s.fila);
  const conectado = usePrinters((s) => s.conectado);

  const [confirmarParada, setConfirmarParada] = useState(false);
  const [resultadoParada, setResultadoParada] = useState<string | null>(null);

  const ativas = printers.filter((p) => p.status === 'imprimindo' || p.status === 'atenção').length;
  const atencao = printers.filter((p) => p.status === 'atenção').length;
  const podeParar = pode(usuario.role, 'pararEmergencia');

  async function dispararParada() {
    setConfirmarParada(false);
    try {
      const r = await api.paradaEmergencia();
      setResultadoParada(
        r.ok
          ? `Parada de emergência enviada para ${r.total} impressoras.`
          : `Parada enviada, mas falhou em: ${r.falhas.join(', ')}. Verifique essas máquinas fisicamente.`
      );
    } catch (err) {
      setResultadoParada(err instanceof Error ? err.message : 'Falha ao enviar a parada de emergência.');
    }
  }

  return (
    <>
      <header
        style={{
          minHeight: 'var(--barra-altura)',
          borderBottom: '2px solid var(--color-neutral-700)',
          padding: '16px 22px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          flex: 'none'
        }}
      >
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 19, letterSpacing: '0.02em' }}>
          3D PRINTERBOARD
        </span>

        <nav aria-label="Telas" style={{ display: 'flex', gap: 4 }}>
          {ABAS.map(({ tela: t, rotulo, Icone }) => (
            <IconButton
              key={t}
              rotulo={rotulo}
              variante={tela === t ? 'abaAtiva' : 'abaInativa'}
              aria-current={tela === t ? 'page' : undefined}
              onClick={() => irPara(t)}
              icone={<Icone size={17} strokeWidth={2} aria-hidden />}
            />
          ))}
        </nav>

        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-neutral-400)',
            marginRight: 'auto'
          }}
        >
          {ativas} ativas · fila {fila.length} · {atencao} atenção
          {alertas.length > 0 && ` · ${alertas.length} alerta${alertas.length > 1 ? 's' : ''}`}
          {!conectado && ' · SEM CONEXÃO'}
        </span>

        {pode(usuario.role, 'gerirImpressoras') && (
          <IconButton
            rotulo="Gerir impressoras"
            variante={tela === 'config' ? 'abaAtiva' : 'secundaria'}
            onClick={() => irPara('config')}
            icone={<SlidersHorizontal size={16} strokeWidth={2} aria-hidden />}
          />
        )}

        <IconButton
          rotulo={`Sair (${usuario.username})`}
          variante="secundaria"
          onClick={aoSair}
          icone={<LogOut size={16} strokeWidth={2} aria-hidden />}
        />

        <IconButton
          rotulo={podeParar ? 'Parada de emergência' : 'Parada de emergência (sem permissão)'}
          variante="primaria"
          disabled={!podeParar}
          onClick={() => setConfirmarParada(true)}
          icone={<OctagonX size={19} strokeWidth={2} aria-hidden />}
        />
      </header>

      <Confirm
        aberto={confirmarParada}
        titulo="Parada de emergência"
        descricao={
          <>
            Isto desliga os aquecedores e os motores de <strong>todas as {printers.length} impressoras</strong>{' '}
            imediatamente. As impressões em andamento serão perdidas e cada máquina precisará de um FIRMWARE_RESTART
            para voltar.
          </>
        }
        rotuloConfirmar="Parar tudo"
        onConfirmar={dispararParada}
        onCancelar={() => setConfirmarParada(false)}
      />

      <Confirm
        aberto={!!resultadoParada}
        titulo="Parada de emergência"
        descricao={resultadoParada}
        rotuloConfirmar="Entendi"
        perigoso={false}
        semCancelar
        onConfirmar={() => setResultadoParada(null)}
        onCancelar={() => setResultadoParada(null)}
      />
    </>
  );
}
