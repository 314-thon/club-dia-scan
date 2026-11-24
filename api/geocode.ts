export interface GeocodeCandidate {
  id: string;
  label: string;
  subtitle: string;
  lat: number;
  lng: number;
  source: 'photon' | 'usig';
}

const AR_BBOX = '-73.6,-55.2,-53.5,-21.7';
const DEFAULT_BIAS_LAT = -34.6037;
const DEFAULT_BIAS_LNG = -58.44;
const INTERSECTION_RE = /\s+(?:y|e|esq\.?|esquina)\s+/i;

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number | string;
    countrycode?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    type?: string;
  };
}

interface UsigEntry {
  direccion?: string;
  nombre_calle?: string;
  nombre_calle_cruce?: string;
  altura?: number | null;
  nombre_localidad?: string;
  nombre_partido?: string;
  tipo?: string;
  coordenadas?: {
    x?: string | number;
    y?: string | number;
  };
}

function toTitleCaseEs(raw: string): string {
  const lowerWords = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'al', 'en']);
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, idx) => {
      if (!word) return '';
      const upper = word.toUpperCase();
      if (upper === 'CABA') return 'CABA';
      if (upper === 'AV.' || upper === 'AV') return 'Av.';
      const clean = word.toLowerCase();
      if (idx > 0 && lowerWords.has(clean)) return clean;
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    })
    .join(' ');
}

function normalizeUsigStreet(street?: string): string {
  if (!street) return '';
  const trimmed = street.trim();
  const avTrailing = trimmed.match(/^(.+?)\s+AV\.?$/i);
  if (avTrailing) {
    return `Av. ${toTitleCaseEs(avTrailing[1])}`;
  }
  return toTitleCaseEs(trimmed);
}

