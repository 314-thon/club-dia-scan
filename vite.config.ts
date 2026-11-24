import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveGeocodeCandidates } from './api/geocode';

const diaProxy = {
  '/api/dia': {
    target: 'https://diaonline.supermercadosdia.com.ar',
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/api\/dia/, '/api'),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/134.0.0.0 Mobile Safari/537.36',
      Accept: 'application/json',
    },
  },
};

function localGeocodePlugin(): Plugin {
  const attachMiddleware = (middlewares: {
    use: (
      route: string,
      fn: (
        req: { url?: string; method?: string },
        res: {
          statusCode: number;
          setHeader: (k: string, v: string) => void;
          end: (body: string) => void;
        },
        next: () => void
      ) => void
    ) => void;
  }) => {
    middlewares.use('/api/geocode', (req, res, next) => {
      if (req.method && req.method !== 'GET') {
        next();
        return;
      }
      const parsed = new URL(req.url || '', 'http://localhost');
      const q = (parsed.searchParams.get('q') ?? '').trim();
      const lat = Number(parsed.searchParams.get('lat'));
      const lng = Number(parsed.searchParams.get('lng'));

      resolveGeocodeCandidates(
        q,
        Number.isFinite(lat) ? lat : undefined,
        Number.isFinite(lng) ? lng : undefined
      )
        .then((items) => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ items }));
        })
        .catch((err) => {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Error al geocodificar',
              items: [],
            })
          );
        });
    });
  };

  return {
    name: 'club-dia-local-geocode',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), localGeocodePlugin()],
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
