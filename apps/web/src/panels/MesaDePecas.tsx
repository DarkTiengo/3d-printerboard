import { useCallback, useEffect, useState } from 'react';
import { PackageX } from 'lucide-react';
import type { MesaDePecas as Mesa, PecaDaMesa } from '@3dfarm/shared';
import { Confirm } from '../components/Confirm';
import { api } from '../lib/api';
import { useT } from '../i18n';

/** O retângulo que o mapa desenha, em mm da mesa. */
type Area = { minX: number; minY: number; largura: number; altura: number };

/**
 * A área do desenho: os limites da máquina quando ela os publica, e o
 * retângulo que envolve as peças quando não. A folga evita que uma peça
 * encostada na borda saia com metade do traço cortado.
 */
function areaDo(mesa: Mesa): Area | null {
  if (mesa.limites) {
    const { minX, minY, maxX, maxY } = mesa.limites;
    return { minX, minY, largura: maxX - minX, altura: maxY - minY };
  }

  const pontos = mesa.pecas.flatMap((p) => (p.contorno.length ? p.contorno : p.centro ? [p.centro] : []));
  if (pontos.length === 0) return null;

  const xs = pontos.map(([x]) => x);
  const ys = pontos.map(([, y]) => y);
  const folga = Math.max(5, (Math.max(...xs) - Math.min(...xs)) * 0.1);
  return {
    minX: Math.min(...xs) - folga,
    minY: Math.min(...ys) - folga,
    largura: Math.max(...xs) - Math.min(...xs) + folga * 2,
    altura: Math.max(...ys) - Math.min(...ys) + folga * 2
  };
}

/**
 * Ponto da mesa → ponto do SVG. O Y da impressora cresce para o fundo e o do
 * SVG para baixo: sem inverter, o mapa sairia espelhado e a peça da frente
 * apareceria atrás — que é o erro que faz alguém excluir a peça errada.
 */
const emTela = (a: Area) => (p: [number, number]) => [p[0] - a.minX, a.minY + a.altura - p[1]] as const;

/** Cor de traço e de preenchimento pelo estado da peça. */
function coresDa(peca: PecaDaMesa, destacada: boolean) {
  if (peca.excluida) return { traco: 'var(--color-neutral-700)', fundo: 'transparent', tracejado: '4 3' };
  if (peca.atual) return { traco: 'var(--color-accent)', fundo: 'var(--color-accent)', tracejado: undefined };
  return {
    traco: destacada ? 'var(--color-bg)' : 'var(--color-neutral-500)',
    fundo: destacada ? 'var(--color-neutral-500)' : 'var(--color-neutral-800)',
    tracejado: undefined
  };
}

/**
 * O mapa da mesa: onde cada peça está, qual o bico faz agora e quais já saíram.
 *
 * A geometria é buscada quando o diálogo abre e não fica no snapshot do SSE —
 * são uns 8 KB por máquina que não mudam durante a impressão inteira, e que
 * quase ninguém abre. Ver design/README.md § 2.
 */