function shortenState(state?: string): string {
  if (!state) return '';
  if (/ciudad aut[oó]noma de buenos aires/i.test(state)) return 'CABA';
  return state.trim();
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function queryUsig(query: string): Promise<GeocodeCandidate[]> {
  const url = `https://servicios.usig.buenosaires.gob.ar/normalizar/?direccion=${encodeURIComponent(
    query
  )}&geocodificar=TRUE&srid=4326`;

  const res = await fetchWithTimeout(
    url,
    {
      Accept: 'application/json',
      'User-Agent': 'ClubDiaScanPWA/1.0',
    },
    4200
  );
  if (!res.ok) return [];

  const data = (await res.json()) as { direccionesNormalizadas?: UsigEntry[] };
  const entries = data.direccionesNormalizadas ?? [];
  const results: GeocodeCandidate[] = [];

  for (const item of entries) {
    const lng = Number(item.coordenadas?.x);
    const lat = Number(item.coordenadas?.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    let label = '';
    if (item.nombre_calle && item.nombre_calle_cruce) {
      label = `${normalizeUsigStreet(item.nombre_calle)} y ${normalizeUsigStreet(
        item.nombre_calle_cruce
      )}`;
    } else if (item.nombre_calle && item.altura) {
      label = `${normalizeUsigStreet(item.nombre_calle)} ${item.altura}`;
    } else if (item.direccion) {
      label = toTitleCaseEs(item.direccion.split(',')[0] ?? item.direccion);
    }
    if (!label) continue;

    const locParts = [item.nombre_localidad, item.nombre_partido]
      .filter((p): p is string => Boolean(p && p.trim()))
      .map((p) => (p.toUpperCase() === 'CABA' ? 'CABA' : toTitleCaseEs(p)));
    const uniqueLoc = Array.from(new Set(locParts));
    const subtitle = uniqueLoc.join(', ') || 'AMBA';

    results.push({
      id: `usig-${lat.toFixed(5)}-${lng.toFixed(5)}`,
      label,
      subtitle,
      lat,
      lng,
      source: 'usig',
    });
  }

  return results;
}

async function queryPhoton(
  query: string,
  biasLat: number,
  biasLng: number
): Promise<GeocodeCandidate[]> {
  const hasArgentina = /argentina/i.test(query);
  const fullQuery = hasArgentina ? query : `${query}, Argentina`;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
    fullQuery
  )}&lat=${biasLat}&lon=${biasLng}&bbox=${AR_BBOX}&limit=10`;

  const res = await fetchWithTimeout(
    url,
    {
      Accept: 'application/json',
      'Accept-Language': 'es-AR,es;q=0.9',
      'User-Agent': 'ClubDiaScanPWA/1.0 (https://club-dia-scan.vercel.app)',
    },
    4500
  );
  if (!res.ok) return [];

  const data = (await res.json()) as { features?: PhotonFeature[] };
  const features = data.features ?? [];
  const results: GeocodeCandidate[] = [];

  for (const feat of features) {
    const coords = feat.geometry?.coordinates;
    const props = feat.properties;
    if (!coords || coords.length < 2 || !props) continue;

    if (props.countrycode && props.countrycode.toUpperCase() !== 'AR') {
      continue;
    }

    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const streetLine = [props.street, props.housenumber].filter(Boolean).join(' ').trim();
    // Prefer clean street + number over shop/POI names at that same address
    const label = streetLine || props.name?.trim() || props.street?.trim() || '';
    if (!label) continue;

    const state = shortenState(props.state);
    const subParts = [props.district, props.city, props.county, state]
      .filter((p): p is string => Boolean(p && p.trim()))
      .map((p) => shortenState(p));

    const dedupedSub: string[] = [];
    for (const part of subParts) {
      if (
        part.toLowerCase() !== label.toLowerCase() &&
        !dedupedSub.some((existing) => existing.toLowerCase() === part.toLowerCase())
      ) {
        dedupedSub.push(part);
      }
    }

    results.push({
      id: `photon-${props.osm_id ?? ''}-${lat.toFixed(5)}-${lng.toFixed(5)}`,
      label,
      subtitle: dedupedSub.slice(0, 3).join(', ') || 'Argentina',
      lat,
      lng,
      source: 'photon',
    });
  }

  return results;
}

export async function resolveGeocodeCandidates(
  rawQuery: string,
  biasLat = DEFAULT_BIAS_LAT,
  biasLng = DEFAULT_BIAS_LNG
): Promise<GeocodeCandidate[]> {
  const query = rawQuery.trim();
  if (query.length < 3) return [];

  const effLat = Number.isFinite(biasLat) ? biasLat : DEFAULT_BIAS_LAT;
  const effLng = Number.isFinite(biasLng) ? biasLng : DEFAULT_BIAS_LNG;
  const isIntersection = INTERSECTION_RE.test(query);

  const [photonSettled, usigSettled] = await Promise.allSettled([
    queryPhoton(query, effLat, effLng),
    queryUsig(query),
  ]);

  const photonList = photonSettled.status === 'fulfilled' ? photonSettled.value : [];
  const usigList = usigSettled.status === 'fulfilled' ? usigSettled.value : [];

  // USIG excels at CABA/GBA intersections ("Triunvirato y Monroe") and exact street+altura;
  // Photon excels at neighborhoods ("Villa Urquiza"), localities ("Lomas de Zamora") and nationwide addresses.
  const ordered = isIntersection ? [...usigList, ...photonList] : [...photonList, ...usigList];

  const seenCoords = new Set<string>();
  const deduped: GeocodeCandidate[] = [];

  for (const item of ordered) {
    const gridKey = `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
    if (seenCoords.has(gridKey)) continue;
    seenCoords.add(gridKey);
    deduped.push(item);
    if (deduped.length >= 6) break;
  }

  return deduped;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const incomingUrl = new URL(request.url);
    const q = (incomingUrl.searchParams.get('q') ?? '').trim();
    if (q.length < 3) {
      return Response.json({ items: [] }, { status: 200 });
    }

    const latParam = Number(incomingUrl.searchParams.get('lat'));
    const lngParam = Number(incomingUrl.searchParams.get('lng'));

    const items = await resolveGeocodeCandidates(
      q,
      Number.isFinite(latParam) ? latParam : DEFAULT_BIAS_LAT,
      Number.isFinite(lngParam) ? lngParam : DEFAULT_BIAS_LNG
    );

    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al geocodificar dirección';
    console.error('[api/geocode]', message);
    return Response.json({ error: message, items: [] }, { status: 502 });
  }
}
