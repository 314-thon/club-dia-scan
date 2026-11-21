import { CatalogSyncMeta, ImageSyncProgress, Product } from '../types/models';
import { isFileProtocol } from '../utils/runtime';

const DB_NAME = 'club-dia-offline-v1';
const DB_VERSION = 1;
const STORE_PRODUCTS = 'products';
const STORE_META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openCatalogDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || isFileProtocol()) {
    return Promise.reject(new Error('IndexedDB no disponible'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        db.createObjectStore(STORE_PRODUCTS, { keyPath: 'ean' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('No se pudo abrir IndexedDB'));
    };
  });

  return dbPromise;
}

export async function getCatalogSyncMeta(): Promise<CatalogSyncMeta | null> {
  try {
    const db = await openCatalogDb();
    return await new Promise<CatalogSyncMeta | null>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get('catalogSync');
      req.onsuccess = () => {
        const record = req.result as { key: string; value: CatalogSyncMeta } | undefined;
        resolve(record?.value ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getImageSyncMeta(): Promise<ImageSyncProgress | null> {
  try {
    const db = await openCatalogDb();
    return await new Promise<ImageSyncProgress | null>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get('imageSync');
      req.onsuccess = () => {
        const record = req.result as { key: string; value: ImageSyncProgress } | undefined;
        resolve(record?.value ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveImageSyncMeta(value: ImageSyncProgress): Promise<void> {
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ key: 'imageSync', value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore storage errors
  }
}

export async function saveCatalogSnapshotToDb(
  products: Product[],
  meta: CatalogSyncMeta
): Promise<void> {
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTS, STORE_META], 'readwrite');
      const prodStore = tx.objectStore(STORE_PRODUCTS);
      const metaStore = tx.objectStore(STORE_META);

      prodStore.clear();
      for (const product of products) {
        prodStore.put(product);
      }
      metaStore.put({ key: 'catalogSync', value: meta });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Error guardando catálogo en IndexedDB'));
    });
  } catch {
    // Graceful no-op when IndexedDB is unavailable (e.g. standalone file:// HTML)
  }
}

export async function upsertProductInDb(product: Product): Promise<void> {
  try {
    const db = await openCatalogDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
      tx.objectStore(STORE_PRODUCTS).put(product);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore storage errors
  }
}

export async function getProductByEanFromDb(ean: string): Promise<Product | null> {
  try {
    const db = await openCatalogDb();
    return await new Promise<Product | null>((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly');
      const req = tx.objectStore(STORE_PRODUCTS).get(ean);
      req.onsuccess = () => resolve((req.result as Product | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getAllProductsFromDb(): Promise<Product[]> {
  try {
    const db = await openCatalogDb();
    return await new Promise<Product[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly');
      const req = tx.objectStore(STORE_PRODUCTS).getAll();
      req.onsuccess = () => {
        const list = (req.result as Product[] | undefined) ?? [];
        // Keep highest discounts first, matching Offers view order
        list.sort((a, b) => {
          if (b.discountPct !== a.discountPct) return b.discountPct - a.discountPct;
          return a.name.localeCompare(b.name, 'es-AR');
        });
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}
