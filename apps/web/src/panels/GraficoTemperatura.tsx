import { useEffect, useRef, useState } from 'react';
import type { HistoricoDeTemperatura, SerieDeTemperatura, Temperatura } from '@gridfarm/shared';
import { HISTORICO_JANELA_S } from '@gridfarm/shared';
import { Dobravel } from '../components/Dobravel';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { useFormato } from '../i18n/formato';
import { useUi } from '../store/ui';
import { rotuloDoSensor } from './TempList';

/**
 * Cor por posição na lista. A ordem vem do servidor e é sempre a mesma —
 * extrusoras, mesa, câmara, ventoinhas —, então o bico é sempre o vermelho e a
 * mesa sempre a linha clara, em qualquer máquina.
 */
const CORES = [
  'var(--color-accent-500)',
  'var(--color-neutral-300)',
  'var(--color-accent-300)',
  'var(--color-neutral-500)',
  'var(--color-accent-2-500)'
];

/** Nunca menos que isto de faixa vertical, em °C. */
const FAIXA_MINIMA = 10;

/**
 * Valores → caminho SVG num espaço de 0 a 100, nos dois eixos.
 *
 * Os buracos quebram o traço em vez de serem interpolados: um `null` quer
 * dizer que não havia leitura ali, e ligar os dois lados desenharia uma
 * temperatura que ninguém mediu.
 */
export function caminho(valores: (number | null)[], min: number, max: number): string {
  const alcance = max - min || 1;
  const passoX = valores.length > 1 ? 100 / (valores.length - 1) : 0;
  let d = '';
  let levantado = true;
  valores.forEach((v, i) => {
    if (v == null) {
      levantado = true;
      return;
    }
    const x = (i * passoX).toFixed(2);
    const y = (100 - ((v - min) / alcance) * 100).toFixed(2);
    d += `${levantado ? 'M' : 'L'}${x},${y}`;
    levantado = false;
  });
  return d;
}

/** A faixa vertical do desenho, com folga e um mínimo para não achatar tudo. */
export function faixaDe(series: SerieDeTemperatura[]): { min: number; max: number } {
  const valores = series
    .flatMap((s) => [...s.atuais, ...(s.alvos ?? [])])
    .filter((v): v is number => v != null);
  if (valores.length === 0) return { min: 0, max: FAIXA_MINIMA };

  let min = Math.min(...valores);
  let max = Math.max(...valores);
  if (max - min < FAIXA_MINIMA) {
    const meio = (max + min) / 2;
    min = meio - FAIXA_MINIMA / 2;
    max = meio + FAIXA_MINIMA / 2;
  }
  const folga = (max - min) * 0.08;
  return { min: Math.max(0, Math.floor(min - folga)), max: Math.ceil(max + folga) };
}

/**
 * O aquecimento dos últimos dez minutos.
 *
 * A curva cheia é o que o sensor leu; a tracejada, o que foi pedido a ele —
 * juntas são o que responde "está subindo?", "estabilizou?" e "caiu sozinho?",
 * que é o que a lista de números ao lado não tem como mostrar.
 *
 * O passado vem do `server.temperature_store` do Moonraker, buscado uma vez ao
 * abrir. Dali em diante a curva anda com os valores que o SSE já traz: emendar
 * é de graça, e recarregar a série inteira a cada poucos segundos não seria.
 *
 * Só quem aquece entra. O MCU e o Raspberry marcando 40 °C constantes no mesmo
 * eixo de um bico a 250 achatariam justamente as curvas que se veio ver.
 */