export function MesaDePecas({
  printerId,
  aberto,
  podeControlar,
  aoFechar
}: {
  printerId: string;
  aberto: boolean;
  podeControlar: boolean;
  aoFechar: () => void;
}) {
  const t = useT();
  const [mesa, setMesa] = useState<Mesa | null>(null);
  const [erro, setErro] = useState(false);
  const [destaque, setDestaque] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<PecaDaMesa | null>(null);

  const carregar = useCallback(() => {
    api
      .mesaDePecas(printerId)
      .then((m) => {
        setMesa(m);
        setErro(false);
      })
      .catch(() => setErro(true));
  }, [printerId]);

  /*
   * Busca só na abertura. De fora só entram `aberto` e `carregar`: o painel
   * inteiro se redesenha a cada snapshot do SSE, e depender do `aoFechar` — que
   * nasce de novo a cada render — faria o mapa recarregar quatro vezes por
   * segundo e piscar na mão de quem está tentando clicar numa peça.
   */
  useEffect(() => {
    if (!aberto) return;
    setMesa(null);
    setErro(false);
    setConfirmando(null);
    carregar();
  }, [aberto, carregar]);

  useEffect(() => {
    // com o confirmar aberto o Esc é dele: fechar os dois de uma vez deixaria
    // o operador sem saber se a peça saiu ou não
    if (!aberto || confirmando) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, confirmando, aoFechar]);

  if (!aberto) return null;

  const pecas = mesa?.pecas ?? [];
  const vivas = pecas.filter((p) => !p.excluida).length;
  const area = mesa ? areaDo(mesa) : null;

  /**
   * O Klipper leva um instante para reemitir `excluded_objects`. Marcar na hora
   * e reler depois evita a janela em que o clique parece não ter feito nada.
   */
  const excluir = (peca: PecaDaMesa) => {
    setConfirmando(null);
    setMesa((m) =>
      m ? { ...m, pecas: m.pecas.map((p) => (p.nome === peca.nome ? { ...p, excluida: true, atual: false } : p)) } : m
    );
    void api
      .excluirPeca(printerId, peca.nome)
      .catch(() => setErro(true))
      .finally(() => setTimeout(carregar, 1200));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.impressora.pecasDaMesa}
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(20, 19, 18, 0.72)'
      }}
    >
      <div
        style={{
          width: 'min(720px, 100%)',
          maxHeight: '100%',
          overflow: 'auto',
          background: 'var(--color-text)',
          color: 'var(--color-bg)',
          border: '2px solid var(--color-neutral-700)',
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 style={{ fontSize: 22, letterSpacing: '-0.01em' }}>{t.impressora.pecasDaMesa}</h2>
          {mesa && pecas.length > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-400)' }}>
              {t.impressora.pecasContagem(vivas, pecas.length)}
            </span>
          )}
          <button
            type="button"
            onClick={aoFechar}
            style={{
              marginLeft: 'auto',
              border: '1px solid var(--color-neutral-700)',
              background: 'transparent',
              color: 'var(--color-bg)',
              borderRadius: 999,
              padding: '9px 18px',
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            {t.comum.voltar}
          </button>
        </div>

        {!mesa && !erro && <div className="mono">{t.comum.carregando}</div>}
        {erro && <div style={{ fontSize: 14, color: 'var(--color-accent-400)' }}>{t.impressora.mesaFalhou}</div>}
        {mesa && pecas.length === 0 && (
          <div style={{ fontSize: 14, color: 'var(--color-neutral-300)' }}>{t.impressora.mesaVazia}</div>
        )}

        {mesa && area && pecas.length > 0 && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <svg
              viewBox={`0 0 ${area.largura} ${area.altura}`}
              role="img"
              aria-label={t.impressora.pecasDaMesa}
              style={{
                flex: '1 1 300px',
                maxWidth: 360,
                aspectRatio: `${area.largura} / ${area.altura}`,
                background: 'var(--color-neutral-900)',
                border: '1px solid var(--color-neutral-700)'
              }}
            >
              {pecas.map((peca, i) => {
                const mapear = emTela(area);
                const cor = coresDa(peca, destaque === peca.nome);
                const centro = peca.centro ? mapear(peca.centro) : null;
                const comum = {
                  fill: cor.fundo,
                  fillOpacity: peca.atual ? 0.35 : 0.55,
                  stroke: cor.traco,
                  strokeWidth: peca.atual || destaque === peca.nome ? 2.5 : 1.5,
                  strokeDasharray: cor.tracejado,
                  vectorEffect: 'non-scaling-stroke' as const,
                  style: { cursor: podeControlar && !peca.excluida ? 'pointer' : 'default' },
                  onMouseEnter: () => setDestaque(peca.nome),
                  onMouseLeave: () => setDestaque(null),
                  onClick: () => podeControlar && !peca.excluida && setConfirmando(peca)
                };

                return (
                  <g key={peca.nome}>
                    {peca.contorno.length >= 3 ? (
                      <polygon points={peca.contorno.map(mapear).map(([x, y]) => `${x},${y}`).join(' ')} {...comum} />
                    ) : centro ? (
                      // sem contorno: o fatiador mandou só o centro, e um ponto
                      // ainda diz de que lado da mesa a peça está
                      <circle cx={centro[0]} cy={centro[1]} r={area.largura * 0.02} {...comum} />
                    ) : null}
                    {centro && (
                      <text
                        x={centro[0]}
                        y={centro[1]}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={area.largura * 0.035}
                        fill={peca.excluida ? 'var(--color-neutral-600)' : 'var(--color-bg)'}
                        style={{ pointerEvents: 'none', fontFamily: 'var(--font-mono)' }}
                      >
                        {i + 1}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            <ul
              style={{
                flex: '1 1 260px',
                listStyle: 'none',
                margin: 0,
                padding: 0,
                maxHeight: 360,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}
            >
              {pecas.map((peca, i) => (
                <li key={peca.nome}>
                  <button
                    type="button"
                    disabled={!podeControlar || peca.excluida}
                    onClick={() => setConfirmando(peca)}
                    onMouseEnter={() => setDestaque(peca.nome)}
                    onMouseLeave={() => setDestaque(null)}
                    onFocus={() => setDestaque(peca.nome)}
                    onBlur={() => setDestaque(null)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      textAlign: 'left',
                      border: 0,
                      background: destaque === peca.nome ? 'var(--color-neutral-800)' : 'transparent',
                      color: peca.excluida ? 'var(--color-neutral-600)' : 'var(--color-bg)',
                      padding: '7px 8px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      cursor: !podeControlar || peca.excluida ? 'default' : 'pointer',
                      textDecoration: peca.excluida ? 'line-through' : undefined
                    }}
                  >
                    <span style={{ color: 'var(--color-neutral-500)', minWidth: 20 }}>{i + 1}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {peca.nome}
                    </span>
                    {(peca.atual || peca.excluida) && (
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: peca.atual ? 'var(--color-accent-400)' : 'var(--color-neutral-600)'
                        }}
                      >
                        {peca.atual ? t.impressora.pecaEmCurso : t.impressora.pecaExcluida}
                      </span>
                    )}
                    {!peca.excluida && podeControlar && (
                      <PackageX size={14} strokeWidth={2} aria-hidden style={{ flex: 'none', opacity: 0.6 }} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Confirm
        aberto={!!confirmando}
        titulo={t.impressora.excluirPecaCurto}
        descricao={t.impressora.confirmaExcluirPeca(confirmando?.nome ?? '')}
        rotuloConfirmar={t.impressora.excluirPecaCurto}
        rotuloCancelar={t.comum.voltar}
        onConfirmar={() => confirmando && excluir(confirmando)}
        onCancelar={() => setConfirmando(null)}
      />
    </div>
  );
}
