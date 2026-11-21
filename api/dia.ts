const ALLOWED_PREFIXES = [
  'catalog_system/pub/products/search',
  'checkout/pub/pickup-points',
];

export async function GET(request: Request): Promise<Response> {
  try {
    const incomingUrl = new URL(request.url);
    const subPath = incomingUrl.searchParams
      .getAll('path')
      .join('/')
      .replace(/^\/+/, '');

    const isAllowed =
      !subPath.includes('..') &&
      ALLOWED_PREFIXES.some((prefix) => subPath === prefix || subPath.startsWith(`${prefix}/`));

    if (!isAllowed) {
      return Response.json(
        { error: 'Endpoint no permitido en el proxy de Dia.' },
        { status: 403 }
      );
    }

    const upstream = new URL(`https://diaonline.supermercadosdia.com.ar/api/${subPath}`);

    incomingUrl.searchParams.forEach((value, key) => {
      if (key !== 'path') {
        upstream.searchParams.append(key, value);
      }
    });

    const upstreamRes = await fetch(upstream.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/134.0.0.0 Mobile Safari/537.36',
      },
    });

    const text = await upstreamRes.text();
    return new Response(text, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al consultar Dia Online';
    console.error('[api/dia]', message);
    return Response.json({ error: message }, { status: 502 });
  }
}
