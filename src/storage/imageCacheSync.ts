import { ImageSyncProgress } from '../types/models';

export const PRODUCT_IMAGE_CACHE = 'club-dia-images-v1';

function extractUniqueRemoteUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of urls) {
    if (!url || !url.startsWith('https://')) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }
  return unique;
}

export async function getCachedImageCoverage(
  urls: string[]
): Promise<{ total: number; cached: number; missing: number }> {
  const unique = extractUniqueRemoteUrls(urls);
  if (typeof caches === 'undefined') {
    return { total: unique.length, cached: 0, missing: unique.length };
  }
  try {
    const cache = await caches.open(PRODUCT_IMAGE_CACHE);
    const keys = await cache.keys();
    const existingSet = new Set(keys.map((req) => req.url));
    let cached = 0;
    for (const url of unique) {
      if (existingSet.has(url)) cached++;
    }
    return { total: unique.length, cached, missing: unique.length - cached };
  } catch {
    return { total: unique.length, cached: 0, missing: unique.length };
  }
}

export interface SyncImagesOptions {
  dateKey: string;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ImageSyncProgress) => void;
}

/**
 * Incrementally caches product thumbnails (160x160) in Cache API:
 * - Compares exact URL (including VTEX ?v= version hash) against cached keys.
 * - Skips any photo already present locally (0 bytes re-downloaded).
 * - Prunes obsolete photos removed from the catalog or replaced by a new ?v=.
 * - Downloads only new/updated photos in parallel; safe to abort & resume.
 */
export async function syncProductImagesIncremental(
  urls: string[],
  options: SyncImagesOptions
): Promise<ImageSyncProgress> {
  const { dateKey, concurrency = 6, signal, onProgress } = options;
  const targetUrls = extractUniqueRemoteUrls(urls);
  const total = targetUrls.length;

  const progress: ImageSyncProgress = {
    status: 'checking',
    total,
    cached: 0,
    downloadedNow: 0,
    skipped: 0,
    pruned: 0,
    failed: 0,
    lastDateKey: dateKey,
  };

  if (typeof caches === 'undefined' || total === 0) {
    progress.status = 'done';
    onProgress?.({ ...progress });
    return progress;
  }

  onProgress?.({ ...progress });

  try {
    const cache = await caches.open(PRODUCT_IMAGE_CACHE);
    const existingRequests = await cache.keys();
    const targetSet = new Set(targetUrls);
    const existingSet = new Set<string>();

    const obsoleteRequests: Request[] = [];
    for (const req of existingRequests) {
      if (targetSet.has(req.url)) {
        existingSet.add(req.url);
      } else {
        obsoleteRequests.push(req);
      }
    }

    // Prune outdated/removed images in background without blocking downloads
    if (obsoleteRequests.length > 0) {
      await Promise.allSettled(obsoleteRequests.map((req) => cache.delete(req)));
      progress.pruned = obsoleteRequests.length;
    }

    const missingUrls: string[] = [];
    for (const url of targetUrls) {
      if (existingSet.has(url)) {
        progress.skipped++;
      } else {
        missingUrls.push(url);
      }
    }

    progress.cached = progress.skipped;

    if (missingUrls.length === 0) {
      progress.status = 'done';
      onProgress?.({ ...progress });
      return progress;
    }

    if (signal?.aborted) {
      progress.status = 'paused';
      onProgress?.({ ...progress });
      return progress;
    }

    progress.status = 'syncing';
    onProgress?.({ ...progress });

    let cursor = 0;
    let lastEmitAt = Date.now();
    let sinceLastEmit = 0;

    const emitIfNeeded = (force = false) => {
      const now = Date.now();
      if (force || sinceLastEmit >= 20 || now - lastEmitAt >= 450) {
        lastEmitAt = now;
        sinceLastEmit = 0;
        onProgress?.({ ...progress });
      }
    };

    async function worker() {
      while (cursor < missingUrls.length) {
        if (signal?.aborted) return;
        const url = missingUrls[cursor++];
        try {
          const response = await fetch(url, {
            mode: 'cors',
            credentials: 'omit',
            signal,
          });
          if (response.ok) {
            await cache.put(url, response);
            progress.downloadedNow++;
            progress.cached++;
          } else {
            progress.failed++;
          }
        } catch (err) {
          if (signal?.aborted) return;
          if (err instanceof DOMException && err.name === 'AbortError') return;
          progress.failed++;
        }
        sinceLastEmit++;
        emitIfNeeded();
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, missingUrls.length) }, () => worker())
    );

    progress.status = signal?.aborted ? 'paused' : 'done';
    emitIfNeeded(true);
    return progress;
  } catch {
    progress.status = signal?.aborted ? 'paused' : 'error';
    onProgress?.({ ...progress });
    return progress;
  }
}