export function GraficoTemperatura({
  printerId,
  temperaturas,
  online
}: {
  printerId: string;
  temperaturas: Temperatura[];
  online: boolean;
}) {
  const t = useT();
  const f = useFormato();
  const aberto = useUi((s) => s.graficoAberto);
  const alternar = useUi((s) => s.alternarGrafico);

  const [hist, setHist] = useState<HistoricoDeTemperatura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Quando o último ponto foi emendado — o passo é o mesmo do histórico. */
  const emendadoEm = useRef(0);

  useEffect(() => {
    if (!aberto) return;
    if (!online) {
      setHist(null);
      setErro(t.impressora.graficoOffline);
      return;
    }
    let vivo = true;
    setErro(null);
    api
      .historicoDeTemperatura(printerId)
      .then((h) => {
        if (!vivo) return;
        emendadoEm.current = Date.now();
        setHist(h);
      })
      .catch(() => vivo && setErro(t.impressora.graficoFalhou));
    return () => {
      vivo = false;
    };
  }, [printerId, aberto, online, t]);

  /*
   * Emenda um ponto por intervalo, com o valor que o snapshot já trouxe. A
   * janela não cresce: entra à direita, sai à esquerda. Sem isto o gráfico
   * ficaria congelado no instante em que foi aberto.
   */
  useEffect(() => {
    if (!hist || !online) return;
    const agora = Date.now();
    if (agora - emendadoEm.current < hist.intervalo * 1000) return;
    emendadoEm.current = agora;
    setHist((h) =>
      h
        ? {
            ...h,
            fim: agora,
            series: h.series.map((s) => {
              const atual = temperaturas.find((x) => x.chave === s.chave);
              return {
                ...s,
                atuais: [...s.atuais.slice(1), atual?.atual ?? null],
                alvos: s.alvos ? [...s.alvos.slice(1), atual?.alvo ?? null] : null
              };
            })
          }
        : h
    );
  }, [temperaturas, hist, online]);

  const series = hist?.series ?? [];
  const { min, max } = faixaDe(series);

  return (
    <Dobravel
      titulo={t.impressora.aquecimento}
      aberto={aberto}
      aoAlternar={alternar}
      legenda={t.impressora.graficoJanela(Math.round(HISTORICO_JANELA_S / 60))}
    >
      {erro && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-500)' }}>{erro}</div>}
      {!erro && !hist && <div className="mono">{t.comum.carregando}</div>}
      {!erro && hist && series.length === 0 && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-500)' }}>
          {t.impressora.graficoVazio}
        </div>
      )}

      {series.length > 0 && (
        <>
          <div
            style={{
              position: 'relative',
              height: 128,
              background: 'var(--color-neutral-900)',
              border: '1px solid var(--color-neutral-800)'
            }}
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={t.impressora.aquecimento}
              style={{ display: 'block', width: '100%', height: '100%' }}
            >
              {series.map((s, i) => {
                const cor = CORES[i % CORES.length];
                return (
                  <g key={s.chave}>
                    {s.alvos && (
                      <path
                        d={caminho(s.alvos, min, max)}
                        fill="none"
                        stroke={cor}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        strokeOpacity={0.55}
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    <path
                      d={caminho(s.atuais, min, max)}
                      fill="none"
                      stroke={cor}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
            </svg>
            {/* os rótulos ficam fora do SVG: com preserveAspectRatio="none" o
                texto sairia esticado junto com o desenho */}
            <span style={rotuloEixo(2)}>{max} °C</span>
            <span style={rotuloEixo(undefined, 2)}>{min} °C</span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {series.map((s, i) => {
              const atual = temperaturas.find((x) => x.chave === s.chave);
              return (
                <span
                  key={s.chave}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--color-neutral-400)'
                  }}
                >
                  <span
                    aria-hidden
                    style={{ width: 10, height: 2, background: CORES[i % CORES.length], flex: 'none' }}
                  />
                  {rotuloDoSensor(
                    { chave: s.chave, rotulo: s.rotulo, tipo: s.tipo, atual: null, alvo: null, min: null, max: null },
                    t
                  )}
                  <span style={{ color: 'var(--color-bg)' }}>{f.temperatura(atual?.atual ?? null)}</span>
                </span>
              );
            })}
          </div>
        </>
      )}
    </Dobravel>
  );
}

/** Rótulo flutuante do eixo Y, encostado num dos cantos esquerdos. */
function rotuloEixo(top?: number, bottom?: number): React.CSSProperties {
  return {
    position: 'absolute',
    left: 5,
    top,
    bottom,
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    color: 'var(--color-neutral-600)',
    pointerEvents: 'none'
  };
}
