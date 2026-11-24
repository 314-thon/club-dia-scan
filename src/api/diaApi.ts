import { Branch, CatalogSnapshot, Product, ProductCategory } from '../types/models';
import { calcDiscountPct, FALLBACK_PRODUCT_IMG } from '../utils/format';
import { getEmbeddedCatalog, isStandaloneHtml } from '../utils/runtime';

const CACHE_KEY_LAST_SYNC = 'clubdia_last_sync_v1';
export const DEFAULT_THUMB_SIZE = 160;

export type EanLookupOutcome =
  | { status: 'found'; product: Product }
  | { status: 'not-found' }
  | { status: 'error'; reason: 'timeout' | 'network' | 'http'; message: string };

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
      neighborhood?: string;
      city?: string;
      state?: string;
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

function findMatchingSkuAndOffer(
  items: VtexItem[] | undefined,
  targetEan?: string
): { sku: VtexItem; offer: VtexOffer } | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  const cleanTarget = targetEan ? targetEan.replace(/\D/g, '') : '';
  const targetVariants = new Set<string>();
  if (cleanTarget) {
    targetVariants.add(cleanTarget);
    if (cleanTarget.length === 13 && cleanTarget.startsWith('0')) {
      targetVariants.add(cleanTarget.slice(1));
    } else if (cleanTarget.length === 12) {
      targetVariants.add(`0${cleanTarget}`);
    }
  }

  const orderedSkus = cleanTarget
    ? [
        ...items.filter((it) => {
          const skuDigits = (it.ean ?? '').replace(/\D/g, '');
          return skuDigits && targetVariants.has(skuDigits);
        }),
        ...items.filter((it) => {
          const skuDigits = (it.ean ?? '').replace(/\D/g, '');
          return !skuDigits || !targetVariants.has(skuDigits);
        }),
      ]
    : items;

  for (const sku of orderedSkus) {
    const sellers = sku.sellers ?? [];
    // Preferir seller con stock disponible y precio > 0; si no, cualquier seller con precio > 0
    let fallbackOffer: VtexOffer | null = null;
    for (const seller of sellers) {
      const offer = seller?.commertialOffer;
      if (!offer || Math.round(offer.Price ?? 0) <= 0) continue;
      if ((offer.AvailableQuantity ?? 0) > 0) {
        return { sku, offer };
      }
      if (!fallbackOffer) {
        fallbackOffer = offer;
      }
    }
    if (fallbackOffer) {
      return { sku, offer: fallbackOffer };
    }
  }

  return null;
}

