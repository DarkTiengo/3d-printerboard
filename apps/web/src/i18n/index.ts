import { useEffect } from 'react';
import { create } from 'zustand';
import { pt, type Dicionario } from './pt';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';

export type Idioma = 'en' | 'pt' | 'es' | 'fr' | 'it';

const DICIONARIOS: Record<Idioma, Dicionario> = { en, pt, es, fr, it };

const LOCALES: Record<Idioma, string> = {
  en: 'en-US',
  pt: 'pt-BR',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT'
};
const CHAVE = 'printerboard.idioma';

/** Primeira escolha: o que já foi salvo; depois, o idioma do navegador. */
function idiomaInicial(): Idioma {
  try {
    const salvo = localStorage.getItem(CHAVE) as Idioma | null;
    if (salvo && salvo in DICIONARIOS) return salvo;
  } catch {
    /* modo privado sem storage */
  }
  // o navegador manda em ordem de preferência; a primeira que conhecemos vence
  const preferidas = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const tag of preferidas) {
    const base = String(tag).toLowerCase().split('-')[0] as Idioma;
    if (base in DICIONARIOS) return base;
  }
  return 'en';
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

/** Ordem em que aparecem no menu. */
export const IDIOMAS: Idioma[] = ['en', 'pt', 'es', 'fr', 'it'];

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
    document.documentElement.lang = LOCALES[idioma];
  }, [idioma]);
}

/** Locale para Intl — datas e números seguem o idioma escolhido. */
export function localeDe(i: Idioma): string {
  return LOCALES[i];
}
