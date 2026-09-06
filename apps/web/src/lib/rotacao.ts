import type { RotacaoCamera } from '@3dfarm/shared';

/**
 * Girar a imagem de uma câmera montada de lado — sem tocar no quadro.
 *
 * A rotação acontece no navegador, na hora de desenhar: nenhum byte a mais sai
 * da impressora e o servidor não reprocessa nada. O preço é que ela vale só
 * onde o app desenha — o JPEG guardado com um alerta, e o que vai para o
 * Telegram, continuam como a câmera mandou.
 *
 * Meia-volta é fácil: gira no lugar. O quarto de volta troca largura e altura,
 * e o `object-fit: cover` precisa das medidas do contêiner trocadas junto —
 * senão sobra faixa vazia dos dois lados. `cqw` e `cqh` são exatamente essas
 * medidas, o que resolve em CSS o que de outro jeito exigiria medir o elemento
 * em JavaScript e remedir a cada mudança de tamanho da janela.
 */
export function estiloDoQuadro(rotacao: RotacaoCamera): React.CSSProperties {
  // `size` é o que faz `cqw`/`cqh` existirem para os filhos; só o quarto de
  // volta precisa, e a contenção não é de graça
  return rotacao === 90 || rotacao === 270 ? { containerType: 'size' } : {};
}

const BASE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block'
};

/** Estilo da imagem dentro de um quadro com `estiloDoQuadro` aplicado. */
export function estiloDaImagem(rotacao: RotacaoCamera): React.CSSProperties {
  if (rotacao === 0) return BASE;
  if (rotacao === 180) return { ...BASE, transform: 'rotate(180deg)' };
  return {
    ...BASE,
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '100cqh',
    height: '100cqw',
    transform: `translate(-50%, -50%) rotate(${rotacao}deg)`
  };
}
