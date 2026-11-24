const BASE_API = 'https://diaonline.supermercadosdia.com.ar/api/catalog_system/pub';
const IMAGE_BASE_URL = 'https://ardiaprod.vteximg.com.br/arquivos/ids/';
const THUMB_SIZE = 160;
const PAGE_SIZE = 50;
const MAX_VTEX_OFFSET = 2500;
const CONCURRENCY = 16;

const HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/134.0.0.0 Mobile Safari/537.36',
};

const CATEGORIES = [
  'Almacén',
  'Lácteos',
  'Limpieza',
  'Bebidas',
  'Frescos',
  'Perfumería',
  'Otros',
];

export const config = {
  maxDuration: 60,
};

interface VercelReq {
  url?: string;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
  json: (body: unknown) => void;
}

interface VtexCategory {
  id: number;
  name: string;
}

interface VtexRawProduct {
  productName?: string;
  brand?: string;
  categories?: string[];
  items?: Array<{
    itemId?: string;
    ean?: string;
    nameComplete?: string;
    images?: Array<{ imageUrl?: string }>;
    sellers?: Array<{
      commertialOffer?: {
        Price?: number;
        ListPrice?: number;
        AvailableQuantity?: number;
      };
    }>;
  }>;
}

type CatalogTuple = [string, string, string, number, string, string, number, number, number];

function mapCategoryIndex(categories?: string[]): { catIdx: number; subtitle: string } {
  const first = categories?.[0] ?? '';
  const segments = first
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  const raw = first.toLowerCase();

  let cat = 'Otros';
  if (
    raw.includes('lácteo') ||
    raw.includes('lacteo') ||
    raw.includes('leche') ||
    raw.includes('yogur') ||
    raw.includes('queso')
  ) {
    cat = 'Lácteos';
  } else if (
    raw.includes('almacén') ||
    raw.includes('almacen') ||
    raw.includes('desayuno') ||
    raw.includes('pasta') ||
    raw.includes('aceite') ||
    raw.includes('infusion')
  ) {
    cat = 'Almacén';
  } else if (raw.includes('limpieza') || raw.includes('hogar')) {
    cat = 'Limpieza';
  } else if (
    raw.includes('bebida') ||
    raw.includes('gaseosa') ||
    raw.includes('agua') ||
    raw.includes('cerveza')
  ) {
    cat = 'Bebidas';
  } else if (raw.includes('perfumer') || raw.includes('bebés') || raw.includes('bebes')) {
    cat = 'Perfumería';
  } else if (
    raw.includes('fresco') ||
    raw.includes('fruta') ||
    raw.includes('verdura') ||
    raw.includes('carnicer') ||
    raw.includes('congelad')
  ) {
    cat = 'Frescos';
  }

  const subtitle =
    segments.length >= 2
      ? `${segments[0]} · ${segments[1]}`
      : segments[0] || 'Catálogo Dia Online';

  return { catIdx: CATEGORIES.indexOf(cat), subtitle };
}

function toCompactThumbUrl(url?: string): string {
  if (!url) return '';
  let resized = url;
  if (resized.includes('/arquivos/ids/')) {
    resized = resized.replace(
      /(\/arquivos\/ids\/\d+)(?:-\d+-\d+)?(\/|\?|$)/,
      `$1-${THUMB_SIZE}-${THUMB_SIZE}$2`
    );
  }
  if (resized.startsWith(IMAGE_BASE_URL)) {
    return resized.slice(IMAGE_BASE_URL.length);
  }
  return resized;
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  return { data, resources: res.headers.get('resources') || '' };
}

async function runPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor++;
      results[idx] = await tasks[idx]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

function getArgentinaDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function normalizeValidGtin(raw?: string): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const len = digits.length;
  if (len !== 8 && len !== 12 && len !== 13 && len !== 14) return null;

  let sum = 0;
  let weight = 3;
  for (let i = len - 2; i >= 0; i--) {
    sum += (digits.charCodeAt(i) - 48) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  if (expected !== digits.charCodeAt(len - 1) - 48) return null;

  if (len === 12) return `0${digits}`;
  if (len === 14 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export default async function handler(_req: VercelReq, res: VercelRes) {
  try {
    const { data: categories } = await fetchJson(`${BASE_API}/category/tree/1`);
    if (!Array.isArray(categories) || categories.length === 0) {
      res.status(502).json({ error: 'No se pudo obtener el árbol de categorías de Dia.' });
      return;
    }

    const byEan = new Map<string, CatalogTuple>();

    const ingest = (rawList: unknown) => {
      if (!Array.isArray(rawList)) return;
      for (const raw of rawList as VtexRawProduct[]) {
        if (!raw?.productName || !Array.isArray(raw.items)) continue;
        const { catIdx, subtitle } = mapCategoryIndex(raw.categories);
        const brand = (raw.brand || 'Dia').trim();

        for (const sku of raw.items) {
          const ean = normalizeValidGtin(sku.ean);
          if (!ean) continue;

          const sellers = sku?.sellers ?? [];
          let offer = sellers.find(
            (s) =>
              (s.commertialOffer?.Price ?? 0) > 0 &&
              (s.commertialOffer?.AvailableQuantity ?? 0) > 0
          )?.commertialOffer;
          if (!offer) {
            offer = sellers.find((s) => (s.commertialOffer?.Price ?? 0) > 0)?.commertialOffer;
          }
          if (!offer) continue;

          const price = Math.round(offer.Price ?? 0);
          if (price <= 0) continue;

          const listPriceRaw = Math.round(offer.ListPrice ?? price);
          const listPrice = listPriceRaw >= price ? listPriceRaw : price;

          const avail = Math.round(offer.AvailableQuantity ?? 0);
          const existing = byEan.get(ean);
          if (existing) {
            const existingDiscount = existing[7] - existing[6];
            const newDiscount = listPrice - price;
            if (existing[8] > 0 && avail <= 0) continue;
            if (existingDiscount >= newDiscount && existing[8] >= avail) continue;
          }

          const name = (
            raw.items.length > 1 && sku.nameComplete ? sku.nameComplete : raw.productName
          ).trim();
          const img = toCompactThumbUrl(sku.images?.[0]?.imageUrl);
          byEan.set(ean, [ean, name, brand, catIdx, subtitle, img, price, listPrice, avail]);
        }
      }
    };

    const firstTasks = (categories as VtexCategory[]).map((cat) => async () => {
      const { data, resources } = await fetchJson(
        `${BASE_API}/products/search?fq=C:/${cat.id}/&_from=0&_to=${PAGE_SIZE - 1}`
      );
      ingest(data);
      const total = Number.parseInt(resources.split('/')[1] ?? '0', 10);
      return { id: cat.id, total: Number.isFinite(total) ? total : 0 };
    });

    const catCounts = await runPool(firstTasks, CONCURRENCY);
    const pageTasks: Array<() => Promise<void>> = [];

    for (const cat of catCounts) {
      if (cat.total <= PAGE_SIZE) continue;
      const capped = Math.min(cat.total, MAX_VTEX_OFFSET);
      for (let from = PAGE_SIZE; from < capped; from += PAGE_SIZE) {
        const to = Math.min(from + PAGE_SIZE - 1, capped - 1);
        pageTasks.push(async () => {
          try {
            const { data } = await fetchJson(
              `${BASE_API}/products/search?fq=C:/${cat.id}/&_from=${from}&_to=${to}`
            );
            ingest(data);
          } catch {
            // Skip transient page failure so partial catalog still succeeds
          }
        });
      }
    }

    await runPool(pageTasks, CONCURRENCY);

    const items = Array.from(byEan.values()).sort((a, b) => {
      const pctA = a[7] > a[6] ? (a[7] - a[6]) / a[7] : 0;
      const pctB = b[7] > b[6] ? (b[7] - b[6]) / b[7] : 0;
      if (pctB !== pctA) return pctB - pctA;
      return a[1].localeCompare(b[1], 'es-AR');
    });

    const now = new Date();
    const discountedCount = items.filter((item) => item[7] > item[6]).length;

    const payload = {
      version: getArgentinaDateKey(now),
      generatedAt: now.toISOString(),
      thumbSize: THUMB_SIZE,
      imageBaseUrl: IMAGE_BASE_URL,
      categories: CATEGORIES,
      count: items.length,
      discountedCount,
      items,
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Cached 24h at Vercel CDN edge so the entire fleet refreshes once per day
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
    res.status(200).send(JSON.stringify(payload));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error generando catálogo diario';
    res.status(502).json({ error: message });
  }
}
