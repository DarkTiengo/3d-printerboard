import { useState } from 'react';
import { PackageX, Pause, Play, X } from 'lucide-react';
import type { Printer, User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { IconButton } from '../components/IconButton';
import { ProgressBar } from '../components/ProgressBar';
import { Ponto, Tag } from '../components/Tag';
import { CameraFeed } from '../components/CameraFeed';
import { Confirm } from '../components/Confirm';
import { useConfirmarCancelamento } from '../components/ConfirmarCancelamento';
import { controlesHabilitados, coresStatus, corDoPonto, rotuloStatus, rotuloRestante } from '../lib/status';
import { useT } from '../i18n';
import { useFormato } from '../i18n/formato';
import { usePrinters } from '../store/printers';
import { api } from '../lib/api';
import { JogPad } from './JogPad';
import { TempList } from './TempList';
import { MacroGrid } from './MacroGrid';
import { PowerControls } from './PowerControls';
import { OfertaDeReimpressao, PrinterQueue } from './PrinterQueue';

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
  const t = useT();
  const f = useFormato();
  const otimista = usePrinters((s) => s.otimista);
  const cores = coresStatus(printer.status);
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

  const cancelamento = useConfirmarCancelamento(printer, comandar('cancelada', () => api.cancelar(printer.id)));

  /*
   * Excluir a peça em curso só existe em máquina com [exclude_object] e em
   * arquivo que o fatiador rotulou — `pecaAtual` é null em todo o resto, e o
   * botão simplesmente não aparece.
   */
  const [excluindoPeca, setExcluindoPeca] = useState(false);

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
        <Tag bg={cores.bg} fg={cores.fg} style={{ marginLeft: 'auto' }}>
          {printer.online ? rotuloStatus(printer.status, t) : t.status.offline}
        </Tag>
        <IconButton
          rotulo={t.impressora.fechar}
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
          alt={t.painel.cameraDe(printer.nome)}
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
        <div className="mono">{t.impressora.trabalho}</div>
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
            {printer.pct}% · {t.impressora.camada(printer.camada)}
          </span>
          <span>{rotuloRestante(printer, t, f)}</span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <IconButton
            rotulo={t.impressora.pausar}
            variante="controle"
            disabled={!habilitado.pausar || !podeControlar}
            onClick={comandar('pausada', () => api.pausar(printer.id))}
            icone={<Pause size={15} strokeWidth={2} aria-hidden />}
          />
          <IconButton
            rotulo={t.impressora.continuar}
            variante="controlePrimario"
            disabled={!habilitado.continuar || !podeControlar}
            onClick={comandar('imprimindo', () => api.continuar(printer.id))}
            icone={<Play size={15} strokeWidth={2} aria-hidden />}
          />
          <IconButton
            rotulo={t.impressora.cancelar}
            variante="controle"
            disabled={!habilitado.cancelar || !podeControlar}
            onClick={cancelamento.pedir}
            icone={<X size={15} strokeWidth={2} aria-hidden />}
          />
          {printer.pecaAtual && (
            <IconButton
              rotulo={t.impressora.excluirPeca}
              variante="controle"
              disabled={!habilitado.cancelar || !podeControlar}
              onClick={() => setExcluindoPeca(true)}
              icone={<PackageX size={15} strokeWidth={2} aria-hidden />}
            />
          )}
        </div>
      </section>

      {/* 4. a peça anterior acabou de sair: oferece repetir */}
      <div style={secao}>
        <OfertaDeReimpressao printer={printer} podeControlar={podeControlar} />
      </div>

      {/* 5. a fila desta máquina, que só anda com autorização */}
      <div style={secao}>
        <PrinterQueue printer={printer} podeControlar={podeControlar} />
      </div>

      {/* 6. temperaturas — e os aquecedores, que se comandam daqui */}
      <div style={secao}>
        <TempList
          printerId={printer.id}
          nomeDaImpressora={printer.nome}
          imprimindo={printer.status === 'imprimindo' || printer.status === 'pausada'}
          temperaturas={printer.temperaturas}
          desabilitado={!podeControlar || printer.klippy !== 'ready'}
        />
      </div>

      {/* 7. cabeça de impressão */}
      <div style={secao}>
        <JogPad printerId={printer.id} posicao={printer.posicao} desabilitado={!podeControlar} />
      </div>

      {/* 8. macros */}
      <div style={secao}>
        <MacroGrid printerId={printer.id} macros={printer.macros} desabilitado={!podeControlar} />
      </div>

      {/* 9. energia do host — por último: tira a máquina do ar */}
      <div style={secao}>
        <PowerControls printer={printer} usuario={usuario} />
      </div>

      {cancelamento.dialogo}

      <Confirm
        aberto={excluindoPeca}
        titulo={t.impressora.excluirPecaCurto}
        descricao={t.impressora.confirmaExcluirPeca(printer.pecaAtual ?? '')}
        rotuloConfirmar={t.impressora.excluirPecaCurto}
        rotuloCancelar={t.comum.voltar}
        onConfirmar={() => {
          setExcluindoPeca(false);
          void api.excluirPecaAtual(printer.id).catch(() => {});
        }}
        onCancelar={() => setExcluindoPeca(false)}
      />
    </div>
  );
}
