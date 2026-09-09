/**
 * O punhado de coisas que o navegador guarda: o idioma escolhido e o último
 * usuário que entrou. Nada sensível — a sessão é um cookie assinado.
 *
 * As chaves nasceram com o prefixo `printerboard.`, do nome antigo do projeto.
 * Renomear para GridFarm sem mais nada faria cada pessoa reencontrar a tela em
 * inglês e o campo de usuário vazio, por uma razão que não é dela. Então a
 * leitura tenta a chave nova e, achando só a velha, regrava no lugar certo e
 * apaga a antiga: uma migração que acontece uma vez por navegador, sem pedir
 * nada a ninguém.
 *
 * Tudo dentro de try/catch porque em aba anônima o próprio acesso ao
 * localStorage pode lançar — e ficar sem a preferência é aceitável, ficar sem
 * a tela não é.
 */

const PREFIXO = 'gridfarm.';
const PREFIXO_ANTIGO = 'printerboard.';

export function lerGuardado(chave: string): string | null {
  try {
    const atual = localStorage.getItem(PREFIXO + chave);
    if (atual !== null) return atual;

    const antigo = localStorage.getItem(PREFIXO_ANTIGO + chave);
    if (antigo === null) return null;
    // acha uma vez, muda de lugar para sempre
    localStorage.setItem(PREFIXO + chave, antigo);
    localStorage.removeItem(PREFIXO_ANTIGO + chave);
    return antigo;
  } catch {
    return null;
  }
}

export function gravarGuardado(chave: string, valor: string): void {
  try {
    localStorage.setItem(PREFIXO + chave, valor);
  } catch {
    /* segue sem persistir */
  }
}

export function apagarGuardado(chave: string): void {
  try {
    localStorage.removeItem(PREFIXO + chave);
    localStorage.removeItem(PREFIXO_ANTIGO + chave);
  } catch {
    /* segue sem persistir */
  }
}
