import { Branch, CatalogSnapshot, Product, ProductCategory } from '../types/models';
import { calcDiscountPct, FALLBACK_PRODUCT_IMG } from '../utils/format';
import { getEmbeddedCatalog, isStandaloneHtml } from '../utils/runtime';

const CACHE_KEY_LAST_SYNC = 'clubdia_last_sync_v1';
export const DEFAULT_THUMB_SIZE = 160;

interface VtexOffer {
  Price?: number;
  ListPrice?: number;
  AvailableQuantity?: number;
  PriceValidUntil?: string;
}

interface VtexItem {
  itemId?: string;
  ean?: string;
  nameComplete?: string;
  images?: Array<{ imageUrl?: string }>;
  sellers?: Array<{ commertialOffer?: VtexOffer }>;
}

interface VtexProduct {
  productId?: string;
  productName?: string;
  brand?: string;
  categories?: string[];
  items?: VtexItem[];
}

interface VtexPickupItem {
  distance?: number;
  pickupPoint?: {
    id?: string;
    friendlyName?: string;
    address?: {
      street?: string;
      number?: string;
      city?: string;
      geoCoordinates?: [number, number];
    };
  };
}

export function toVtexThumbUrl(url?: string, size = DEFAULT_THUMB_SIZE): string {
  if (!url) return FALLBACK_PRODUCT_IMG;
  if (!url.includes('/arquivos/ids/')) return url;
  return url.replace(/(\/arquivos\/ids\/\d+)(?:-\d+-\d+)?(\/|\?|$)/, `$1-${size}-${size}$2`);
}

function mapCategory(categories?: string[]): { category: ProductCategory; subtitle: string } {
  const first = categories?.[0] ?? '';
  const segments = first
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  const raw = first.toLowerCase();

  let category: ProductCategory = 'Otros';
  if (
    raw.includes('lácteo') ||
    raw.includes('lacteo') ||
    raw.includes('leche') ||
    raw.includes('yogur') ||
    raw.includes('queso')
  ) {
    category = 'Lácteos';
  } else if (
    raw.includes('almacén') ||
    raw.includes('almacen') ||
    raw.includes('desayuno') ||
    raw.includes('pasta') ||
    raw.includes('aceite') ||
    raw.includes('infusion')
  ) {
    category = 'Almacén';
  } else if (raw.includes('limpieza') || raw.includes('hogar')) {
    category = 'Limpieza';
  } else if (
    raw.includes('bebida') ||
    raw.includes('gaseosa') ||
    raw.includes('agua') ||
    raw.includes('cerveza')
  ) {
    category = 'Bebidas';
  } else if (raw.includes('perfumer') || raw.includes('bebés') || raw.includes('bebes')) {
    category = 'Perfumería';
  } else if (
    raw.includes('fresco') ||
    raw.includes('fruta') ||
    raw.includes('verdura') ||
    raw.includes('carnicer') ||
    raw.includes('congelad')
  ) {
    category = 'Frescos';
  }

  const subtitle =
    segments.length >= 2
      ? `${segments[0]} · ${segments[1]}`
      : segments[0] || 'Catálogo Dia Online';

  return { category, subtitle };
}

function formatValidRange(): string {
  const now = new Date();
  const end = new Date(now);
  end.setDate(now.getDate() + 5);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `Del ${fmt(now)} al ${fmt(end)}`;
}

function normalizeVtexProduct(raw: VtexProduct): Product | null {
  const sku = raw.items?.[0];
  const offer = sku?.sellers?.[0]?.commertialOffer;
  if (!raw.productName || !sku || !offer) return null;

  const price = Math.round(offer.Price ?? 0);
  const listPrice = Math.round(offer.ListPrice ?? price);
  if (price <= 0) return null;

  const effectiveList = listPrice >= price ? listPrice : price;
  const discountPct = calcDiscountPct(effectiveList, price);
  const savings = Math.max(0, effectiveList - price);
  const { category, subtitle } = mapCategory(raw.categories);

  return {
    id: `dia-${raw.productId ?? sku.itemId ?? sku.ean ?? Math.random()}`,
    ean: sku.ean || sku.itemId || '0000000000000',
    name: raw.productName.trim(),
    brand: raw.brand?.trim() || 'Dia',
    category,
    subtitle,
    imageUrl: toVtexThumbUrl(sku.images?.[0]?.imageUrl, DEFAULT_THUMB_SIZE),
    price,
    listPrice: effectiveList,
    discountPct,
    savings,
    validRange: discountPct > 0 ? formatValidRange() : null,
    limitQty: discountPct >= 25 ? 4 : null,
    isHabitual: false,
    source: 'dia-live',
    availableQuantity: offer.AvailableQuantity,
  };
}

