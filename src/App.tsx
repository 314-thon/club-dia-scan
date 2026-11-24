import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, RefreshCw, ScanBarcode, Wifi, WifiOff } from 'lucide-react';
import {
  expandCatalogSnapshot,
  fetchDailyCatalogSnapshot,
  fetchNearbyDiaBranches,
  loadLastSyncTime,
  lookupDiaByEanOutcome,
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
  ScanIssue,
  SyncStatus,
  TabId,
  UserPreferences,
  VisitItem,
} from './types/models';
import { formatSyncDateLabel, formatTimeHHMM, getLocalDateKey } from './utils/format';
import {
  formatAccuracyLabel,
  GeocodeCandidate,
  GeoLookupError,
  getBestPosition,
} from './utils/geo';
import { parseScannedGtin } from './utils/gtin';
import { isStandaloneHtml } from './utils/runtime';

const ScannerScreen = lazy(() =>
  import('./screens/ScannerScreen').then((m) => ({ default: m.ScannerScreen }))
);

const VISIT_STORAGE_KEY = 'clubdia_visit_items_v1';
const PREFS_STORAGE_KEY = 'clubdia_preferences_v1';
const BRANCH_STORAGE_KEY = 'clubdia_active_branch_v1';
const BRANCHES_LIST_STORAGE_KEY = 'clubdia_branches_list_v1';
const SAVED_ADDRESS_STORAGE_KEY = 'clubdia_saved_address_v1';
const CATALOG_SCHEMA_VERSION = 2;

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
    const parsed = JSON.parse(raw) as Branch;
    return parsed && typeof parsed.name === 'string' ? parsed : SEED_BRANCHES[0];
  } catch {
    return SEED_BRANCHES[0];
  }
}

