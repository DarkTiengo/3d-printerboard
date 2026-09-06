import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import type { Temperatura } from '@3dfarm/shared';
import { EXTRUSAO_MM_S } from '@3dfarm/shared';
import { Tooltip } from '../components/Tooltip';
import { useUi } from '../store/ui';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { celulaDeControle, estiloDePasso } from './JogPad';

/**
 * Quanto anda a cada clique.
 *
 * 1 mm afina a primeira camada, 10 mm é a purga de sempre e 50 mm é o que
 * empurra o filamento do acoplador até o bico numa troca. Nada além disso: o
 * servidor recusa acima de 100 mm, e carregar filamento é trabalho de macro.
 */
const PASSOS = [1, 5, 10, 50];

/**
 * Extrusora — empurrar e recolher filamento à mão.
 *
 * Fica logo abaixo da cabeça de impressão porque é o mesmo gesto: mover um
 * motor de propósito, com a máquina parada. E é o controle que exige um bico
 * quente — abaixo do `min_extrude_temp` os botões ficam apagados com o motivo
 * escrito, em vez de deixarem a pessoa clicar e receber um erro de G-code.
 */
export function Extrusora({
  printerId,
  temperaturas,
  minExtrusao,
  imprimindo,
  desabilitado
}: {
  printerId: string;
  temperaturas: Temperatura[];
  minExtrusao: number | null;
  /** Impressão andando: o `G1 E` entraria no meio do arquivo e estragaria a peça. */
  imprimindo: boolean;
  desabilitado: boolean;
}) {
  const t = useT();
  const passo = useUi((s) => s.passoExtrusao);
  const definirPasso = useUi((s) => s.definirPassoExtrusao);
  const [erro, setErro] = useState<string | null>(null);

  const bico = temperaturas.find((temp) => temp.chave === 'extruder');
  // sem `min_extrude_temp` conhecido não dá para afirmar que está frio: aí
  // quem recusa é o Klipper, e a mensagem dele aparece na linha de erro
  const frio = minExtrusao != null && (bico?.atual ?? 0) < minExtrusao;
  const travado = desabilitado || imprimindo || frio;

  /* Um motivo só, o mais próximo de quem está olhando: sem permissão nem vale
     a pena explicar o bico. */
  const motivo = desabilitado
    ? null
    : imprimindo
      ? t.impressora.extrusaoImprimindo
      : frio
        ? t.impressora.extrusaoFria(minExtrusao!)
        : null;

  const mover = (sinal: 1 | -1) => () => {
    setErro(null);
    void api.extrudar(printerId, sinal * passo).catch((err) => {
      setErro(err instanceof Error ? err.message : t.impressora.falhaExtrusao);
    });
  };

  const botao = (rotulo: string, icone: React.ReactNode, onClick: () => void) => (
    <Tooltip texto={rotulo}>
      <button
        type="button"
        aria-label={rotulo}
        onClick={onClick}
        disabled={travado}
        style={{
          ...celulaDeControle,
          ...(travado
            ? { borderColor: 'var(--color-neutral-800)', color: 'var(--color-neutral-700)', cursor: 'not-allowed' }
            : {})
        }}
      >
        {icone}
      </button>
    </Tooltip>
  );

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mono">{t.impressora.extrusora}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {botao(
          t.impressora.retrair(passo),
          <ArrowUpFromLine size={15} strokeWidth={2} aria-hidden />,
          mover(-1)
        )}
        {botao(
          t.impressora.extrudar(passo),
          <ArrowDownToLine size={15} strokeWidth={2} aria-hidden />,
          mover(1)
        )}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-500)' }}>
          {t.impressora.velocidadeExtrusao(EXTRUSAO_MM_S)}
        </span>
      </div>

      <div>
        <div className="mono" style={{ marginBottom: 6 }}>
          {t.impressora.quantidade}
        </div>
        <div role="group" aria-label={t.impressora.quantidadeGrupo} style={{ display: 'flex', gap: 4 }}>
          {PASSOS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => definirPasso(v)}
              aria-pressed={passo === v}
              style={estiloDePasso(passo === v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {motivo && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-500)' }}>
          {motivo}
        </div>
      )}
      {erro && (
        <div role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-accent-400)' }}>
          {erro}
        </div>
      )}
    </section>
  );
}