export function expandCatalogSnapshot(snapshot: CatalogSnapshot): Product[] {
  const validRange = formatValidRange();
  const categories = snapshot.categories ?? [
    'Almacén',
    'Lácteos',
    'Limpieza',
    'Bebidas',
    'Frescos',
    'Perfumería',
    'Otros',
  ];
  const baseImg = snapshot.imageBaseUrl || '';

  return snapshot.items.map((tuple) => {
    const [ean, name, brand, catIdx, subtitle, compactImg, price, listPrice, availableQuantity] =
      tuple;
    const effectiveList = listPrice >= price ? listPrice : price;
    const discountPct = calcDiscountPct(effectiveList, price);
    const savings = Math.max(0, effectiveList - price);

    let imageUrl = FALLBACK_PRODUCT_IMG;
    if (compactImg) {
      if (compactImg.startsWith('http://') || compactImg.startsWith('https://') || compactImg.startsWith('/')) {
        imageUrl = toVtexThumbUrl(compactImg, DEFAULT_THUMB_SIZE);
      } else {
        imageUrl = `${baseImg}${compactImg}`;
      }
    }

    return {
      id: `dia-${ean}`,
      ean,
      name,
      brand,
      category: categories[catIdx] ?? 'Otros',
      subtitle,
      imageUrl,
      price,
      listPrice: effectiveList,
      discountPct,
      savings,
      validRange: discountPct > 0 ? validRange : null,
      limitQty: discountPct >= 25 ? 4 : null,
      isHabitual: false,
      source: 'dia-live',
      availableQuantity,
    };
  });
}

async function fetchSnapshotFromUrl(
  url: string,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<CatalogSnapshot> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-cache',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      throw new Error('Respuesta no JSON');
    }
    const data = (await res.json()) as CatalogSnapshot;
    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
      throw new Error('Catálogo vacío');
    }
    return data;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function fetchDailyCatalogSnapshot(
  preferLiveApi: boolean,
  signal?: AbortSignal
): Promise<{ snapshot: CatalogSnapshot; source: 'api-catalog' | 'static-snapshot' }> {
  const embedded = getEmbeddedCatalog();
  if (isStandaloneHtml() && embedded) {
    return { snapshot: embedded, source: 'static-snapshot' };
  }
  if (preferLiveApi) {
    try {
      const snapshot = await fetchSnapshotFromUrl('/api/catalog', 18000, signal);
      return { snapshot, source: 'api-catalog' };
    } catch {
      // Fallback to static daily snapshot (e.g. local Vite dev or transient API timeout)
    }
  }
  try {
    const snapshot = await fetchSnapshotFromUrl('/catalog.json', 12000, signal);
    return { snapshot, source: 'static-snapshot' };
  } catch (err) {
    if (embedded) {
      return { snapshot: embedded, source: 'static-snapshot' };
    }
    throw err;
  }
}

export function loadLastSyncTime(): string {
  try {
    return localStorage.getItem(CACHE_KEY_LAST_SYNC) || '07:40';
  } catch {
    return '07:40';
  }
}

export function saveLastSyncTime(syncTime: string): void {
  try {
    localStorage.setItem(CACHE_KEY_LAST_SYNC, syncTime);
  } catch {
    // ignore storage quota errors
  }
}

export async function searchDiaProducts(query: string, signal?: AbortSignal): Promise<Product[]> {
  const clean = query.trim();
  if (!clean) return [];

  const res = await fetch(
    `/api/dia/catalog_system/pub/products/search?ft=${encodeURIComponent(clean)}&_from=0&_to=19`,
    { headers: { Accept: 'application/json' }, signal }
  );
  if (!res.ok) {
    throw new Error(`Error al buscar (${res.status})`);
  }
  const data = (await res.json()) as VtexProduct[];
  if (!Array.isArray(data)) return [];

  return data.map(normalizeVtexProduct).filter((p): p is Product => p !== null);
}

export async function lookupDiaByEan(
  ean: string,
  signal?: AbortSignal,
  timeoutMs = 3800
): Promise<Product | null> {
  const clean = ean.replace(/\D/g, '');
  if (!clean) return null;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch(
      `/api/dia/catalog_system/pub/products/search?fq=alternateIds_Ean:${encodeURIComponent(clean)}`,
      { headers: { Accept: 'application/json' }, signal: controller.signal }
    );
    if (!res.ok) {
      throw new Error(`Error al consultar EAN (${res.status})`);
    }
    const data = (await res.json()) as VtexProduct[];
    if (!Array.isArray(data) || data.length === 0) return null;

    return normalizeVtexProduct(data[0]);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function fetchNearbyDiaBranches(lat: number, lng: number): Promise<Branch[]> {
  const res = await fetch(`/api/dia/checkout/pub/pickup-points?geoCoordinates=${lng};${lat}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Error al buscar sucursales (${res.status})`);
  }
  const payload = (await res.json()) as { items?: VtexPickupItem[] };
  const items = payload.items ?? [];

  const uniqueByName = new Map<string, Branch>();
  for (const entry of items) {
    const pp = entry.pickupPoint;
    if (!pp?.friendlyName) continue;
    const cleanedName = pp.friendlyName
      .replace(/^Retiro\s+(en\s+tienda|al\s+auto)\s*/i, '')
      .trim();
    const displayName = cleanedName || pp.address?.city || pp.friendlyName;
    const key = displayName.toLowerCase();
    if (uniqueByName.has(key)) continue;

    const street = [pp.address?.street, pp.address?.number].filter(Boolean).join(' ').trim();
    const coords = pp.address?.geoCoordinates;

    uniqueByName.set(key, {
      id: `vtex-${pp.id ?? key}`,
      name: displayName,
      address: street || pp.address?.city || 'Sucursal Dia',
      city: pp.address?.city || displayName,
      lng: coords?.[0] ?? lng,
      lat: coords?.[1] ?? lat,
      distanceKm: typeof entry.distance === 'number' ? Number(entry.distance.toFixed(1)) : undefined,
      source: 'dia-live',
    });

    if (uniqueByName.size >= 6) break;
  }

  return Array.from(uniqueByName.values());
}
