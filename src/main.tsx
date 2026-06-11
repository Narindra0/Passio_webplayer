import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AudioProvider } from './contexts/AudioContext';
import { LibraryModeProvider } from './contexts/LibraryModeContext';
import './styles/global.css';

// Protection anti-inspection (barrière psychologique)
(function preventInspection() {
  // Bloque le clic droit
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Bloque les raccourcis clavier d'inspection
  document.addEventListener('keydown', (e) => {
    // F12
    if (e.key === 'F12') {
      e.preventDefault();
      return;
    }
    // Ctrl+Shift+I / J / C  (DevTools, Console, Inspect)
    if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) {
      e.preventDefault();
      return;
    }
    // Ctrl+U (View Source)
    if (e.ctrlKey && e.key.toUpperCase() === 'U') {
      e.preventDefault();
      return;
    }
  });

  // Détection furtive DevTools via la différence de taille d'écran
  const devtoolsDetect = () => {
    const threshold = 160;
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    if (widthDiff > threshold || heightDiff > threshold) {
      document.title = '🚫 Pass\'io — Inspection détectée';
    }
  };
  setInterval(devtoolsDetect, 2000);
})();

// Registre le Service Worker généré par vite-plugin-pwa
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LibraryModeProvider>
          <AudioProvider>
            <App />
          </AudioProvider>
        </LibraryModeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
