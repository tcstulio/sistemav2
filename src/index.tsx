import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/design-tokens.css';
import './index.css';
import App from './components/App';
import AdminApp from './components/AdminApp';
import { DolibarrProvider } from './context/DolibarrContext';
import { WhatsAppProvider } from './contexts/WhatsAppContext';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installReportCapture } from './utils/reportContext';
import { initSentry } from './utils/sentry';
import { ConfirmProvider } from './hooks/useConfirm';
import { PromptProvider } from './hooks/usePrompt';

// Monitoramento de erros (no-op sem VITE_SENTRY_DSN). Inicializa antes de tudo.
initSentry();

// Captura global de erros/falhas p/ o botão "Reportar problema" (instala cedo).
installReportCapture();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const queryClient = new QueryClient();

const isMonitor = window.location.pathname.startsWith('/monitor') || window.location.pathname.startsWith('/admin');

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DolibarrProvider>
        <WhatsAppProvider>
          <ConfirmProvider>
            <PromptProvider>
              {isMonitor ? <AdminApp /> : <App />}
            </PromptProvider>
          </ConfirmProvider>
        </WhatsAppProvider>
      </DolibarrProvider>
    </QueryClientProvider>
  </React.StrictMode>
);