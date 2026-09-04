import { useState } from 'react';
import { Power, RotateCcw } from 'lucide-react';
import type { Printer, User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { Confirm } from '../components/Confirm';
import { api } from '../lib/api';
import { useT } from '../i18n';

type Acao = 'reiniciar' | 'desligar';

/**
 * Energia do host da impressora — o computador que roda Klipper e Moonraker,
 * não o firmware.
 *
 * Fica no fim do painel de propósito: são as duas ações que tiram a máquina do
 * ar, e não devem dividir espaço com os controles de impressão que se usam o
 * dia inteiro. Ambas continuam valendo com o Klipper caído — `machine.*` é
 * respondido pelo Moonraker —, que é justamente quando servem para alguma
 * coisa; o que precisa estar de pé é o host.
 */
export function PowerControls({ printer, usuario }: { printer: Printer; usuario: User }) {
  const t = useT();
  const [confirmando, setConfirmando] = useState<Acao | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const permissao = {
    reiniciar: pode(usuario.role, 'reiniciarMaquina'),
    desligar: pode(usuario.role, 'desligarMaquina')
  };
  const imprimindo = printer.status === 'imprimindo' || printer.status === 'pausada';

  async function executar(acao: Acao) {
    setConfirmando(null);
    try {
      await (acao === 'reiniciar' ? api.reiniciarMaquina(printer.id) : api.desligarMaquina(printer.id));
    } catch (err) {
      // o servidor devolve a recusa do Moonraker; ela diz mais que um genérico
      setFalha(err instanceof Error ? err.message : t.impressora.falhaEnergia);
    }
  }

  return (
    <>
      <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="mono">{t.impressora.maquina}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <BotaoEnergia
            Icone={RotateCcw}
            texto={t.impressora.reiniciarCurto}
            rotulo={permissao.reiniciar ? t.impressora.reiniciar : t.impressora.reiniciarSemPermissao}
            desabilitado={!permissao.reiniciar || !printer.online}
            onClick={() => setConfirmando('reiniciar')}
          />
          <BotaoEnergia
            Icone={Power}
            texto={t.impressora.desligarCurto}
            rotulo={permissao.desligar ? t.impressora.desligar : t.impressora.desligarSemPermissao}
            desabilitado={!permissao.desligar || !printer.online}
            onClick={() => setConfirmando('desligar')}
          />
        </div>
      </section>

      <Confirm
        aberto={confirmando !== null}
        titulo={confirmando === 'desligar' ? t.impressora.desligar : t.impressora.reiniciar}
        descricao={
          confirmando === 'desligar'
            ? t.impressora.confirmaDesligar(printer.nome, imprimindo)
            : t.impressora.confirmaReiniciar(printer.nome, imprimindo)
        }
        rotuloConfirmar={
          confirmando === 'desligar' ? t.impressora.desligarCurto : t.impressora.reiniciarCurto
        }
        onConfirmar={() => confirmando && void executar(confirmando)}
        onCancelar={() => setConfirmando(null)}
      />

      <Confirm
        aberto={falha !== null}
        titulo={t.impressora.falhaEnergia}
        descricao={falha}
        rotuloConfirmar={t.comum.entendi}
        perigoso={false}
        semCancelar
        onConfirmar={() => setFalha(null)}
        onCancelar={() => setFalha(null)}
      />
    </>
  );
}

/** Mesma pílula das macros, com o ícone em vermelho só quando está ativa. */
function BotaoEnergia({
  Icone,
  texto,
  rotulo,
  desabilitado,
  onClick
}: {
  Icone: typeof Power;
  texto: string;
  rotulo: string;
  desabilitado: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      disabled={desabilitado}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        border: `1px solid ${desabilitado ? 'var(--color-neutral-800)' : 'var(--color-neutral-700)'}`,
        borderRadius: 999,
        background: 'transparent',
        color: desabilitado ? 'var(--color-neutral-700)' : 'var(--color-bg)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.04em',
        padding: '9px 12px',
        cursor: desabilitado ? 'not-allowed' : 'pointer',
        minWidth: 0
      }}
    >
      <Icone
        size={12}
        strokeWidth={2}
        aria-hidden
        style={{ color: desabilitado ? 'var(--color-neutral-700)' : 'var(--color-accent)', flex: 'none' }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{texto}</span>
    </button>
  );
}
