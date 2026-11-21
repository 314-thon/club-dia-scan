export type TabId = 'inicio' | 'ofertas' | 'escaner' | 'historial' | 'preferencias';

export type ProductCategory =
  | 'Almacén'
  | 'Lácteos'
  | 'Limpieza'
  | 'Bebidas'
  | 'Frescos'
  | 'Perfumería'
  | 'Otros';

export interface Branch {
  id: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  distanceKm?: number;
  source: 'seed' | 'dia-live';
}

export interface Product {
  id: string;
  ean: string;
  name: string;
  brand: string;
  category: ProductCategory;
  subtitle: string;
  imageUrl: string;
  price: number;
  listPrice: number;
  discountPct: number;
  savings: number;
  validRange: string | null;
  limitQty: number | null;
  habitualFreq?: string;
  isHabitual?: boolean;
  source: 'club-dia' | 'dia-live';
  availableQuantity?: number;
}

export interface VisitItem {
  product: Product;
  quantity: number;
  addedAt: string;
}

export interface TicketItem {
  name: string;
  qty: number;
  price: number;
  saved: number;
}

export interface Ticket {
  id: string;
  dateLabel: string;
  branchId: string;
  branchName: string;
  productCount: number;
  total: number;
  saved: number;
  items: TicketItem[];
}

export interface MonthHistory {
  id: string;
  label: string;
  shortName: string;
  tickets: Ticket[];
}

export interface CategoryBreakdown {
  label: string;
  pct: number;
  amount: number;
}

export interface UserPreferences {
  personalizedDeals: boolean;
  branchArrivalAlert: boolean;
}

export interface CatalogSyncMeta {
  dateKey: string;
  syncedAt: string;
  timeHHMM: string;
  snapshotVersion: string;
  productCount: number;
  discountedCount: number;
  source: 'api-catalog' | 'static-snapshot';
}

export interface ImageSyncProgress {
  status: 'idle' | 'checking' | 'syncing' | 'done' | 'paused' | 'error';
  total: number;
  cached: number;
  downloadedNow: number;
  skipped: number;
  pruned: number;
  failed: number;
  lastDateKey?: string;
}

export interface CatalogSnapshot {
  version: string;
  generatedAt: string;
  thumbSize: number;
  imageBaseUrl: string;
  categories: ProductCategory[];
  count: number;
  discountedCount: number;
  /**
   * [ean, name, brand, catIdx, subtitle, compactImgPath, price, listPrice, availableQty]
   */
  items: [string, string, string, number, string, string, number, number, number][];
}

export interface SyncStatus {
  mode: 'online' | 'offline' | 'stale';
  lastSyncTime: string;
  lastSyncDateKey?: string;
  liveProductsCount: number;
  catalogCount: number;
  imageSync: ImageSyncProgress;
  gpsState: 'ok' | 'idle' | 'denied';
  errorMessage?: string;
}
