import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { isStandaloneHtml } from './utils/runtime';

// Conditional polyfill for native <input type="checkbox" switch> (modern-web-guidance: switch)
if (typeof HTMLInputElement !== 'undefined' && !('switch' in HTMLInputElement.prototype)) {
  void Promise.all([
    import('input-switch-polyfill/input-switch-polyfill.css'),
    import('input-switch-polyfill'),
  ]);
}

// Register offline-first PWA Service Worker (only on HTTP/HTTPS builds, not standalone HTML)
if ('serviceWorker' in navigator && import.meta.env.PROD && !isStandaloneHtml()) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch(() => {
        // ignore SW registration errors
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
