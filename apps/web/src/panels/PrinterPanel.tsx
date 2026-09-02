import { Pause, Play, X } from 'lucide-react';
import type { Printer, User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { IconButton } from '../components/IconButton';
import { ProgressBar } from '../components/ProgressBar';
import { Ponto, Tag } from '../components/Tag';
import { CameraFeed } from '../components/CameraFeed';
import { controlesHabilitados, corDoPonto, estiloStatus } from '../lib/status';
import { usePrinters } from '../store/printers';
import { api } from '../lib/api';
import { JogPad } from './JogPad';
import { TempList } from './TempList';
import { MacroGrid } from './MacroGrid';

const secao: React.CSSProperties = { borderTop: '1px solid var(--color-neutral-800)' };

/**
 * Mini painel de controle da impressora selecionada — design/README.md § 2.
 * Seis seções separadas por 1px, de cima para baixo.
 */
export function PrinterPanel({
  printer,
  usuario,
  aoFechar
}: {
  printer: Printer;
  usuario: User;
  aoFechar: () => void;
}) {
  const otimista = usePrinters((s) => s.otimista);
  const tag = estiloStatus(printer.status);
  const habilitado = controlesHabilitados(printer.status);
  const podeControlar = pode(usuario.role, 'controlarImpressao') && printer.online;

  /**
   * Atualização otimista: o Moonraker leva alguns segundos para refletir a
   * mudança e a UI não pode parecer travada. O store reconcilia quando o SSE
   * confirma, ou solta o override depois do TTL.
   */
  const comandar = (status: Printer['status'], chamada: () => Promise<unknown>) => () => {
    otimista(printer.id, status);
    void chamada().catch(() => {});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%' }}>
      {/* 1. cabeçalho */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px' }}>
        <Ponto cor={corDoPonto(printer.status, printer.online)} />
        <span
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 800,
            fontSize: 15,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {printer.nome}
        </span>
        <Tag bg={tag.bg} fg={tag.fg} style={{ marginLeft: 'auto' }}>
          {printer.online ? tag.curto : 'OFFLINE'}
        </Tag>
        <IconButton
          rotulo="Fechar painel"
          variante="secundaria"
          pequeno
          onClick={aoFechar}
          icone={<X size={15} strokeWidth={2} aria-hidden />}
        />
      </header>

      {/* 2. feed 16:10 */}
      <div style={{ ...secao, position: 'relative', aspectRatio: '16 / 10', flex: 'none' }}>
        {/* único MJPEG ao vivo desta tela; a parede atrás usa snapshots */}
        <CameraFeed
          printerId={printer.id}
          temCamera={printer.temTaCamera}
          fps={10}
          modo="stream"
          observarVisibilidade={false}
          alt={`Câmera de ${printer.nome}`}
        />
        <span
          style={{
            position: 'absolute',
            top: 8,
            left: 10,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            textShadow: '0 1px 3px rgba(0,0,0,.8)'
          }}
        >
          CAM {printer.id}
        </span>
      </div>

      {/* 3. trabalho + controles */}
      <section style={{ ...secao, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="mono">TRABALHO</div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--color-bg)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={printer.job}
        >
          {printer.job}
        </div>

        <ProgressBar pct={printer.pct} altura={5} rotulo={`${printer.pct}% de ${printer.job}`} />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--color-neutral-400)'
          }}
        >
          <span>
            {printer.pct}% · CAMADA {printer.camada}
          </span>
          <span>{printer.restante}</span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <IconButton
            rotulo="Pausar impressão"
            variante="controle"
            disabled={!habilitado.pausar || !podeControlar}
            onClick={comandar('pausada', () => api.pausar(printer.id))}
            icone={<Pause size={15} strokeWidth={2} aria-hidden />}
          />
          <IconButton
            rotulo="Continuar impressão"
            variante="controlePrimario"
            disabled={!habilitado.continuar || !podeControlar}
            onClick={comandar('imprimindo', () => api.continuar(printer.id))}
            icone={<Play size={15} strokeWidth={2} aria-hidden />}
          />
          <IconButton
            rotulo="Cancelar impressão"
            variante="controle"
            disabled={!habilitado.cancelar || !podeControlar}
            onClick={comandar('cancelada', () => api.cancelar(printer.id))}
            icone={<X size={15} strokeWidth={2} aria-hidden />}
          />
        </div>
      </section>

      {/* 4. temperaturas */}
      <div style={secao}>
        <TempList temperaturas={printer.temperaturas} />
      </div>

      {/* 5. cabeça de impressão */}
      <div style={secao}>
        <JogPad printerId={printer.id} posicao={printer.posicao} desabilitado={!podeControlar} />
      </div>

      {/* 6. macros */}
      <div style={secao}>
        <MacroGrid printerId={printer.id} macros={printer.macros} desabilitado={!podeControlar} />
      </div>
    </div>
  );
}
