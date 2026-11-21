import { useEffect, useMemo, useState } from 'react';
import { Calendar, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { BranchBar } from '../components/BranchBar';
import { Branch, Product, SyncStatus } from '../types/models';
import { FALLBACK_PRODUCT_IMG, formatARS } from '../utils/format';
import { isFileProtocol } from '../utils/runtime';

interface OffersScreenProps {
  branch: Branch;
  sync: SyncStatus;
  products: Product[];
  initialFilter: string;
  onOpenBranches: () => void;
  onSelectProduct: (product: Product) => void;
  onSearchProducts: (query: string) => Promise<Product[]>;
  onRefreshLive: () => Promise<void>;
  refreshingLive: boolean;
}

const FILTER_OPTIONS = [
  'Todos',
  'Para vos',
  'En vivo Dia',
  'Almacén',
  'Lácteos',
  'Limpieza',
  'Bebidas',
  'Frescos',
  'Perfumería',
];

const PAGE_STEP = 40;

export function OffersScreen({
  branch,
  sync,
  products,
  initialFilter,
  onOpenBranches,
  onSelectProduct,
  onSearchProducts,
  onRefreshLive,
  refreshingLive,
}: OffersScreenProps) {
  const [activeFilter, setActiveFilter] = useState(initialFilter || 'Todos');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [remoteResults, setRemoteResults] = useState<Product[] | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_STEP);

  useEffect(() => {
    if (initialFilter) {
      setActiveFilter(initialFilter);
      setVisibleLimit(PAGE_STEP);
    }
  }, [initialFilter]);

  useEffect(() => {
    setVisibleLimit(PAGE_STEP);
  }, [activeFilter, remoteResults]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!searchOpen || trimmed.length < 2) {
      setRemoteResults(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await onSearchProducts(trimmed);
        if (!cancelled) setRemoteResults(res);
      } catch {
        if (!cancelled) setRemoteResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchOpen, onSearchProducts]);

  const discountedCatalog = useMemo(
    () => products.filter((p) => p.discountPct > 0),
    [products]
  );

  const habitualCount = useMemo(
    () => discountedCatalog.filter((p) => p.isHabitual).length,
    [discountedCatalog]
  );

  const liveCount = useMemo(
    () => discountedCatalog.filter((p) => p.source === 'dia-live').length,
    [discountedCatalog]
  );

  const visibleProducts = useMemo(() => {
    if (remoteResults !== null) return remoteResults;
    if (activeFilter === 'Todos') return discountedCatalog;
    if (activeFilter === 'Para vos') return discountedCatalog.filter((p) => p.isHabitual);
    if (activeFilter === 'En vivo Dia') {
      return discountedCatalog.filter((p) => p.source === 'dia-live');
    }
    return discountedCatalog.filter((p) => p.category === activeFilter);
  }, [activeFilter, discountedCatalog, remoteResults]);

  const pagedProducts = useMemo(
    () => visibleProducts.slice(0, visibleLimit),
    [visibleProducts, visibleLimit]
  );

  const totalCountLabel = Math.max(42, discountedCatalog.length);

  return (
    <main className="screen-scroll">
      <header className="screen-header">
        <h1 className="screen-title">Ofertas y cupones</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Actualizar ofertas en vivo desde Dia"
            onClick={onRefreshLive}
            disabled={refreshingLive || sync.mode === 'offline'}
          >
            {refreshingLive ? (
              <Loader2 size={20} className="spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={20} strokeWidth={1.9} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={searchOpen ? 'Cerrar buscador de ofertas' : 'Buscar ofertas'}
            onClick={() => {
              setSearchOpen((prev) => !prev);
              setQuery('');
              setRemoteResults(null);
            }}
          >
            {searchOpen ? (
              <X size={21} aria-hidden="true" />
            ) : (
              <Search size={21} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className="search-box" role="search">
          <Search size={18} color="#5C5E66" aria-hidden="true" />
          <input
            type="search"
            className="search-input"
            placeholder="Buscá en todo el catálogo de Dia..."
            aria-label="Buscar ofertas en catálogo Dia"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {searching && <Loader2 size={18} color="#5C5E66" className="spin" aria-hidden="true" />}
        </div>
      )}

      <BranchBar
        branch={branch}
        sync={sync}
        showLeadingIcon
        onOpenBranches={onOpenBranches}
      />

      {remoteResults === null && (
        <div className="chips-strip" role="tablist" aria-label="Filtrar ofertas por categoría">
          {FILTER_OPTIONS.map((option) => {
            let label = option;
            if (option === 'Todos') label = `Todos (${totalCountLabel.toLocaleString('es-AR')})`;
            if (option === 'Para vos') label = `Para vos (${habitualCount})`;
            if (option === 'En vivo Dia') label = `En vivo Dia (${liveCount.toLocaleString('es-AR')})`;

            const isActive = activeFilter === option;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`chip${isActive ? ' active' : ''}`}
                onClick={() => setActiveFilter(option)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {pagedProducts.length === 0 ? (
        <div className="card empty-state">
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>
            Sin ofertas en esta categoría ahora
          </p>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            Probá otra pestaña o usá el buscador para consultar el catálogo de Dia.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pagedProducts.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              className={`offer-card${idx >= 6 ? ' offer-card-deferred' : ''}`}
              onClick={() => onSelectProduct(item)}
            >
              <div className="offer-main">
                <div className="thumb-72">
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="thumb-img"
                    loading="lazy"
                    crossOrigin={
                      item.imageUrl.startsWith('https://') && !isFileProtocol()
                        ? 'anonymous'
                        : undefined
                    }
                    onError={(e) => {
                      if (e.currentTarget.src !== FALLBACK_PRODUCT_IMG) {
                        e.currentTarget.src = FALLBACK_PRODUCT_IMG;
                      }
                    }}
                  />
                </div>
                <div className="deal-body">
                  <div className="deal-title">{item.name}</div>
                  <div className="offer-prices">
                    <span className="price-now">{formatARS(item.price)}</span>
                    {item.discountPct > 0 && (
                      <>
                        <span className="price-old">{formatARS(item.listPrice)}</span>
                        <span className="discount-badge">-{item.discountPct}%</span>
                      </>
                    )}
                  </div>
                  {item.savings > 0 ? (
                    <div className="saving-inline" style={{ marginTop: 4 }}>
                      Ahorrás {formatARS(item.savings)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--slate)', marginTop: 4 }}>
                      Sin descuento hoy
                    </div>
                  )}
                </div>
              </div>

              <hr className="dashed-divider" />

              <div className="offer-footer">
                <span className="offer-validity">
                  <Calendar size={14} aria-hidden="true" />
                  <span>{item.validRange ?? 'Precio vigente hoy'}</span>
                </span>
                <span>
                  {branch.name} ·{' '}
                  {item.limitQty
                    ? `Hasta ${item.limitQty} u.`
                    : item.source === 'dia-live'
                      ? 'Dia Online'
                      : 'En tienda'}
                </span>
              </div>
            </button>
          ))}

          {visibleProducts.length > pagedProducts.length && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setVisibleLimit((prev) => prev + PAGE_STEP)}
            >
              Ver más ofertas ({pagedProducts.length} de {visibleProducts.length.toLocaleString('es-AR')})
            </button>
          )}
        </div>
      )}
    </main>
  );
}
