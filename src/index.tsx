import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App';
import AdminApp from './components/AdminApp';
import { DolibarrProvider } from './context/DolibarrContext';
import { WhatsAppProvider } from './contexts/WhatsAppContext';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
          {isMonitor ? <AdminApp /> : <App />}
        </WhatsAppProvider>
      </DolibarrProvider>
    </QueryClientProvider>
  </React.StrictMode>
);