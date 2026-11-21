import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, RefreshCw, ScanBarcode, Wifi, WifiOff } from 'lucide-react';
import {
  expandCatalogSnapshot,
  fetchDailyCatalogSnapshot,
  fetchNearbyDiaBranches,
  loadLastSyncTime,
  lookupDiaByEan,
  saveLastSyncTime,
  searchDiaProducts,
} from './api/diaApi';
import { AppDialogs, ActiveDialog } from './components/AppDialogs';
import { BottomNav } from './components/BottomNav';
import {
  INITIAL_VISIT_ITEMS,
  NOVEMBER_CATEGORY_BREAKDOWN,
  SEED_BRANCHES,
  SEED_HISTORY_MONTHS,
  SEED_PRODUCTS,
} from './data/seedData';
import { HistoryScreen } from './screens/HistoryScreen';
import { HomeScreen } from './screens/HomeScreen';
import { OffersScreen } from './screens/OffersScreen';
import { PreferencesScreen } from './screens/PreferencesScreen';
import { ProductScreen } from './screens/ProductScreen';
import {
  getAllProductsFromDb,
  getCatalogSyncMeta,
  getProductByEanFromDb,
  saveCatalogSnapshotToDb,
  saveImageSyncMeta,
  upsertProductInDb,
} from './storage/catalogDb';
import {
  getCachedImageCoverage,
  syncProductImagesIncremental,
} from './storage/imageCacheSync';
import {
  Branch,
  CatalogSyncMeta,
  ImageSyncProgress,
  Product,
  SyncStatus,
  TabId,
  UserPreferences,
  VisitItem,
} from './types/models';
import { formatSyncDateLabel, formatTimeHHMM, getLocalDateKey } from './utils/format';
import { isStandaloneHtml } from './utils/runtime';

const ScannerScreen = lazy(() =>
  import('./screens/ScannerScreen').then((m) => ({ default: m.ScannerScreen }))
);

const VISIT_STORAGE_KEY = 'clubdia_visit_items_v1';
const PREFS_STORAGE_KEY = 'clubdia_preferences_v1';
const BRANCH_STORAGE_KEY = 'clubdia_active_branch_v1';

const INITIAL_IMAGE_SYNC: ImageSyncProgress = {
  status: 'idle',
  total: 0,
  cached: 0,
  downloadedNow: 0,
  skipped: 0,
  pruned: 0,
  failed: 0,
};

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function loadStoredVisit(): VisitItem[] {
  try {
    const raw = localStorage.getItem(VISIT_STORAGE_KEY);
    if (!raw) return INITIAL_VISIT_ITEMS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VisitItem[]) : INITIAL_VISIT_ITEMS;
  } catch {
    return INITIAL_VISIT_ITEMS;
  }
}

function loadStoredPrefs(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { personalizedDeals: true, branchArrivalAlert: true };
    return JSON.parse(raw) as UserPreferences;
  } catch {
    return { personalizedDeals: true, branchArrivalAlert: true };
  }
}

