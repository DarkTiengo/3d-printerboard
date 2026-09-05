import { useState, type ReactNode } from 'react';
import type { Printer } from '@3dfarm/shared';
import { Confirm } from './Confirm';
import { useT } from '../i18n';

/**
 * Pergunta antes de cancelar uma impressão.
 *
 * O botão aparece em dois lugares — no painel da máquina e em cada quadrante
 * da tela de câmeras, onde o dedo passa perto o tempo todo — e o clique não
 * tem desfazer: a peça se perde e a impressão recomeça do zero. Cada lugar
 * desenha o botão do seu jeito, então o que se compartilha aqui é o diálogo,
 * que é idêntico nos dois.
 */
export function useConfirmarCancelamento(
  printer: Printer,
  cancelar: () => void
): { pedir: () => void; dialogo: ReactNode } {
  const t = useT();
  const [aberto, setAberto] = useState(false);

  const dialogo = (
    <Confirm
      aberto={aberto}
      titulo={t.impressora.cancelar}
      descricao={t.impressora.confirmaCancelar(printer.nome, printer.job, printer.pct)}
      rotuloConfirmar={t.impressora.cancelar}
      rotuloCancelar={t.comum.voltar}
      onConfirmar={() => {
        setAberto(false);
        cancelar();
      }}
      onCancelar={() => setAberto(false)}
    />
  );

  return { pedir: () => setAberto(true), dialogo };
}
