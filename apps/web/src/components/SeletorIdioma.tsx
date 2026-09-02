import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { IDIOMAS, codigoDoIdioma, nomeDoIdioma, useIdioma, useT, type Idioma } from '../i18n';

/**
 * Escolha de idioma.
 *
 * Com dois idiomas um botão que alternava bastava; com cinco, alternar exigiria
 * até quatro cliques às cegas para chegar no seu — então vira menu, com a lista
 * inteira visível e cada nome escrito no próprio idioma.
 */
export function SeletorIdioma({ compacto = false }: { compacto?: boolean }) {
  const t = useT();
  const idioma = useIdioma((s) => s.idioma);
  const definirIdioma = useIdioma((s) => s.definirIdioma);
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);

  // clique fora e Esc fecham — um menu preso aberto atrapalha o resto da tela
  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (!caixaRef.current?.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  const escolher = (i: Idioma) => {
    definirIdioma(i);
    setAberto(false);
  };

  return (
    <div ref={caixaRef} style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label={t.idioma.trocar}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        style={{
          width: compacto ? undefined : 40,
          height: 40,
          padding: compacto ? '0 14px' : 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 999,
          border: '1px solid var(--color-neutral-700)',
          background: aberto ? 'var(--color-neutral-900)' : 'transparent',
          color: 'var(--color-neutral-300)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.06em',
          cursor: 'pointer'
        }}
      >
        {codigoDoIdioma(idioma)}
      </button>

      {aberto && (
        <ul
          role="listbox"
          aria-label={t.idioma.trocar}
          style={{
            position: 'absolute',
            top: 46,
            right: 0,
            zIndex: 90,
            listStyle: 'none',
            margin: 0,
            padding: 0,
            minWidth: 176,
            background: 'var(--color-text)',
            /* raio 0: menus fazem parte do que o sistema mantém quadrado */
            border: '2px solid var(--color-neutral-700)'
          }}
        >
          {IDIOMAS.map((i) => {
            const ativo = i === idioma;
            return (
              <li key={i}>
                <button
                  type="button"
                  role="option"
                  aria-selected={ativo}
                  onClick={() => escolher(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '11px 14px',
                    border: 0,
                    borderBottom: '1px solid var(--color-neutral-800)',
                    background: ativo ? 'var(--color-neutral-900)' : 'transparent',
                    color: ativo ? 'var(--color-bg)' : 'var(--color-neutral-300)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'var(--font-body)',
                    fontSize: 13
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      color: 'var(--color-neutral-500)',
                      minWidth: 20
                    }}
                  >
                    {codigoDoIdioma(i)}
                  </span>
                  {/* o nome de cada idioma no próprio idioma: quem não lê o
                      atual precisa reconhecer o seu na lista */}
                  <span style={{ flex: 1 }}>{nomeDoIdioma(i)}</span>
                  {ativo && <Check size={13} strokeWidth={3} aria-hidden style={{ color: 'var(--color-accent)' }} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
