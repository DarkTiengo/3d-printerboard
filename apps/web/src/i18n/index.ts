import { useEffect } from 'react';
import { create } from 'zustand';
import { pt, type Dicionario } from './pt';
import { en } from './en';

export type Idioma = 'pt' | 'en';

const DICIONARIOS: Record<Idioma, Dicionario> = { pt, en };
const CHAVE = 'printerboard.idioma';

/** Primeira escolha: o que já foi salvo; depois, o idioma do navegador. */
function idiomaInicial(): Idioma {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === 'pt' || salvo === 'en') return salvo;
  } catch {
    /* modo privado sem storage */
  }
  const navegador = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : '';
  return navegador.startsWith('pt') ? 'pt' : 'en';
}

type Estado = {
  idioma: Idioma;
  definirIdioma: (i: Idioma) => void;
};

export const useIdioma = create<Estado>((set) => ({
  idioma: idiomaInicial(),
  definirIdioma: (idioma) => {
    try {
      localStorage.setItem(CHAVE, idioma);
    } catch {
      /* segue sem persistir */
    }
    set({ idioma });
  }
}));

/** Dicionário do idioma ativo. Uso: `const t = useT(); t.login.entrar`. */
export function useT(): Dicionario {
  return DICIONARIOS[useIdioma((s) => s.idioma)];
}

export const IDIOMAS: Idioma[] = ['pt', 'en'];

export function nomeDoIdioma(i: Idioma): string {
  return DICIONARIOS[i].idioma.nome;
}

export function codigoDoIdioma(i: Idioma): string {
  return DICIONARIOS[i].idioma.codigo;
}

/** Mantém o `lang` do documento em dia — leitores de tela e o navegador usam. */
export function useLangDoDocumento(): void {
  const idioma = useIdioma((s) => s.idioma);
  useEffect(() => {
    document.documentElement.lang = idioma === 'pt' ? 'pt-BR' : 'en';
  }, [idioma]);
}

/** Locale para Intl — datas e números seguem o idioma escolhido. */
export function localeDe(i: Idioma): string {
  return i === 'pt' ? 'pt-BR' : 'en-US';
}
