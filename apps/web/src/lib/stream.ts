import { useEffect } from 'react';
import type { StreamEvent } from '@3dfarm/shared';
import { usePrinters } from '../store/printers';
import { urlDaApi } from './api';

/**
 * Assina o SSE do servidor enquanto o app estiver logado.
 *
 * O EventSource reconecta sozinho, então não montamos backoff aqui — só
 * refletimos o estado da conexão para a UI poder avisar que está desatualizada.
 */
export function useStream(ativo: boolean): void {
  const aplicarEvento = usePrinters((s) => s.aplicarEvento);
  const definirConectado = usePrinters((s) => s.definirConectado);

  useEffect(() => {
    if (!ativo) return;

    const es = new EventSource(urlDaApi('/api/stream'), { withCredentials: true });

    es.onopen = () => definirConectado(true);
    es.onerror = () => definirConectado(false);
    es.onmessage = (ev) => {
      try {
        aplicarEvento(JSON.parse(ev.data) as StreamEvent);
      } catch {
        // linha malformada não deve derrubar o stream inteiro
      }
    };

    return () => {
      es.close();
      definirConectado(false);
    };
  }, [ativo, aplicarEvento, definirConectado]);
}
