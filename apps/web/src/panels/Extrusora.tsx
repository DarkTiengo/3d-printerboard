import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Download, Upload } from 'lucide-react';
import type { Temperatura } from '@gridfarm/shared';
import { EXTRUSAO_VELOCIDADES, MACROS_CARREGAR, MACROS_DESCARREGAR, acharMacro } from '@gridfarm/shared';
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
 * servidor recusa acima de 100 mm, e trocar o rolo é trabalho de macro.
 */
const PASSOS = [1, 5, 10, 50];

/**
 * Extrusora — empurrar e recolher filamento à mão, e chamar a troca de rolo.
 *
 * Fica logo abaixo da cabeça de impressão porque é o mesmo gesto: mover um
 * motor de propósito, com a máquina parada. E é o controle que exige um bico
 * quente — abaixo do `min_extrude_temp` os botões ficam apagados com o motivo
 * escrito, em vez de deixarem a pessoa clicar e receber um erro de G-code.
 */
export function Extrusora({
  printerId,
  temperaturas,
  macros,
  minExtrusao,
  imprimindo,
  desabilitado
}: {
  printerId: string;
  temperaturas: Temperatura[];
  /** As macros que a máquina reporta — é delas que sai a troca de filamento. */
  macros: string[];
  minExtrusao: number | null;
  /** Impressão andando: o `G1 E` entraria no meio do arquivo e estragaria a peça. */
  imprimindo: boolean;
  desabilitado: boolean;
}) {
  const t = useT();
  const passo = useUi((s) => s.passoExtrusao);
  const definirPasso = useUi((s) => s.definirPassoExtrusao);
  const velocidade = useUi((s) => s.velocidadeExtrusao);
  const definirVelocidade = useUi((s) => s.definirVelocidadeExtrusao);
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
    void api.extrudar(printerId, sinal * passo, velocidade).catch((err) => {
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

  const pilulas = (
    rotuloGrupo: string,
    valores: number[],
    atual: number,
    aoEscolher: (v: number) => void
  ) => (
    <div role="group" aria-label={rotuloGrupo} style={{ display: 'flex', gap: 4 }}>
      {valores.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => aoEscolher(v)}
          aria-pressed={atual === v}
          style={estiloDePasso(atual === v)}
        >
          {v}
        </button>
      ))}
    </div>
  );

  return (
    <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mono">{t.impressora.extrusora}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <div>
          <div className="mono" style={{ marginBottom: 6 }}>
            {t.impressora.quantidade}
          </div>
          {pilulas(t.impressora.quantidadeGrupo, PASSOS, passo, definirPasso)}
        </div>
        <div>
          <div className="mono" style={{ marginBottom: 6 }}>
            {t.impressora.velocidade}
          </div>
          {pilulas(t.impressora.velocidadeGrupo, EXTRUSAO_VELOCIDADES, velocidade, definirVelocidade)}
        </div>
      </div>

      {motivo && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-500)' }}>
          {motivo}
        </div>
      )}

      <TrocaDeFilamento
        printerId={printerId}
        macros={macros}
        bloqueado={desabilitado || imprimindo}
        aoFalhar={setErro}
        aoTentar={() => setErro(null)}
      />

      {erro && (
        <div role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-accent-400)' }}>
          {erro}
        </div>
      )}
    </section>
  );
}

/**
 * Carregar e descarregar filamento.
 *
 * Chamam a macro da própria impressora, e não uma sequência montada aqui: o
 * comprimento do bowden, o aquecimento e a formação da ponta estão no
 * printer.cfg da máquina, e não há como adivinhá-los daqui — 80 mm de uma
 * direct drive não carregam uma bowden de 450. Máquina sem a macro mostra os
 * botões apagados dizendo qual falta, que é mais útil que não mostrar nada.
 *
 * O bico frio não trava estes dois de propósito: a maioria dessas macros
 * começa aquecendo. Se a de alguém não aquecer, quem recusa é o Klipper e a
 * mensagem dele aparece na linha de erro.
 */
function TrocaDeFilamento({
  printerId,
  macros,
  bloqueado,
  aoFalhar,
  aoTentar
}: {
  printerId: string;
  macros: string[];
  bloqueado: boolean;
  aoFalhar: (msg: string) => void;
  aoTentar: () => void;
}) {
  const t = useT();
  const carregar = acharMacro(macros, MACROS_CARREGAR);
  const descarregar = acharMacro(macros, MACROS_DESCARREGAR);

  const chamar = (macro: string) => () => {
    aoTentar();
    void api.gcode(printerId, macro).catch((err) => {
      aoFalhar(err instanceof Error ? err.message : t.impressora.falhaExtrusao);
    });
  };

  const botao = (macro: string | null, rotulo: string, faltando: string, icone: React.ReactNode) => {
    const inativo = bloqueado || !macro;
    return (
      <Tooltip texto={macro ?? t.impressora.semMacro(faltando)}>
        <button
          type="button"
          disabled={inativo}
          onClick={macro ? chamar(macro) : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            border: `1px solid ${inativo ? 'var(--color-neutral-800)' : 'var(--color-neutral-700)'}`,
            borderRadius: 999,
            background: 'transparent',
            color: inativo ? 'var(--color-neutral-700)' : 'var(--color-bg)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.04em',
            padding: '9px 12px',
            cursor: inativo ? 'not-allowed' : 'pointer',
            minWidth: 0
          }}
        >
          {icone}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rotulo}</span>
        </button>
      </Tooltip>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {botao(
        carregar,
        t.impressora.carregarFilamento,
        MACROS_CARREGAR[0],
        <Download size={12} strokeWidth={2} aria-hidden style={{ flex: 'none' }} />
      )}
      {botao(
        descarregar,
        t.impressora.descarregarFilamento,
        MACROS_DESCARREGAR[0],
        <Upload size={12} strokeWidth={2} aria-hidden style={{ flex: 'none' }} />
      )}
    </div>
  );
}
