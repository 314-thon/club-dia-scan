import { isStandaloneHtml } from './runtime';

export const MAX_AUTO_SELECT_ACCURACY_METERS = 300;
const TARGET_HIGH_ACCURACY_METERS = 100;
const COARSE_FIX_THRESHOLD_METERS = 1000;

export type GeoErrorKind = 'permission-denied' | 'unavailable' | 'timeout' | 'unsupported';

export class GeoLookupError extends Error {
  readonly kind: GeoErrorKind;

  constructor(kind: GeoErrorKind, message: string) {
    super(message);
    this.name = 'GeoLookupError';
    this.kind = kind;
  }
}

export interface GeoPositionResult {
  lat: number;
  lng: number;
  accuracyMeters: number;
  isApproximate: boolean;
}

export interface GeocodeCandidate {
  id: string;
  label: string;
  subtitle: string;
  lat: number;
  lng: number;
  source: 'photon' | 'usig';
}

export interface GetBestPositionOptions {
  maxWaitMs?: number;
  targetAccuracyMeters?: number;
  coarseEarlyStopMs?: number;
}

/**
 * Obtiene la mejor lectura GPS disponible usando alta precisión real (sin caché viejo).
 * - Corta de inmediato cuando logra <= 100 m.
 * - Si solo llegan lecturas gruesas (> 1 km, típico de Wi-Fi/IP en notebook o ubicación aproximada),
 *   corta temprano (~3,5 s) en lugar de bloquear la pantalla 10 s.
 */
export function getBestPosition(options: GetBestPositionOptions = {}): Promise<GeoPositionResult> {
  const maxWaitMs = options.maxWaitMs ?? 9500;
  const targetAccuracy = options.targetAccuracyMeters ?? TARGET_HIGH_ACCURACY_METERS;
  const coarseEarlyStopMs = options.coarseEarlyStopMs ?? 3500;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(
      new GeoLookupError('unsupported', 'Tu navegador no soporta geolocalización.')
    );
  }

  return new Promise<GeoPositionResult>((resolve, reject) => {
    let settled = false;
    let bestPos: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let hardTimer: number | null = null;
    let coarseTimer: number | null = null;

    const cleanup = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (hardTimer !== null) {
        window.clearTimeout(hardTimer);
        hardTimer = null;
      }
      if (coarseTimer !== null) {
        window.clearTimeout(coarseTimer);
        coarseTimer = null;
      }
    };

    const finishWithBest = (pos: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      cleanup();
      const accuracyMeters = Math.round(pos.coords.accuracy || 9999);
      resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyMeters,
        isApproximate: accuracyMeters > MAX_AUTO_SELECT_ACCURACY_METERS,
      });
    };

    const finishWithError = (err: GeoLookupError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    hardTimer = window.setTimeout(() => {
      if (bestPos) {
        finishWithBest(bestPos);
      } else {
        finishWithError(
          new GeoLookupError(
            'timeout',
            'Tardó demasiado obtener tu señal GPS. Probá escribir tu dirección o barrio.'
          )
        );
      }
    }, maxWaitMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (settled) return;

        if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) {
          bestPos = pos;
        }

        if (pos.coords.accuracy <= targetAccuracy) {
          finishWithBest(pos);
          return;
        }

        // Si el navegador devuelve una posición muy aproximada (IP/red) y no mejora rápido, no colgar 10 s
        if (coarseTimer === null) {
          const waitExtra =
            pos.coords.accuracy > COARSE_FIX_THRESHOLD_METERS ? coarseEarlyStopMs : 4500;
          coarseTimer = window.setTimeout(() => {
            if (bestPos) {
              finishWithBest(bestPos);
            }
          }, waitExtra);
        }
      },
      (geoErr) => {
        if (settled) return;
        // code 1 === PERMISSION_DENIED
        if (geoErr.code === 1) {
          finishWithError(
            new GeoLookupError(
              'permission-denied',
              'El permiso de ubicación está desactivado. Escribí tu dirección o barrio abajo.'
            )
          );
          return;
        }
        if (bestPos) {
          finishWithBest(bestPos);
          return;
        }
        if (geoErr.code === 3) {
          finishWithError(
            new GeoLookupError(
              'timeout',
              'No logramos señal GPS a tiempo. Escribí tu dirección o barrio abajo.'
            )
          );
          return;
        }
        finishWithError(
          new GeoLookupError(
            'unavailable',
            'No pudimos determinar tu ubicación actual. Escribí tu dirección o barrio abajo.'
          )
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: maxWaitMs,
      }
    );
  });
}

export function formatAccuracyLabel(accuracyMeters: number): string {
  if (accuracyMeters >= 1000) {
    const km = (accuracyMeters / 1000).toFixed(1).replace('.', ',');
    return `±${km} km`;
  }
  return `±${Math.max(10, Math.round(accuracyMeters))} m`;
}

async function geocodeDirectStandalone(
  query: string,
  biasLat = -34.6037,
  biasLng = -58.44,
  signal?: AbortSignal
): Promise<GeocodeCandidate[]> {
  const fullQuery = /argentina/i.test(query) ? query : `${query}, Argentina`;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
    fullQuery
  )}&lat=${biasLat}&lon=${biasLng}&bbox=-73.6,-55.2,-53.5,-21.7&limit=6`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: {
        osm_id?: number | string;
        countrycode?: string;
        name?: string;
        street?: string;
        housenumber?: string;
        district?: string;
        city?: string;
        state?: string;
      };
    }>;
  };

  const out: GeocodeCandidate[] = [];
  for (const feat of data.features ?? []) {
    const coords = feat.geometry?.coordinates;
    const p = feat.properties;
    if (!coords || !p) continue;
    if (p.countrycode && p.countrycode.toUpperCase() !== 'AR') continue;
    const streetLine = [p.street, p.housenumber].filter(Boolean).join(' ').trim();
    const label = streetLine || p.name || p.street || '';
    if (!label) continue;
    const subtitle = [p.district, p.city, p.state]
      .filter(Boolean)
      .map((s) => (/ciudad aut[oó]noma de buenos aires/i.test(String(s)) ? 'CABA' : String(s)))
      .slice(0, 2)
      .join(', ');
    out.push({
      id: `photon-${p.osm_id ?? ''}-${coords[1].toFixed(4)}`,
      label,
      subtitle: subtitle || 'Argentina',
      lat: coords[1],
      lng: coords[0],
      source: 'photon',
    });
  }
  return out;
}

export async function geocodeAddress(
  rawQuery: string,
  bias?: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<GeocodeCandidate[]> {
  const query = rawQuery.trim();
  if (query.length < 3) return [];

  if (isStandaloneHtml()) {
    return geocodeDirectStandalone(query, bias?.lat, bias?.lng, signal);
  }

  const params = new URLSearchParams({ q: query });
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    params.set('lat', String(bias.lat));
    params.set('lng', String(bias.lng));
  }

  const res = await fetch(`/api/geocode?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Error al buscar dirección (${res.status})`);
  }
  const payload = (await res.json()) as { items?: GeocodeCandidate[] };
  return Array.isArray(payload.items) ? payload.items : [];
}
