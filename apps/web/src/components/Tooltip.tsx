import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

/**
 * Dica de um botão só-ícone.
 *
 * O texto aqui é o mesmo do `aria-label` do gatilho — nunca só visual.
 * Ver design/README.md § Botões com dica em vez de rótulo.
 */
export function Tooltip({ texto, children }: { texto: string; children: ReactNode }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side="bottom"
          sideOffset={6}
          style={{
            background: 'var(--color-neutral-900)',
            color: 'var(--color-bg)',
            border: '1px solid var(--color-neutral-700)',
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            /* raio 0: painéis, cards e dicas não são arredondados neste sistema */
            borderRadius: 0,
            zIndex: 60,
            maxWidth: 260
          }}
        >
          {texto}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