function mergeBranchList(primary: Branch[], active?: Branch): Branch[] {
  const seen = new Set<string>();
  const out: Branch[] = [];

  const pushUnique = (b: Branch) => {
    const key = `${b.id}|${b.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(b);
  };

  if (active) pushUnique(active);
  for (const b of primary) pushUnique(b);
  for (const seed of SEED_BRANCHES) {
    if (!out.some((existing) => existing.name.toLowerCase() === seed.name.toLowerCase())) {
      pushUnique(seed);
    }
  }
  return out;
}

function loadStoredBranches(initialActive: Branch): Branch[] {
  try {
    const raw = localStorage.getItem(BRANCHES_LIST_STORAGE_KEY);
    if (!raw) return mergeBranchList(SEED_BRANCHES, initialActive);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return mergeBranchList(SEED_BRANCHES, initialActive);
    }
    return mergeBranchList(parsed as Branch[], initialActive);
  } catch {
    return mergeBranchList(SEED_BRANCHES, initialActive);
  }
}

function loadSavedAddressLabel(): string {
  try {
    return localStorage.getItem(SAVED_ADDRESS_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function rankSeedBranchesByCoords(lat: number, lng: number): Branch[] {
  return SEED_BRANCHES.map((b) => {
    const dLat = (b.lat - lat) * 111;
    const dLng = (b.lng - lng) * 91;
    const km = Number(Math.hypot(dLat, dLng).toFixed(1));
    return { ...b, distanceKm: km };
  }).sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('inicio');
  const [previousTab, setPreviousTab] = useState<TabId>('inicio');
  const [offersFilter, setOffersFilter] = useState<string>('Todos');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [focusSearchSeq, setFocusSearchSeq] = useState(0);

  const [activeBranch, setActiveBranch] = useState<Branch>(loadStoredBranch);
  const [branches, setBranches] = useState<Branch[]>(() => loadStoredBranches(loadStoredBranch()));
  const [savedAddressLabel, setSavedAddressLabel] = useState<string>(loadSavedAddressLabel);
  const [liveProducts, setLiveProducts] = useState<Product[]>([]);
  const [visitItems, setVisitItems] = useState<VisitItem[]>(loadStoredVisit);
  const [preferences, setPreferences] = useState<UserPreferences>(loadStoredPrefs);

  const [hydrated, setHydrated] = useState(false);
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(!navigator.onLine);
  const [lastSyncTime, setLastSyncTime] = useState<string>(loadLastSyncTime);
  const [lastSyncDateKey, setLastSyncDateKey] = useState<string | undefined>(undefined);
  const [lastSchemaVersion, setLastSchemaVersion] = useState<number | undefined>(undefined);
  const [imageSync, setImageSync] = useState<ImageSyncProgress>(INITIAL_IMAGE_SYNC);
  const [gpsState, setGpsState] = useState<'ok' | 'approximate' | 'idle' | 'denied'>('ok');
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [gpsMessageTone, setGpsMessageTone] = useState<'info' | 'warning'>('info');
  const [locatingBranches, setLocatingBranches] = useState(false);
  const [refreshingLive, setRefreshingLive] = useState(false);
  const [lookingUpEan, setLookingUpEan] = useState(false);
  const [activeLookupCode, setActiveLookupCode] = useState<string | null>(null);
  const [scanIssue, setScanIssue] = useState<ScanIssue | null>(null);

  const isOffline = simulatedOffline || browserOffline;
  const standaloneMode = isStandaloneHtml();

  const catalogSyncInFlightRef = useRef(false);
  const imageAbortRef = useRef<AbortController | null>(null);
  const liveProductsRef = useRef<Product[]>([]);
  const lastSyncDateKeyRef = useRef<string | undefined>(undefined);
  const lastSchemaVersionRef = useRef<number | undefined>(undefined);
  const selectedProductRef = useRef<Product | null>(null);
  const lookupSeqRef = useRef(0);
  const lookupAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    liveProductsRef.current = liveProducts;
  }, [liveProducts]);

  useEffect(() => {
    lastSyncDateKeyRef.current = lastSyncDateKey;
  }, [lastSyncDateKey]);

  useEffect(() => {
    lastSchemaVersionRef.current = lastSchemaVersion;
  }, [lastSchemaVersion]);

  useEffect(() => {
    selectedProductRef.current = selectedProduct;
  }, [selectedProduct]);

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

  useEffect(() => {
    try {
      localStorage.setItem(BRANCHES_LIST_STORAGE_KEY, JSON.stringify(branches));
    } catch {
      // ignore
    }
  }, [branches]);

  useEffect(() => {
    try {
      if (savedAddressLabel) {
        localStorage.setItem(SAVED_ADDRESS_STORAGE_KEY, savedAddressLabel);
      }
    } catch {
      // ignore
    }
  }, [savedAddressLabel]);

  const runIncrementalImages = useCallback(async (products: Product[], dateKey: string) => {
    imageAbortRef.current?.abort();
    const controller = new AbortController();
    imageAbortRef.current = controller;

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
          schemaVersion: CATALOG_SCHEMA_VERSION,
          productCount: expanded.length,
          discountedCount: snapshot.discountedCount,
          source,
        };

        setLiveProducts(expanded);
        liveProductsRef.current = expanded;
        setLastSyncTime(timeHHMM);
        setLastSyncDateKey(todayKey);
        lastSyncDateKeyRef.current = todayKey;
        setLastSchemaVersion(CATALOG_SCHEMA_VERSION);
        lastSchemaVersionRef.current = CATALOG_SCHEMA_VERSION;
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
        setLastSchemaVersion(storedMeta.schemaVersion);
        lastSchemaVersionRef.current = storedMeta.schemaVersion;
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

  // 2. Daily automatic sync (once per day, or if schemaVersion bumped) + incremental photo resume
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
      const syncedSchema = lastSchemaVersionRef.current;

      if (existing.length === 0) {
        const loaded = await syncCatalogSnapshot(false, !standaloneMode);
        if (cancelled || !loaded || standaloneMode) return;
        const meta = await getCatalogSyncMeta();
        if (!cancelled && meta && meta.snapshotVersion !== todayKey) {
          void syncCatalogSnapshot(true, true);
        }
        return;
      }

      if (standaloneMode) return;

      // Nuevo día o actualización de esquema del catálogo (limpieza de códigos sin EAN)
      if (syncedDate !== todayKey || syncedSchema !== CATALOG_SCHEMA_VERSION) {
        await syncCatalogSnapshot(true, true);
        return;
      }

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
      lookupAbortRef.current?.abort();
    };
  }, []);

  const handleForceRefresh = useCallback(async () => {
    if (isOffline) return;
    await syncCatalogSnapshot(true, true);
  }, [isOffline, syncCatalogSnapshot]);

  const handleOpenProduct = useCallback(
    (product: Product) => {
      setPreviousTab(activeTab);
      selectedProductRef.current = product;
      setSelectedProduct(product);
    },
    [activeTab]
  );

  const handleSelectTab = useCallback(
    (tab: TabId) => {
      if (tab === 'escaner' && activeTab !== 'escaner') {
        setPreviousTab(activeTab);
      }
      lookupAbortRef.current?.abort();
      setLookingUpEan(false);
      setActiveLookupCode(null);
      selectedProductRef.current = null;
      setSelectedProduct(null);
      setScanIssue(null);
      setActiveTab(tab);
    },
    [activeTab]
  );

  const handleOpenOffers = useCallback((filter = 'Todos') => {
    selectedProductRef.current = null;
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

  const handleAddToVisitIfMissing = useCallback((product: Product) => {
    setVisitItems((prev) => {
      const idx = prev.findIndex((i) => i.product.ean === product.ean);
      if (idx >= 0) {
        // Actualizar datos de precio por si refrescó en vivo sin alterar la cantidad elegida
        const copy = [...prev];
        copy[idx] = { ...copy[idx], product };
        return copy;
      }
      return [{ product, quantity: 1, addedAt: formatTimeHHMM() }, ...prev];
    });
  }, []);

  const syncUpdatedProductEverywhere = useCallback((fresh: Product, matchedEans: string[]) => {
    const eanSet = new Set([fresh.ean, ...matchedEans]);
    void upsertProductInDb(fresh);

    setLiveProducts((prev) => {
      const idx = prev.findIndex((p) => eanSet.has(p.ean));
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = fresh;
        return copy;
      }
      return [fresh, ...prev];
    });

    setVisitItems((prev) =>
      prev.map((item) => (eanSet.has(item.product.ean) ? { ...item, product: fresh } : item))
    );

    // Solo actualizar la ficha abierta si el usuario sigue viendo ese mismo producto
    if (selectedProductRef.current && eanSet.has(selectedProductRef.current.ean)) {
      selectedProductRef.current = fresh;
      setSelectedProduct(fresh);
    }
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

  const showScanIssueSafely = useCallback((issue: ScanIssue) => {
    // Nunca cerrar una ficha de producto ya abierta por una lectura rezagada
    if (selectedProductRef.current) return;
    setDialog(null);
    setScanIssue(issue);
    setActiveTab('escaner');
  }, []);

  const handleLookupEan = useCallback(
    async (rawCode: string, formatHint?: string) => {
      const rawDigits = rawCode.replace(/\D/g, '');
      if (!rawDigits) return;

      lookupAbortRef.current?.abort();
      const seq = ++lookupSeqRef.current;
      const controller = new AbortController();
      lookupAbortRef.current = controller;

      setScanIssue(null);

      // 0) Compatibilidad inmediata con productos de vidriera / códigos de prueba en memoria
      const directSeedHit = allProducts.find((p) => p.ean === rawDigits);
      if (directSeedHit) {
        setLookingUpEan(false);
        setActiveLookupCode(null);
        setDialog(null);
        handleAddToVisitIfMissing(directSeedHit);
        handleOpenProduct(directSeedHit);
        return;
      }

      // 1) Validar estructura GTIN, dígito verificador y productos pesables
      const parsed = parseScannedGtin(rawDigits, formatHint);

      if (parsed.status === 'invalid') {
        setLookingUpEan(false);
        setActiveLookupCode(null);
        showScanIssueSafely({
          kind: 'invalid-code',
          code: parsed.rawDigits,
          title: 'Código de barras incompleto o inválido',
          description:
            parsed.reason === 'length'
              ? 'El código debe tener 8, 12 o 13 números (EAN / UPC). Revisá los dígitos debajo de las barras.'
              : 'Alguno de los dígitos no coincide con el verificador del envase. Revisá el número o volvé a escanear.',
        });
        return;
      }

      if (parsed.status === 'weighable') {
        setLookingUpEan(false);
        setActiveLookupCode(null);
        showScanIssueSafely({
          kind: 'weighable',
          code: parsed.canonicalEan,
          title: 'Producto de balanza (peso variable)',
          description:
            'Los frescos fraccionados en tienda (fiambres, carnes o verdulería) ya traen el importe final impreso en su etiqueta.',
        });
        return;
      }

      setActiveLookupCode(parsed.canonicalEan);
      setLookingUpEan(true);

      try {
        // 2) Offline-first instantáneo: buscar en IndexedDB / memoria en <10 ms
        let cachedHit: Product | null = null;
        for (const cand of parsed.lookupCandidates) {
          const fromDb = await getProductByEanFromDb(cand);
          if (fromDb) {
            cachedHit = fromDb;
            break;
          }
          const fromMem = allProducts.find((p) => p.ean === cand);
          if (fromMem) {
            cachedHit = fromMem;
            break;
          }
        }

        if (seq !== lookupSeqRef.current || controller.signal.aborted) return;

        if (cachedHit) {
          setLookingUpEan(false);
          setActiveLookupCode(null);
          setDialog(null);
          handleAddToVisitIfMissing(cachedHit);
          handleOpenProduct(cachedHit);

          // Refresco silencioso en segundo plano para asegurar el precio en vivo de hoy
          if (!isOffline && !standaloneMode) {
            void lookupDiaByEanOutcome(parsed.lookupCandidates, undefined, 6000)
              .then((outcome) => {
                if (outcome.status === 'found') {
                  syncUpdatedProductEverywhere(outcome.product, parsed.lookupCandidates);
                }
              })
              .catch(() => {
                // Conservar el precio cacheado si falla el refresco silencioso
              });
          }
          return;
        }

        // 3) Si no está en la base local y está offline, informar claramente
        if (isOffline || standaloneMode) {
          showScanIssueSafely({
            kind: 'not-found',
            code: parsed.canonicalEan,
            title: 'No está en tus precios guardados',
            description:
              'Sin conexión solo podemos consultar los ~5.000 artículos sincronizados hoy. Conectate para buscarlo en vivo.',
          });
          return;
        }

        // 4) Consulta en vivo a Dia Online con timeout de 6 s y 1 reintento
        const outcome = await lookupDiaByEanOutcome(
          parsed.lookupCandidates,
          controller.signal,
          6000
        );

        if (seq !== lookupSeqRef.current || controller.signal.aborted) return;

        if (outcome.status === 'found') {
          syncUpdatedProductEverywhere(outcome.product, parsed.lookupCandidates);
          setDialog(null);
          handleAddToVisitIfMissing(outcome.product);
          handleOpenProduct(outcome.product);
          return;
        }

        if (outcome.status === 'error') {
          showScanIssueSafely({
            kind: 'network',
            code: parsed.canonicalEan,
            title: 'Sin respuesta de Dia Online',
            description:
              'La consulta tardó demasiado o se cortó la señal, y este código no estaba en el catálogo guardado hoy.',
          });
          return;
        }

        showScanIssueSafely({
          kind: 'not-found',
          code: parsed.canonicalEan,
          title: 'No encontramos este producto en Dia',
          description:
            'El código se leyó bien, pero este artículo no figura hoy en el catálogo de Dia Online (puede ser exclusivo de tienda física).',
        });
      } finally {
        if (seq === lookupSeqRef.current) {
          setLookingUpEan(false);
          setActiveLookupCode(null);
        }
      }
    },
    [
      allProducts,
      handleAddToVisitIfMissing,
      handleOpenProduct,
      isOffline,
      showScanIssueSafely,
      standaloneMode,
      syncUpdatedProductEverywhere,
    ]
  );

  const handleLocateBranches = useCallback(async () => {
    setGpsMessage(null);
    setLocatingBranches(true);

    try {
      const pos = await getBestPosition();

      if (standaloneMode) {
        const ranked = rankSeedBranchesByCoords(pos.lat, pos.lng);
        setBranches(ranked);
        if (pos.isApproximate) {
          setGpsState('approximate');
          setGpsMessageTone('warning');
          setGpsMessage(
            `Ubicación aproximada (${formatAccuracyLabel(
              pos.accuracyMeters
            )}). Elegí tu sucursal de la lista.`
          );
          setDialog({ type: 'branches', focusAddress: true });
        } else {
          setGpsState('ok');
          setGpsMessageTone('info');
          setActiveBranch(ranked[0]);
          setGpsMessage(
            `Sucursal más cercana detectada: ${ranked[0].name} (a ${ranked[0].distanceKm} km).`
          );
        }
        return;
      }

      const liveBranches = await fetchNearbyDiaBranches(pos.lat, pos.lng);

      if (pos.isApproximate) {
        setGpsState('approximate');
        setGpsMessageTone('warning');
        if (liveBranches.length > 0) {
          setBranches((prev) => mergeBranchList(liveBranches, prev[0]));
        }
        setGpsMessage(
          `Tu navegador dio una ubicación aproximada (${formatAccuracyLabel(
            pos.accuracyMeters
          )}). Para no asignarte otro barrio, escribí tu dirección o barrio arriba.`
        );
        setDialog({ type: 'branches', focusAddress: true });
        return;
      }

      setGpsState('ok');
      setGpsMessageTone('info');

      if (liveBranches.length > 0) {
        const nextList = mergeBranchList(liveBranches, liveBranches[0]);
        setBranches(nextList);
        setActiveBranch(liveBranches[0]);
        setGpsMessage(
          `Ubicación precisa (${formatAccuracyLabel(pos.accuracyMeters)}) · Seleccionamos ${
            liveBranches[0].name
          }. Podés cambiarla en la lista.`
        );
      } else {
        setGpsMessageTone('warning');
        setGpsMessage(
          'No encontramos sucursales cercanas en Dia Online; probá escribir tu barrio o elegí de la lista.'
        );
      }
    } catch (err) {
      setGpsMessageTone('warning');
      if (err instanceof GeoLookupError) {
        if (err.kind === 'permission-denied') {
          setGpsState('denied');
        }
        setGpsMessage(err.message);
      } else {
        setGpsMessage(
          'No pudimos consultar las sucursales cercanas ahora. Probá escribir tu dirección o barrio.'
        );
      }
      setDialog((prev) =>
        prev?.type === 'branches' ? prev : { type: 'branches', focusAddress: true }
      );
    } finally {
      setLocatingBranches(false);
    }
  }, [standaloneMode]);

  const handleResolveAddressBranches = useCallback(
    async (candidate: GeocodeCandidate) => {
      const addressSummary = candidate.subtitle
        ? `${candidate.label}, ${candidate.subtitle}`
        : candidate.label;
      setSavedAddressLabel(addressSummary);
      setGpsMessage(null);
      setLocatingBranches(true);

      try {
        if (standaloneMode) {
          const ranked = rankSeedBranchesByCoords(candidate.lat, candidate.lng);
          setBranches(ranked);
          setActiveBranch(ranked[0]);
          setGpsState('ok');
          setGpsMessageTone('info');
          setGpsMessage(`Mostrando sucursales cercanas a ${candidate.label}.`);
          return;
        }

        const liveBranches = await fetchNearbyDiaBranches(candidate.lat, candidate.lng);
        if (liveBranches.length > 0) {
          const nextList = mergeBranchList(liveBranches, liveBranches[0]);
          setBranches(nextList);
          setActiveBranch(liveBranches[0]);
          setGpsState('ok');
          setGpsMessageTone('info');
          setGpsMessage(
            `Encontramos ${liveBranches.length} sucursales cerca de ${candidate.label}. Seleccionamos ${liveBranches[0].name}.`
          );
        } else {
          setGpsMessageTone('warning');
          setGpsMessage(
            `No encontramos tiendas Dia cerca de ${candidate.label}. Probá con otra calle o localidad.`
          );
        }
      } catch {
        setGpsMessageTone('warning');
        setGpsMessage('No pudimos consultar las sucursales de esa zona. Revisá tu conexión.');
      } finally {
        setLocatingBranches(false);
      }
    },
    [standaloneMode]
  );

  const handleSearchByNameFromScanner = useCallback(() => {
    selectedProductRef.current = null;
    setSelectedProduct(null);
    setScanIssue(null);
    setActiveTab('inicio');
    setFocusSearchSeq((n) => n + 1);
  }, []);

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
            onBack={() => {
              selectedProductRef.current = null;
              setSelectedProduct(null);
            }}
            onScanAnother={() => {
              selectedProductRef.current = null;
              setSelectedProduct(null);
              setScanIssue(null);
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
            focusSearchSeq={focusSearchSeq}
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
              scanIssue={scanIssue}
              lookingUpEan={lookingUpEan}
              activeLookupCode={activeLookupCode}
              onBack={() => handleSelectTab(previousTab === 'escaner' ? 'inicio' : previousTab)}
              onOpenBranches={() => setDialog({ type: 'branches' })}
              onOpenManualEan={(initialCode) => setDialog({ type: 'manual-ean', initialCode })}
              onSearchByName={handleSearchByNameFromScanner}
              onOpenVisitList={() => setDialog({ type: 'visit-list' })}
              onRemoveVisitItem={handleRemoveVisitItem}
              onSelectProduct={handleOpenProduct}
              onDetectedCode={handleLookupEan}
              onClearScanIssue={() => setScanIssue(null)}
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
            onOpenBranches={() => setDialog({ type: 'branches', focusAddress: true })}
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
            setBranches((prev) => mergeBranchList(prev, b));
            setGpsState('ok');
          }}
          onLocateBranches={handleLocateBranches}
          onResolveAddressBranches={handleResolveAddressBranches}
          savedAddressLabel={savedAddressLabel}
          locatingBranches={locatingBranches}
          gpsMessage={gpsMessage}
          gpsMessageTone={gpsMessageTone}
          onLookupEan={(code) => handleLookupEan(code)}
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
                {imageSync.cached.toLocaleString('es-AR')}/{imageSync.total.toLocaleString('es-AR')}{' '}
                ({imagePct}%)
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
                <RefreshCw
                  size={15}
                  className={refreshingLive ? 'spin' : undefined}
                  aria-hidden="true"
                />
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