function loadStoredBranch(): Branch {
  try {
    const raw = localStorage.getItem(BRANCH_STORAGE_KEY);
    if (!raw) return SEED_BRANCHES[0];
    return JSON.parse(raw) as Branch;
  } catch {
    return SEED_BRANCHES[0];
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('inicio');
  const [previousTab, setPreviousTab] = useState<TabId>('inicio');
  const [offersFilter, setOffersFilter] = useState<string>('Todos');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [dialog, setDialog] = useState<ActiveDialog>(null);

  const [branches, setBranches] = useState<Branch[]>(SEED_BRANCHES);
  const [activeBranch, setActiveBranch] = useState<Branch>(loadStoredBranch);
  const [liveProducts, setLiveProducts] = useState<Product[]>([]);
  const [visitItems, setVisitItems] = useState<VisitItem[]>(loadStoredVisit);
  const [preferences, setPreferences] = useState<UserPreferences>(loadStoredPrefs);

  const [hydrated, setHydrated] = useState(false);
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(!navigator.onLine);
  const [lastSyncTime, setLastSyncTime] = useState<string>(loadLastSyncTime);
  const [lastSyncDateKey, setLastSyncDateKey] = useState<string | undefined>(undefined);
  const [imageSync, setImageSync] = useState<ImageSyncProgress>(INITIAL_IMAGE_SYNC);
  const [gpsState, setGpsState] = useState<'ok' | 'idle' | 'denied'>('ok');
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [locatingBranches, setLocatingBranches] = useState(false);
  const [refreshingLive, setRefreshingLive] = useState(false);
  const [lookingUpEan, setLookingUpEan] = useState(false);
  const [lastNotFoundEan, setLastNotFoundEan] = useState<string | null>(null);

  const isOffline = simulatedOffline || browserOffline;
  const standaloneMode = isStandaloneHtml();

  const catalogSyncInFlightRef = useRef(false);
  const imageAbortRef = useRef<AbortController | null>(null);
  const liveProductsRef = useRef<Product[]>([]);
  const lastSyncDateKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    liveProductsRef.current = liveProducts;
  }, [liveProducts]);

  useEffect(() => {
    lastSyncDateKeyRef.current = lastSyncDateKey;
  }, [lastSyncDateKey]);

  // Merge Club Dia showcase products + full Dia catalog without duplicating EANs
  const allProducts = useMemo(() => {
    const seedEans = new Set(SEED_PRODUCTS.map((p) => p.ean));
    const uniqueLive = liveProducts.filter((p) => !seedEans.has(p.ean));
    return [...SEED_PRODUCTS, ...uniqueLive];
  }, [liveProducts]);

  const habitualProducts = useMemo(
    () => SEED_PRODUCTS.filter((p) => p.isHabitual && p.discountPct > 0),
    []
  );

  const sync: SyncStatus = useMemo(() => {
    const todayKey = getLocalDateKey();
    const isStaleOnline =
      !isOffline && Boolean(lastSyncDateKey) && lastSyncDateKey !== todayKey && !refreshingLive;
    return {
      mode: isOffline ? 'offline' : isStaleOnline ? 'stale' : 'online',
      lastSyncTime,
      lastSyncDateKey,
      liveProductsCount: liveProducts.length,
      catalogCount: allProducts.length,
      imageSync,
      gpsState,
    };
  }, [
    allProducts.length,
    gpsState,
    imageSync,
    isOffline,
    lastSyncDateKey,
    lastSyncTime,
    liveProducts.length,
    refreshingLive,
  ]);

  useEffect(() => {
    const onOnline = () => setBrowserOffline(false);
    const onOffline = () => setBrowserOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VISIT_STORAGE_KEY, JSON.stringify(visitItems));
    } catch {
      // ignore
    }
  }, [visitItems]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // ignore
    }
  }, [preferences]);

  useEffect(() => {
    try {
      localStorage.setItem(BRANCH_STORAGE_KEY, JSON.stringify(activeBranch));
    } catch {
      // ignore
    }
  }, [activeBranch]);

  const runIncrementalImages = useCallback(async (products: Product[], dateKey: string) => {
    imageAbortRef.current?.abort();
    const controller = new AbortController();
    imageAbortRef.current = controller;

    // Order URLs with discounted products first so visible offers cache earliest
    const urls = products.map((p) => p.imageUrl);
    const finalProgress = await syncProductImagesIncremental(urls, {
      dateKey,
      concurrency: 6,
      signal: controller.signal,
      onProgress: (next) => {
        if (imageAbortRef.current === controller) {
          setImageSync(next);
        }
      },
    });

    if (imageAbortRef.current === controller) {
      setImageSync(finalProgress);
      void saveImageSyncMeta(finalProgress);
    }
  }, []);

  const syncCatalogSnapshot = useCallback(
    async (preferLiveApi: boolean, syncImagesAfter = true): Promise<Product[] | null> => {
      if (catalogSyncInFlightRef.current) return null;
      catalogSyncInFlightRef.current = true;
      setRefreshingLive(true);

      try {
        const { snapshot, source } = await fetchDailyCatalogSnapshot(preferLiveApi);
        const expanded = expandCatalogSnapshot(snapshot);
        if (expanded.length === 0) return null;

        const now = new Date();
        const todayKey = getLocalDateKey(now);
        const timeHHMM = formatTimeHHMM(now);
        const meta: CatalogSyncMeta = {
          dateKey: todayKey,
          syncedAt: now.toISOString(),
          timeHHMM,
          snapshotVersion: snapshot.version,
          productCount: expanded.length,
          discountedCount: snapshot.discountedCount,
          source,
        };

        setLiveProducts(expanded);
        liveProductsRef.current = expanded;
        setLastSyncTime(timeHHMM);
        setLastSyncDateKey(todayKey);
        lastSyncDateKeyRef.current = todayKey;
        saveLastSyncTime(timeHHMM);

        await saveCatalogSnapshotToDb(expanded, meta);

        if (syncImagesAfter && !standaloneMode) {
          void runIncrementalImages(expanded, todayKey);
        }

        return expanded;
      } catch {
        return null;
      } finally {
        catalogSyncInFlightRef.current = false;
        setRefreshingLive(false);
      }
    },
    [runIncrementalImages, standaloneMode]
  );

  // 1. Immediate offline hydration from IndexedDB on app launch
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const [storedProducts, storedMeta] = await Promise.all([
        getAllProductsFromDb(),
        getCatalogSyncMeta(),
      ]);

      if (cancelled) return;

      if (storedProducts.length > 0) {
        setLiveProducts(storedProducts);
        liveProductsRef.current = storedProducts;
        const urls = storedProducts.map((p) => p.imageUrl);
        const cov = await getCachedImageCoverage(urls);
        if (!cancelled) {
          setImageSync((prev) => ({
            ...prev,
            total: cov.total,
            cached: cov.cached,
            status: cov.missing === 0 && cov.total > 0 ? 'done' : prev.status,
            lastDateKey: storedMeta?.dateKey,
          }));
        }
      }

      if (storedMeta && !cancelled) {
        setLastSyncTime(storedMeta.timeHHMM);
        setLastSyncDateKey(storedMeta.dateKey);
        lastSyncDateKeyRef.current = storedMeta.dateKey;
      }

      if (!cancelled) {
        setHydrated(true);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Daily automatic sync (once per day, regardless of Wi-Fi) + incremental photo resume
  useEffect(() => {
    if (!hydrated) return;

    if (isOffline) {
      imageAbortRef.current?.abort();
      setImageSync((prev) =>
        prev.status === 'syncing' || prev.status === 'checking'
          ? { ...prev, status: 'paused' }
          : prev
      );
      return;
    }

    let cancelled = false;

    async function checkDailySync() {
      const todayKey = getLocalDateKey();
      const existing = liveProductsRef.current;
      const syncedDate = lastSyncDateKeyRef.current;

      // Case A: first visit (empty IndexedDB) -> load fast static catalog immediately, then sync photos
      if (existing.length === 0) {
        const loaded = await syncCatalogSnapshot(false, !standaloneMode);
        if (cancelled || !loaded || standaloneMode) return;
        // If deployed static snapshot is older than today, silently check /api/catalog for fresh daily prices
        const meta = await getCatalogSyncMeta();
        if (!cancelled && meta && meta.snapshotVersion !== todayKey) {
          void syncCatalogSnapshot(true, true);
        }
        return;
      }

      if (standaloneMode) return;

      // Case B: new day since last sync -> daily update (JSON prices + incremental new/changed photos only)
      if (syncedDate !== todayKey) {
        await syncCatalogSnapshot(true, true);
        return;
      }

      // Case C: already synced today -> skip JSON; only resume images if any were left uncached
      const cov = await getCachedImageCoverage(existing.map((p) => p.imageUrl));
      if (cancelled) return;
      if (cov.missing > 0) {
        void runIncrementalImages(existing, todayKey);
      } else {
        setImageSync((prev) => ({
          ...prev,
          status: 'done',
          total: cov.total,
          cached: cov.cached,
          skipped: cov.cached,
          downloadedNow: 0,
          lastDateKey: todayKey,
        }));
      }
    }

    void checkDailySync();

    return () => {
      cancelled = true;
    };
  }, [hydrated, isOffline, runIncrementalImages, standaloneMode, syncCatalogSnapshot]);

  useEffect(() => {
    return () => {
      imageAbortRef.current?.abort();
    };
  }, []);

  const handleForceRefresh = useCallback(async () => {
    if (isOffline) return;
    await syncCatalogSnapshot(true, true);
  }, [isOffline, syncCatalogSnapshot]);

  const handleOpenProduct = useCallback(
    (product: Product) => {
      setPreviousTab(activeTab);
      setSelectedProduct(product);
    },
    [activeTab]
  );

  const handleSelectTab = useCallback(
    (tab: TabId) => {
      if (tab === 'escaner' && activeTab !== 'escaner') {
        setPreviousTab(activeTab);
      }
      setSelectedProduct(null);
      setLastNotFoundEan(null);
      setActiveTab(tab);
    },
    [activeTab]
  );

  const handleOpenOffers = useCallback((filter = 'Todos') => {
    setOffersFilter(filter);
    setSelectedProduct(null);
    setActiveTab('ofertas');
  }, []);

  const handleSearchProducts = useCallback(
    async (query: string): Promise<Product[]> => {
      const normalizedQuery = normalizeSearchText(query.trim());
      if (!normalizedQuery) return [];

      const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
      const localMatches: Product[] = [];

      for (const p of allProducts) {
        if (p.ean.includes(normalizedQuery)) {
          localMatches.push(p);
          continue;
        }
        const haystack = normalizeSearchText(`${p.name} ${p.brand} ${p.subtitle}`);
        if (tokens.every((t) => haystack.includes(t))) {
          localMatches.push(p);
        }
      }

      const topLocal = localMatches.slice(0, 40);

      if (isOffline || standaloneMode) {
        return topLocal;
      }

      try {
        const remote = await searchDiaProducts(query);
        const seen = new Set(remote.map((r) => r.ean));
        return [...remote, ...topLocal.filter((m) => !seen.has(m.ean))].slice(0, 40);
      } catch {
        return topLocal;
      }
    },
    [allProducts, isOffline, standaloneMode]
  );

  const handleToggleVisitList = useCallback((product: Product) => {
    setVisitItems((prev) => {
      const exists = prev.some((i) => i.product.ean === product.ean);
      if (exists) {
        return prev.filter((i) => i.product.ean !== product.ean);
      }
      return [{ product, quantity: 1, addedAt: formatTimeHHMM() }, ...prev];
    });
  }, []);

  const handleAddOrBumpVisit = useCallback((product: Product) => {
    setVisitItems((prev) => {
      const idx = prev.findIndex((i) => i.product.ean === product.ean);
      if (idx >= 0) {
        return prev;
      }
      return [{ product, quantity: 1, addedAt: formatTimeHHMM() }, ...prev];
    });
  }, []);

  const handleUpdateVisitQty = useCallback((ean: string, delta: number) => {
    setVisitItems((prev) =>
      prev
        .map((item) =>
          item.product.ean === ean ? { ...item, quantity: item.quantity + delta } : item
        )
        .filter((item) => item.quantity > 0)
    );
  }, []);

  const handleRemoveVisitItem = useCallback((ean: string) => {
    setVisitItems((prev) => prev.filter((i) => i.product.ean !== ean));
  }, []);

  const handleLookupEan = useCallback(
    async (rawCode: string) => {
      const clean = rawCode.replace(/\D/g, '');
      if (!clean) return;

      setLookingUpEan(true);
      setLastNotFoundEan(null);

      try {
        // Online: try live Dia API first (with 3.8s timeout) and persist fresh price in IndexedDB
        if (!isOffline && !standaloneMode) {
          try {
            const liveHit = await lookupDiaByEan(clean);
            if (liveHit) {
              void upsertProductInDb(liveHit);
              setLiveProducts((prev) => {
                const idx = prev.findIndex((p) => p.ean === liveHit.ean);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = liveHit;
                  return copy;
                }
                return [liveHit, ...prev];
              });
              setDialog(null);
              handleAddOrBumpVisit(liveHit);
              handleOpenProduct(liveHit);
              return;
            }
          } catch {
            // Fall through cleanly to instant IndexedDB offline lookup
          }
        }

        // Offline or API fallback: O(1) lookup by EAN in IndexedDB across all ~5.000 Dia products
        const dbHit = await getProductByEanFromDb(clean);
        if (dbHit) {
          setDialog(null);
          handleAddOrBumpVisit(dbHit);
          handleOpenProduct(dbHit);
          return;
        }

        // Finally check showcase / in-memory products
        const localHit = allProducts.find((p) => p.ean === clean);
        if (localHit) {
          setDialog(null);
          handleAddOrBumpVisit(localHit);
          handleOpenProduct(localHit);
          return;
        }

        setDialog(null);
        setLastNotFoundEan(clean);
        setActiveTab('escaner');
        setSelectedProduct(null);
      } finally {
        setLookingUpEan(false);
      }
    },
    [allProducts, handleAddOrBumpVisit, handleOpenProduct, isOffline, standaloneMode]
  );

  const handleLocateBranches = useCallback(async () => {
    setGpsMessage(null);
    if (!navigator.geolocation) {
      setGpsState('denied');
      setGpsMessage('Tu navegador no soporta geolocalización. Elegí la sucursal de la lista.');
      return;
    }

    setLocatingBranches(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60000,
        });
      });

      setGpsState('ok');
      if (standaloneMode) {
        const { latitude, longitude } = pos.coords;
        const ranked = SEED_BRANCHES.map((b) => {
          const dLat = (b.lat - latitude) * 111;
          const dLng = (b.lng - longitude) * 91;
          const km = Number(Math.hypot(dLat, dLng).toFixed(1));
          return { ...b, distanceKm: km };
        }).sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
        setBranches(ranked);
        setActiveBranch(ranked[0]);
        setGpsMessage(`Sucursal más cercana detectada: ${ranked[0].name} (a ${ranked[0].distanceKm} km).`);
        return;
      }
      const liveBranches = await fetchNearbyDiaBranches(
        pos.coords.latitude,
        pos.coords.longitude
      );

      if (liveBranches.length > 0) {
        const merged = [
          ...liveBranches,
          ...SEED_BRANCHES.filter(
            (seed) =>
              !liveBranches.some((lb) => lb.name.toLowerCase() === seed.name.toLowerCase())
          ),
        ];
        setBranches(merged);
        setActiveBranch(liveBranches[0]);
        setGpsMessage(`Detectamos ${liveBranches.length} sucursales Dia cerca de tu ubicación.`);
      } else {
        setGpsMessage('No encontramos sucursales cercanas en Dia Online; podés elegir de la lista.');
      }
    } catch {
      setGpsState('denied');
      setGpsMessage(
        'No pudimos acceder a tu ubicación. Podés elegir manualmente tu sucursal de la lista.'
      );
    } finally {
      setLocatingBranches(false);
    }
  }, [standaloneMode]);

  const showBottomNav = !selectedProduct && activeTab !== 'escaner';
  const totalOffersDisplay = Math.max(42, allProducts.filter((p) => p.discountPct > 0).length);
  const imagePct =
    imageSync.total > 0 ? Math.min(100, Math.round((imageSync.cached / imageSync.total) * 100)) : 0;

  return (
    <div className="app-stage">
      <div className="phone-shell">
        {selectedProduct ? (
          <ProductScreen
            product={selectedProduct}
            branch={activeBranch}
            inVisitList={visitItems.some((i) => i.product.ean === selectedProduct.ean)}
            isStale={isOffline}
            onBack={() => setSelectedProduct(null)}
            onScanAnother={() => {
              setSelectedProduct(null);
              setActiveTab('escaner');
            }}
            onToggleVisitList={handleToggleVisitList}
            onCompareBranches={(prod) => setDialog({ type: 'other-branches', product: prod })}
          />
        ) : activeTab === 'inicio' ? (
          <HomeScreen
            branch={activeBranch}
            sync={sync}
            featuredDeals={SEED_PRODUCTS}
            totalOffersCount={totalOffersDisplay}
            habitualDealsCount={habitualProducts.length}
            onOpenBranches={() => setDialog({ type: 'branches' })}
            onOpenCard={() => setDialog({ type: 'card' })}
            onOpenNotifications={() => setDialog({ type: 'notifications' })}
            onOpenOffers={handleOpenOffers}
            onSelectProduct={handleOpenProduct}
            onSearchProducts={handleSearchProducts}
          />
        ) : activeTab === 'ofertas' ? (
          <OffersScreen
            branch={activeBranch}
            sync={sync}
            products={allProducts}
            initialFilter={offersFilter}
            onOpenBranches={() => setDialog({ type: 'branches' })}
            onSelectProduct={handleOpenProduct}
            onSearchProducts={handleSearchProducts}
            onRefreshLive={handleForceRefresh}
            refreshingLive={refreshingLive}
          />
        ) : activeTab === 'escaner' ? (
          <Suspense
            fallback={
              <div
                className="scanner-screen"
                style={{ alignItems: 'center', justifyContent: 'center' }}
              >
                <span className="scanner-glass-pill">Iniciando escáner...</span>
              </div>
            }
          >
            <ScannerScreen
              branch={activeBranch}
              sync={sync}
              visitItems={visitItems}
              lastNotFoundEan={lastNotFoundEan}
              lookingUpEan={lookingUpEan}
              onBack={() => handleSelectTab(previousTab === 'escaner' ? 'inicio' : previousTab)}
              onOpenBranches={() => setDialog({ type: 'branches' })}
              onOpenManualEan={() => setDialog({ type: 'manual-ean' })}
              onOpenVisitList={() => setDialog({ type: 'visit-list' })}
              onRemoveVisitItem={handleRemoveVisitItem}
              onSelectProduct={handleOpenProduct}
              onDetectedCode={handleLookupEan}
              onClearNotFound={() => setLastNotFoundEan(null)}
            />
          </Suspense>
        ) : activeTab === 'historial' ? (
          <HistoryScreen
            months={SEED_HISTORY_MONTHS}
            onSelectTicket={(ticket) => setDialog({ type: 'ticket', ticket })}
          />
        ) : (
          <PreferencesScreen
            branch={activeBranch}
            sync={sync}
            breakdown={NOVEMBER_CATEGORY_BREAKDOWN}
            habitualProducts={habitualProducts}
            preferences={preferences}
            refreshingCatalog={refreshingLive}
            onChangePreferences={setPreferences}
            onSelectProduct={handleOpenProduct}
            onOpenPrivacy={() => setDialog({ type: 'privacy' })}
            onOpenOffersForYou={() => handleOpenOffers('Para vos')}
            onRequestLocation={handleLocateBranches}
            onRefreshCatalog={handleForceRefresh}
          />
        )}

        {showBottomNav && <BottomNav activeTab={activeTab} onSelectTab={handleSelectTab} />}

        <AppDialogs
          dialog={dialog}
          onClose={() => setDialog(null)}
          branches={branches}
          activeBranch={activeBranch}
          onSelectBranch={(b) => {
            setActiveBranch(b);
            setGpsState('ok');
          }}
          onLocateBranches={handleLocateBranches}
          locatingBranches={locatingBranches}
          gpsMessage={gpsMessage}
          onLookupEan={handleLookupEan}
          lookingUpEan={lookingUpEan}
          visitItems={visitItems}
          onUpdateVisitQty={handleUpdateVisitQty}
          onClearVisit={() => setVisitItems([])}
          onOpenProduct={handleOpenProduct}
          isOffline={isOffline}
        />
      </div>

      {/* Desktop-only testing panel outside the 390px phone viewport */}
      <aside className="desktop-sidebar" aria-label="Panel de pruebas del prototipo">
        <div className="sidebar-card">
          <div className="sidebar-title">
            {standaloneMode ? 'Prototipo HTML · Club Dia' : 'Prototipo PWA · Club Dia'}
          </div>
          <p className="sidebar-caption">
            {standaloneMode
              ? 'Archivo HTML autocontenido con el catálogo diario de Dia embebido. No requiere servidor para probarlo.'
              : 'Base diaria en IndexedDB + fotos 160×160 incrementales en Cache API (~25 MB máx.).'}
          </p>

          <div className="sidebar-stat">
            <span>Estado de red</span>
            <strong>{isOffline ? 'Sin señal (offline)' : 'En línea'}</strong>
          </div>
          <div className="sidebar-stat">
            <span>{standaloneMode ? 'Catálogo embebido' : 'Catálogo IndexedDB'}</span>
            <strong className="mono">{allProducts.length.toLocaleString('es-AR')}</strong>
          </div>
          {!standaloneMode && (
            <div className="sidebar-stat">
              <span>Fotos 160×160</span>
              <strong className="mono">
                {imageSync.cached.toLocaleString('es-AR')}/{imageSync.total.toLocaleString('es-AR')} ({imagePct}%)
              </strong>
            </div>
          )}
          <div className="sidebar-stat">
            <span>Sync diaria</span>
            <strong className="mono">{formatSyncDateLabel(lastSyncDateKey, lastSyncTime)}</strong>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="sidebar-title">Escenarios de prueba</div>
          <p className="sidebar-caption">Probá variantes y consultas reales en un clic:</p>
          <div className="sidebar-actions">
            {!standaloneMode && (
              <button
                type="button"
                className="sidebar-btn"
                onClick={() => void handleForceRefresh()}
                disabled={refreshingLive || isOffline}
              >
                <span>
                  {refreshingLive
                    ? 'Sincronizando catálogo...'
                    : imageSync.status === 'syncing'
                      ? `Bajando fotos (${imagePct}%)...`
                      : 'Actualizar catálogo + fotos'}
                </span>
                <RefreshCw size={15} className={refreshingLive ? 'spin' : undefined} aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              className="sidebar-btn"
              onClick={() => setDialog({ type: 'manual-ean' })}
            >
              <span>Probar código EAN-13 real</span>
              <ScanBarcode size={15} aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`sidebar-btn${simulatedOffline ? ' active' : ''}`}
              onClick={() => setSimulatedOffline((prev) => !prev)}
            >
              <span>{simulatedOffline ? 'Volver a estar en línea' : 'Simular sin señal'}</span>
              {simulatedOffline ? (
                <Wifi size={15} aria-hidden="true" />
              ) : (
                <WifiOff size={15} aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              className={`sidebar-btn${gpsState === 'denied' ? ' active' : ''}`}
              onClick={() => setGpsState((prev) => (prev === 'denied' ? 'ok' : 'denied'))}
            >
              <span>{gpsState === 'denied' ? 'Restaurar GPS' : 'Simular GPS denegado'}</span>
              <LocateFixed size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default App;
