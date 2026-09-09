import { useEffect, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { LinhaConsole, TomDaLinha } from '@gridfarm/shared';
import { tomDaLinha } from '@gridfarm/shared';
import { Dobravel } from '../components/Dobravel';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { useFormato } from '../i18n/formato';
import { useConsole, usePrinters } from '../store/printers';
import { useUi } from '../store/ui';

/** Cor de cada tom. O `!!` do Klipper é o que se procura ao abrir o console. */
const CORES: Record<TomDaLinha, string> = {
  comando: 'var(--color-neutral-400)',
  erro: 'var(--color-accent-400)',
  aviso: 'var(--color-neutral-300)',
  normal: 'var(--color-bg)'
};

/** Quantos pixels do fim ainda contam como "está no fim". */
const GRUDE_PX = 24;

/**
 * O console da impressora — o que ela diz, e o que se diz a ela.
 *
 * As linhas vêm de duas fontes que se emendam: o apanhado que o servidor
 * guarda (buscado ao abrir, e que inclui o que o Moonraker registrou antes de
 * este app subir) e as novas, que chegam pelo SSE em rajadas. Por isso o
 * console de uma máquina que caiu continua legível: é justamente a última
 * coisa que ela disse que explica a queda.
 *
 * O que sai daqui e o que sai das macros aparece como comando; o jog, a
 * extrusão e os alvos de temperatura não — são gestos repetidos aos montes, e
 * o `SAVE_GCODE_STATE` de cada clique de seta afogaria o que se veio ler.
 */
export function Console({
  printerId,
  online,
  podeControlar
}: {
  printerId: string;
  online: boolean;
  podeControlar: boolean;
}) {
  const t = useT();
  const f = useFormato();
  const aberto = useUi((s) => s.consoleAberto);
  const alternar = useUi((s) => s.alternarConsole);
  const linhas = useConsole(printerId);
  const definirConsole = usePrinters((s) => s.definirConsole);

  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  /* O que já foi mandado, para as setas do teclado — um console sem histórico
     obriga a redigitar `SET_HEATER_TEMPERATURE HEATER=extruder TARGET=210`. */
  const enviados = useRef<string[]>([]);
  const cursor = useRef(-1);

  const caixa = useRef<HTMLDivElement>(null);
  /* Rolar para o fim a cada linha nova, a não ser que a pessoa tenha subido
     para ler algo — aí mexer no scroll seria arrancar o texto da vista. */
  const grudado = useRef(true);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    api
      .console(printerId)
      .then((r) => vivo && definirConsole(printerId, r.linhas))
      .catch(() => vivo && setErro(t.impressora.consoleFalhou));
    return () => {
      vivo = false;
    };
  }, [printerId, aberto, definirConsole, t]);

  useEffect(() => {
    const el = caixa.current;
    if (el && grudado.current) el.scrollTop = el.scrollHeight;
  }, [linhas, aberto]);

  const enviar = () => {
    const script = texto.trim();
    if (!script) return;
    setTexto('');
    setErro(null);
    enviados.current = [...enviados.current.filter((c) => c !== script), script].slice(-30);
    cursor.current = -1;
    // a resposta da máquina — inclusive o `!!` de um comando recusado — chega
    // pelo console; aqui só se relata o que impediu o comando de sair daqui
    void api.gcode(printerId, script).catch((err) => {
      setErro(err instanceof Error ? err.message : t.impressora.consoleFalhouEnviar);
    });
  };

  /** Setas percorrem o que já foi mandado, do mais recente para o mais antigo. */
  const navegar = (passo: 1 | -1) => {
    const lista = enviados.current;
    if (lista.length === 0) return;
    const proximo = Math.min(lista.length - 1, Math.max(-1, cursor.current + passo));
    cursor.current = proximo;
    setTexto(proximo < 0 ? '' : lista[lista.length - 1 - proximo]);
  };

  const dica = !podeControlar ? t.comum.semPermissao : !online ? t.impressora.consoleOffline : t.impressora.consoleDica;

  return (
    <Dobravel
      titulo={t.impressora.console}
      aberto={aberto}
      aoAlternar={alternar}
      legenda={linhas.length > 0 ? t.impressora.consoleLinhas(linhas.length) : undefined}
    >
      <div
        ref={caixa}
        onScroll={() => {
          const el = caixa.current;
          if (el) grudado.current = el.scrollHeight - el.scrollTop - el.clientHeight < GRUDE_PX;
        }}
        role="log"
        aria-label={t.impressora.console}
        style={{
          height: 168,
          overflowY: 'auto',
          overflowX: 'hidden',
          background: 'var(--color-neutral-900)',
          border: '1px solid var(--color-neutral-800)',
          padding: '8px 10px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          lineHeight: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1
        }}
      >
        {linhas.length === 0 && <span style={{ color: 'var(--color-neutral-600)' }}>{t.impressora.consoleVazio}</span>}
        {linhas.map((linha, i) => (
          <Linha key={`${linha.em}-${i}`} linha={linha} hora={f.relogio(linha.em)} />
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
        style={{ display: 'flex', gap: 6 }}
      >
        <input
          type="text"
          value={texto}
          disabled={!podeControlar || !online}
          placeholder={dica}
          aria-label={t.impressora.consoleDica}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              navegar(1);
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              navegar(-1);
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '7px 9px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            background: 'transparent',
            border: `1px solid var(--color-neutral-${podeControlar && online ? '700' : '800'})`,
            color: `var(--color-${podeControlar && online ? 'bg' : 'neutral-700'})`,
            cursor: podeControlar && online ? 'text' : 'not-allowed'
          }}
        />
        <button
          type="submit"
          disabled={!podeControlar || !online || !texto.trim()}
          aria-label={t.impressora.consoleEnviar}
          title={t.impressora.consoleEnviar}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            flex: 'none',
            border: '1px solid var(--color-neutral-700)',
            background: 'transparent',
            color: texto.trim() && podeControlar && online ? 'var(--color-bg)' : 'var(--color-neutral-700)',
            cursor: texto.trim() && podeControlar && online ? 'pointer' : 'not-allowed'
          }}
        >
          <SendHorizontal size={14} strokeWidth={2} aria-hidden />
        </button>
      </form>

      {erro && (
        <div role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-accent-400)' }}>
          {erro}
        </div>
      )}
    </Dobravel>
  );
}

/**
 * Uma linha: a hora, e o texto na cor do tom. `pre-wrap` porque as respostas
 * do Klipper vêm alinhadas com espaços — a tabela de um `BED_MESH_CALIBRATE`
 * sem isso viraria uma única linha corrida.
 */
function Linha({ linha, hora }: { linha: LinhaConsole; hora: string }) {
  const tom = tomDaLinha(linha);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--color-neutral-700)', flex: 'none' }}>{hora}</span>
      <span
        style={{
          color: CORES[tom],
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          minWidth: 0,
          fontWeight: tom === 'erro' ? 700 : 400
        }}
      >
        {tom === 'comando' ? `› ${linha.texto}` : linha.texto}
      </span>
    </div>
  );
}
