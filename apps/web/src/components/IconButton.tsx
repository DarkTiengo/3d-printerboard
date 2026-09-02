import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import s from './IconButton.module.css';

export type VarianteBotao = 'primaria' | 'secundaria' | 'abaAtiva' | 'abaInativa' | 'controle' | 'controlePrimario';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  /** Texto do tooltip. Vira também o aria-label — os dois são sempre o mesmo. */
  rotulo: string;
  icone: ReactNode;
  variante?: VarianteBotao;
  pequeno?: boolean;
  /** Esconde a dica quando o rótulo já aparece ao lado do ícone. */
  semDica?: boolean;
};

/**
 * Botão só-ícone — quase toda ação do app passa por aqui.
 *
 * `rotulo` é obrigatório de propósito: sem ele o app fica inutilizável em leitor
 * de tela, que é o alerta explícito do handoff (design/COMECE_AQUI.md § Cuidados).
 */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { rotulo, icone, variante = 'secundaria', pequeno, semDica, disabled, className, ...resto },
  ref
) {
  const ehControle = variante === 'controle' || variante === 'controlePrimario';

  const classes = [
    s.base,
    ehControle ? s.controle : s[variante],
    variante === 'controlePrimario' ? s.controlePrimario : '',
    pequeno ? s.pequeno : '',
    disabled ? (ehControle ? s.controleDesabilitado : s.desabilitado) : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ');

  const botao = (
    <button ref={ref} type="button" aria-label={rotulo} disabled={disabled} className={classes} {...resto}>
      {icone}
    </button>
  );

  // botão desabilitado não dispara eventos de mouse, então a dica nunca abriria
  if (semDica || disabled) return botao;
  return <Tooltip texto={rotulo}>{botao}</Tooltip>;
});