function normalizeVtexProduct(raw: VtexProduct, targetEan?: string): Product | null {
  if (!raw.productName) return null;
  const matched = findMatchingSkuAndOffer(raw.items, targetEan);
  if (!matched) return null;

  const { sku, offer } = matched;
  const price = Math.round(offer.Price ?? 0);
  const listPrice = Math.round(offer.ListPrice ?? price);
  if (price <= 0) return null;

  const effectiveList = listPrice >= price ? listPrice : price;
  const discountPct = calcDiscountPct(effectiveList, price);
  const savings = Math.max(0, effectiveList - price);
  const { category, subtitle } = mapCategory(raw.categories);

  const rawSkuEan = (sku.ean ?? '').replace(/\D/g, '');
  const canonicalEan =
    rawSkuEan.length === 12 ? `0${rawSkuEan}` : rawSkuEan || targetEan || sku.itemId || '0000000000000';

  const displayName =
    (raw.items?.length ?? 0) > 1 && sku.nameComplete
      ? sku.nameComplete.trim()
      : raw.productName.trim();

  return {
    id: `dia-${raw.productId ?? sku.itemId ?? canonicalEan}`,
    ean: canonicalEan,
    name: displayName,
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
      if (
        compactImg.startsWith('http://') ||
        compactImg.startsWith('https://') ||
        compactImg.startsWith('/')
      ) {
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

  return data.map((item) => normalizeVtexProduct(item)).filter((p): p is Product => p !== null);
}

async function fetchSingleEanAttempt(
  eanDigits: string,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<EanLookupOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch(
      `/api/dia/catalog_system/pub/products/search?fq=alternateIds_Ean:${encodeURIComponent(eanDigits)}`,
      { headers: { Accept: 'application/json' }, signal: controller.signal }
    );
    if (!res.ok && res.status !== 206) {
      return {
        status: 'error',
        reason: 'http',
        message: `Dia Online respondió con código ${res.status}.`,
      };
    }
    const data = (await res.json()) as VtexProduct[];
    if (!Array.isArray(data) || data.length === 0) {
      return { status: 'not-found' };
    }
    for (const raw of data) {
      const normalized = normalizeVtexProduct(raw, eanDigits);
      if (normalized) {
        return { status: 'found', product: normalized };
      }
    }
    return { status: 'not-found' };
  } catch (err) {
    if (externalSignal?.aborted) {
      throw err;
    }
    if (timedOut) {
      return {
        status: 'error',
        reason: 'timeout',
        message: 'La consulta a Dia Online tardó demasiado.',
      };
    }
    return {
      status: 'error',
      reason: 'network',
      message: 'No pudimos conectar con Dia Online en este momento.',
    };
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Consulta un EAN en vivo contra Dia Online con timeout de 6 s, 1 reintento ante falla transitoria
 * y soporte automático para variantes UPC-A (12 vs 13 dígitos).
 */
export async function lookupDiaByEanOutcome(
  candidates: string | string[],
  signal?: AbortSignal,
  timeoutMs = 6000
): Promise<EanLookupOutcome> {
  const list = (Array.isArray(candidates) ? candidates : [candidates])
    .map((c) => c.replace(/\D/g, ''))
    .filter(Boolean);
  if (list.length === 0) return { status: 'not-found' };

  let lastError: EanLookupOutcome | null = null;

  for (const ean of list) {
    let outcome = await fetchSingleEanAttempt(ean, timeoutMs, signal);
    if (outcome.status === 'error' && !signal?.aborted) {
      // 1 reintento breve ante cold start o microcorte de señal móvil
      outcome = await fetchSingleEanAttempt(ean, timeoutMs, signal);
    }
    if (outcome.status === 'found') {
      return outcome;
    }
    if (outcome.status === 'error') {
      lastError = outcome;
    }
  }

  return lastError ?? { status: 'not-found' };
}

export async function lookupDiaByEan(
  ean: string,
  signal?: AbortSignal,
  timeoutMs = 6000
): Promise<Product | null> {
  const outcome = await lookupDiaByEanOutcome(ean, signal, timeoutMs);
  return outcome.status === 'found' ? outcome.product : null;
}

function formatStreetCase(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (!collapsed) return '';
  // Si viene todo en mayúsculas ("AV ALVAREZ THOMAS 3210"), pasar a Title Case legible
  const isAllCaps = collapsed === collapsed.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(collapsed);
  const base = isAllCaps ? collapsed.toLowerCase() : collapsed;
  const lowerWords = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y']);

  return base
    .split(' ')
    .map((word, idx) => {
      const clean = word.replace(/\.$/, '').toLowerCase();
      if (clean === 'av' || clean === 'avenida') return 'Av.';
      if (clean === 'gral' || clean === 'general') return 'Gral.';
      if (clean === 'dr' || clean === 'doctor') return 'Dr.';
      if (idx > 0 && lowerWords.has(clean)) return clean;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function cleanPickupZone(friendlyName?: string): string {
  if (!friendlyName) return '';
  const stripped = friendlyName
    .replace(/^Retiro\s+(?:en\s+tienda|al\s+auto)\s*[-–:]?\s*/i, '')
    // Quita sufijos internos de tienda ("Villa Urquiza P", "Parque Chas P", "V")
    .replace(/\s+[A-Z]$/i, '')
    .trim();

  if (stripped.length < 3) return '';
  return formatStreetCase(stripped);
}

function cleanCityLabel(city?: string): string {
  if (!city) return '';
  if (/ciudad aut[oó]noma de buenos aires/i.test(city)) return 'CABA';
  return city.trim();
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

  // 1) Deduplicar por grilla geográfica (~30 m) para unificar ej. "Monroe 4880" y "Avenida Monroe 4880"
  //    conservando la variante que tenga mejor nombre de barrio/zona.
  interface RawCandidate {
    id: string;
    zone: string;
    street: string;
    city: string;
    lat: number;
    lng: number;
    distanceKm?: number;
  }

  const byLocation = new Map<string, RawCandidate>();

  for (const entry of items) {
    const pp = entry.pickupPoint;
    if (!pp) continue;

    const rawStreet = [pp.address?.street, pp.address?.number].filter(Boolean).join(' ').trim();
    const street = formatStreetCase(rawStreet);
    const zone = cleanPickupZone(pp.friendlyName) || formatStreetCase(pp.address?.neighborhood ?? '');
    const city = cleanCityLabel(pp.address?.city);
    const coords = pp.address?.geoCoordinates;
    const itemLng = coords?.[0] ?? lng;
    const itemLat = coords?.[1] ?? lat;

    if (!street && !zone && !city) continue;

    // Clave por coordenadas a ~11-30 m (4 decimales ~11 m; 3 decimales ~110 m -> redondeamos a 0.0003 ~33 m)
    const latBucket = Math.round(itemLat / 0.0003);
    const lngBucket = Math.round(itemLng / 0.0003);
    const locKey = coords
      ? `geo:${latBucket}:${lngBucket}`
      : `addr:${street.toLowerCase()}:${city.toLowerCase()}`;

    const distanceKm =
      typeof entry.distance === 'number' ? Number(entry.distance.toFixed(1)) : undefined;

    const existing = byLocation.get(locKey);
    if (existing) {
      // Si el duplicado aporta el nombre del barrio que faltaba, enriquecerlo
      if (!existing.zone && zone) {
        existing.zone = zone;
      }
      if (!existing.street && street) {
        existing.street = street;
      }
      continue;
    }

    byLocation.set(locKey, {
      id: `vtex-${pp.id ?? locKey}`,
      zone,
      street,
      city,
      lat: itemLat,
      lng: itemLng,
      distanceKm,
    });

    if (byLocation.size >= 8) break;
  }

  // 2) Construir títulos claros sin perder sucursales del mismo barrio:
  //    Dirección como referencia inequívoca + barrio/localidad visible.
  const usedNames = new Set<string>();
  const branches: Branch[] = [];

  for (const item of byLocation.values()) {
    let name = '';
    let address = '';

    if (item.zone && item.street) {
      const zoneLower = item.zone.toLowerCase();
      if (!usedNames.has(zoneLower)) {
        name = item.zone;
        address = item.city && item.city.toLowerCase() !== zoneLower
          ? `${item.street}, ${item.city}`
          : item.street;
      } else {
        name = `${item.zone} · ${item.street}`;
        address = item.city || item.street;
      }
    } else if (item.street) {
      name = item.street;
      address = item.city || 'Sucursal Dia';
    } else {
      name = item.zone || item.city || 'Sucursal Dia';
      address = item.city || 'Sucursal Dia';
    }

    usedNames.add(name.toLowerCase());

    branches.push({
      id: item.id,
      name,
      address,
      city: item.city || item.zone || name,
      lng: item.lng,
      lat: item.lat,
      distanceKm: item.distanceKm,
      source: 'dia-live',
    });
  }

  return branches;
}
