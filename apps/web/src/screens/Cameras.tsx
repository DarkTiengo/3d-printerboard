import { Pause, Play, X } from 'lucide-react';
import type { Printer, User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { usePrinters, usePrintersVisiveis } from '../store/printers';
import { useUi } from '../store/ui';
import { CameraFeed } from '../components/CameraFeed';
import { IconButton } from '../components/IconButton';
import { Ponto } from '../components/Tag';
import { controlesHabilitados, corDoPonto, rotuloStatus, rotuloRestante } from '../lib/status';
import { useT } from '../i18n';
import { useFormato } from '../i18n/formato';
import { api } from '../lib/api';

/**
 * Câmeras — design/README.md § 3.
 * Quadrante 2×2 na altura disponível e tira de miniaturas rolável embaixo.
 */
export function Cameras({ usuario }: { usuario: User }) {
  const t = useT();
  const printers = usePrintersVisiveis();
  const camFoco = useUi((s) => s.camFoco);
  const focarCamera = useUi((s) => s.focarCamera);

  // o foco define o início do quadrante, para "expandir" no painel cair aqui
  const inicio = Math.max(0, printers.findIndex((p) => p.id === camFoco));
  const quadrante = printers.slice(inicio, inicio + 4);
  const faltam = 4 - quadrante.length;
  const visiveis = faltam > 0 ? [...quadrante, ...printers.slice(0, faltam)] : quadrante;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: 2,
          padding: 2
        }}
      >
        {visiveis.map((p, i) => (
          /* um MJPEG ao vivo por vez: o quadrante em foco. Os outros três vão
             por snapshot a 4 fps, senão as 4 conexões persistentes + o SSE
             ocupam quase todo o limite de 6 do navegador. */
          <Quadrante key={p.id} printer={p} usuario={usuario} aoVivo={i === 0} />
        ))}
        {visiveis.length === 0 && (
          <div style={{ gridColumn: '1 / -1', display: 'grid', placeItems: 'center' }}>
            <span className="mono">{t.cameras.nenhuma}</span>
          </div>
        )}
      </div>

      <div
        style={{
          flex: 'none',
          borderTop: '2px solid var(--color-neutral-700)',
          display: 'flex',
          gap: 2,
          padding: 2,
          overflowX: 'auto'
        }}
      >
        {printers.map((p) => {
          const emFoco = visiveis.some((v) => v.id === p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => focarCamera(p.id)}
              aria-pressed={emFoco}
              aria-label={t.cameras.verNoQuadrante(p.nome)}
              style={{
                width: 150,
                flex: 'none',
                position: 'relative',
                aspectRatio: '16 / 10',
                border: 0,
                padding: 0,
                background: 'var(--color-neutral-900)',
                cursor: 'pointer',
                outline: emFoco ? '2px solid var(--color-accent)' : '2px solid transparent',
                outlineOffset: -2
              }}
            >
              {/* a tira toda por snapshot, bem devagar */}
              <CameraFeed printerId={p.id} temCamera={p.temTaCamera} fps={0.5} alt="" />
              <span
                style={{
                  position: 'absolute',
                  left: 7,
                  bottom: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textShadow: '0 1px 3px rgba(0,0,0,.85)'
                }}
              >
                CAM {p.id}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Quadrante({ printer, usuario, aoVivo }: { printer: Printer; usuario: User; aoVivo: boolean }) {
  const t = useT();
  const f = useFormato();
  const otimista = usePrinters((s) => s.otimista);
  const habilitado = controlesHabilitados(printer.status);
  const podeControlar = pode(usuario.role, 'controlarImpressao') && printer.online;

  const comandar = (status: Printer['status'], chamada: () => Promise<unknown>) => () => {
    otimista(printer.id, status);
    void chamada().catch(() => {});
  };

  return (
    <div style={{ position: 'relative', minHeight: 0, background: 'var(--color-neutral-900)' }}>
      <CameraFeed
        printerId={printer.id}
        temCamera={printer.temTaCamera}
        fps={aoVivo ? 15 : 4}
        modo={aoVivo ? 'stream' : 'snapshot'}
        observarVisibilidade={false}
        alt={t.painel.cameraDe(printer.nome)}
      />

      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          textShadow: '0 1px 3px rgba(0,0,0,.85)'
        }}
      >
        <Ponto cor={corDoPonto(printer.status, printer.online)} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em' }}>CAM {printer.id}</span>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '30px 14px 12px',
          background: 'linear-gradient(transparent, rgba(32,30,29,.92) 55%)',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 17,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {printer.nome}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-300)' }}>
            {printer.online
              ? `${printer.pct}% · ${rotuloRestante(printer, t, f)}`
              : `${t.status.offline} · ${rotuloStatus(printer.status, t).toLowerCase()}`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <IconButton
            rotulo={t.impressora.pausar}
            variante="secundaria"
            pequeno
            disabled={!habilitado.pausar || !podeControlar}
            onClick={comandar('pausada', () => api.pausar(printer.id))}
            icone={<Pause size={14} strokeWidth={2} aria-hidden />}
            style={{ background: 'rgba(32,30,29,.55)' }}
          />
          <IconButton
            rotulo={t.impressora.continuar}
            variante={habilitado.continuar && podeControlar ? 'primaria' : 'secundaria'}
            pequeno
            disabled={!habilitado.continuar || !podeControlar}
            onClick={comandar('imprimindo', () => api.continuar(printer.id))}
            icone={<Play size={14} strokeWidth={2} aria-hidden />}
          />
          <IconButton
            rotulo={t.impressora.cancelar}
            variante="secundaria"
            pequeno
            disabled={!habilitado.cancelar || !podeControlar}
            onClick={comandar('cancelada', () => api.cancelar(printer.id))}
            icone={<X size={14} strokeWidth={2} aria-hidden />}
            style={{ background: 'rgba(32,30,29,.55)' }}
          />
        </div>
      </div>
    </div>
  );
}
