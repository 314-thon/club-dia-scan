const ALLOWED_PREFIXES = [
  'catalog_system/pub/products/search',
  'checkout/pub/pickup-points',
];

interface VercelReq {
  url?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
  json: (body: unknown) => void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  try {
    const rawPath = req.query?.path;
    const subPath = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath ?? '');

    const isAllowed = ALLOWED_PREFIXES.some((prefix) => subPath.startsWith(prefix));
    if (!isAllowed) {
      res.status(403).json({ error: 'Endpoint no permitido en el proxy de Dia.' });
      return;
    }

    const incomingUrl = new URL(req.url || '/', 'https://localhost');
    const upstream = new URL(`https://diaonline.supermercadosdia.com.ar/api/${subPath}`);

    incomingUrl.searchParams.forEach((value, key) => {
      if (key !== 'path') {
        upstream.searchParams.append(key, value);
      }
    });

    const upstreamRes = await fetch(upstream.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/134.0.0.0 Mobile Safari/537.36',
      },
    });

    const text = await upstreamRes.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(upstreamRes.status).send(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al consultar Dia Online';
    res.status(502).json({ error: message });
  }
}
