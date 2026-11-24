import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../public/catalog.json');

const BASE_API = 'https://diaonline.supermercadosdia.com.ar/api/catalog_system/pub';
const IMAGE_BASE_URL = 'https://ardiaprod.vteximg.com.br/arquivos/ids/';
const THUMB_SIZE = 160;
const PAGE_SIZE = 50;
const MAX_VTEX_OFFSET = 2500;
const CONCURRENCY = 10;

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

function mapCategoryIndex(categories) {
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

function toCompactThumbUrl(url) {
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

async function fetchJsonWithRetry(url, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const data = await res.json();
      return { data, resources: res.headers.get('resources') || '' };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastErr;
}

function parseTotalFromResources(resourcesHeader) {
  const parts = resourcesHeader.split('/');
  const total = Number.parseInt(parts[1] ?? '0', 10);
  return Number.isFinite(total) ? total : 0;
}

async function runPool(tasks, concurrency) {
  const results = [];
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

function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeValidGtin(raw) {
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

async function main() {
  const startedAt = Date.now();
  console.log('Consultando árbol de categorías de Dia Online...');

  const { data: categories } = await fetchJsonWithRetry(`${BASE_API}/category/tree/1`);
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error('No se pudieron obtener categorías de Dia Online.');
  }

  const byEan = new Map();

  function ingestProducts(rawList) {
    if (!Array.isArray(rawList)) return;
    for (const raw of rawList) {
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

        const existing = byEan.get(ean);
        const avail = Math.round(offer.AvailableQuantity ?? 0);
        // Prefer entry with stock or bigger discount if duplicate EAN appears
        if (existing) {
          const existingDiscount = existing[7] - existing[6];
          const newDiscount = listPrice - price;
          if (existing[8] > 0 && avail <= 0) continue;
          if (existingDiscount >= newDiscount && existing[8] >= avail) continue;
        }

        const name = (raw.items.length > 1 && sku.nameComplete ? sku.nameComplete : raw.productName).trim();
        const img = toCompactThumbUrl(sku.images?.[0]?.imageUrl);

        byEan.set(ean, [
          ean,
          name,
          brand,
          catIdx,
          subtitle,
          img,
          price,
          listPrice,
          avail,
        ]);
      }
    }
  }

  // First page of every top-level category to discover exact counts
  const firstPageTasks = categories.map((cat) => async () => {
    const url = `${BASE_API}/products/search?fq=C:/${cat.id}/&_from=0&_to=${PAGE_SIZE - 1}`;
    const { data, resources } = await fetchJsonWithRetry(url);
    const total = parseTotalFromResources(resources);
    ingestProducts(data);
    return { id: cat.id, name: cat.name, total };
  });

  const catCounts = await runPool(firstPageTasks, CONCURRENCY);

  // Build remaining pagination tasks across all categories
  const pageTasks = [];
  for (const cat of catCounts) {
    if (cat.total <= PAGE_SIZE) continue;
    const cappedTotal = Math.min(cat.total, MAX_VTEX_OFFSET);
    for (let from = PAGE_SIZE; from < cappedTotal; from += PAGE_SIZE) {
      const to = Math.min(from + PAGE_SIZE - 1, cappedTotal - 1);
      pageTasks.push(async () => {
        const url = `${BASE_API}/products/search?fq=C:/${cat.id}/&_from=${from}&_to=${to}`;
        const { data } = await fetchJsonWithRetry(url);
        ingestProducts(data);
      });
    }
  }

  console.log(
    `Categorías detectadas: ${catCounts.filter((c) => c.total > 0).length} con stock. Descargando ${pageTasks.length} páginas adicionales...`
  );
  await runPool(pageTasks, CONCURRENCY);

  // Sort: discounted products first (highest % first), then alphabetically
  const items = Array.from(byEan.values()).sort((a, b) => {
    const pctA = a[7] > a[6] ? (a[7] - a[6]) / a[7] : 0;
    const pctB = b[7] > b[6] ? (b[7] - b[6]) / b[7] : 0;
    if (pctB !== pctA) return pctB - pctA;
    return a[1].localeCompare(b[1], 'es-AR');
  });

  const now = new Date();
  const discountedCount = items.filter((item) => item[7] > item[6]).length;
  const payload = {
    version: getLocalDateKey(now),
    generatedAt: now.toISOString(),
    thumbSize: THUMB_SIZE,
    imageBaseUrl: IMAGE_BASE_URL,
    categories: CATEGORIES,
    count: items.length,
    discountedCount,
    items,
  };

  const jsonStr = JSON.stringify(payload);
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, jsonStr, 'utf8');

  const gzipBytes = gzipSync(Buffer.from(jsonStr, 'utf8')).length;
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `OK: ${items.length} productos (${discountedCount} con descuento) guardados en public/catalog.json en ${elapsedSec}s.`
  );
  console.log(
    `Peso: ${(Buffer.byteLength(jsonStr, 'utf8') / 1024).toFixed(0)} KB crudo | ${(gzipBytes / 1024).toFixed(0)} KB gzip.`
  );
}

main().catch((err) => {
  console.error('Error sincronizando catálogo:', err);
  process.exit(1);
});
