import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/ds-styles.css';
import './styles/global.css';
import { App } from './App';
import { TooltipProvider } from './components/Tooltip';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // o SSE é a fonte do tempo real; o react-query cuida do resto
      refetchOnWindowFocus: true,
      staleTime: 15_000,
      retry: 1
    }
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
);
