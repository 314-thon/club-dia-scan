import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const diaProxy = {
  '/api/dia': {
    target: 'https://diaonline.supermercadosdia.com.ar',
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/api\/dia/, '/api'),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/134.0.0.0 Mobile Safari/537.36',
      Accept: 'application/json',
    },
  },
};

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['input-switch-polyfill'],
  },
  server: {
    port: 5173,
    proxy: diaProxy,
  },
  preview: {
    port: 4173,
    proxy: diaProxy,
  },
  build: {
    target: 'esnext',
  },
});
