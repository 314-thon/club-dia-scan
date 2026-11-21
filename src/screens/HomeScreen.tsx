import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  Loader2,
  QrCode,
  Search,
  X,
} from 'lucide-react';
import { BranchBar } from '../components/BranchBar';
import { Branch, Product, SyncStatus } from '../types/models';
import { FALLBACK_PRODUCT_IMG, formatARS } from '../utils/format';
import { isFileProtocol } from '../utils/runtime';

interface HomeScreenProps {
  branch: Branch;
  sync: SyncStatus;
  featuredDeals: Product[];
  totalOffersCount: number;
  habitualDealsCount: number;
  onOpenBranches: () => void;
  onOpenCard: () => void;
  onOpenNotifications: () => void;
  onOpenOffers: (filter?: string) => void;
  onSelectProduct: (product: Product) => void;
  onSearchProducts: (query: string) => Promise<Product[]>;
}

export function HomeScreen({
  branch,
  sync,
  featuredDeals,
  totalOffersCount,
  habitualDealsCount,
  onOpenBranches,
  onOpenCard,
  onOpenNotifications,
  onOpenOffers,
  onSelectProduct,
  onSearchProducts,
}: HomeScreenProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Product[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults(null);
      setSearchError(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    setSearchError(null);

    const timer = window.setTimeout(async () => {
      try {
        const results = await onSearchProducts(trimmed);
        if (!cancelled) {
          setSearchResults(results);
        }
      } catch {
        if (!cancelled) {
          setSearchError('No pudimos consultar el catálogo en vivo. Mostramos precios guardados.');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, onSearchProducts]);

  return (
    <main className="screen-scroll">
      <header className="home-header">
        <span className="brand-wordmark" aria-label="Club Dia">
          Dia
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Ver avisos de hoy"
          onClick={onOpenNotifications}
        >
          <Bell size={22} strokeWidth={1.9} aria-hidden="true" />
          <span className="notif-dot" aria-hidden="true" />
        </button>
      </header>

      <BranchBar branch={branch} sync={sync} onOpenBranches={onOpenBranches} />

      {sync.gpsState === 'denied' && (
        <div className="amber-banner" role="status">
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>
            Ubicación desactivada. Tocá la sucursal de arriba para elegir tu tienda manualmente.
          </span>
        </div>
      )}

      <div className="search-box" role="search">
        <Search size={19} color="#5C5E66" aria-hidden="true" />
        <input
          type="search"
          className="search-input"
          placeholder="Buscar producto o marca"
          aria-label="Buscar producto o marca en Dia"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <Loader2 size={18} color="#5C5E66" aria-hidden="true" />}
        {query && !searching && (
          <button
            type="button"
            className="search-clear"
            aria-label="Borrar búsqueda"
            onClick={() => setQuery('')}
          >
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>

      {searchResults !== null ? (
        <section aria-label="Resultados de búsqueda">
          <div className="section-row" style={{ marginBottom: 8 }}>
            <h2 className="section-heading">Resultados para “{query.trim()}”</h2>
            <span className="section-count">{searchResults.length} productos</span>
          </div>

          {searchError && (
            <div className="amber-banner" style={{ marginBottom: 10 }}>
              <span>{searchError}</span>
            </div>
          )}

          {searchResults.length === 0 ? (
            <div className="card empty-state">
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink)' }}>
                No encontramos productos con ese nombre
              </p>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Probá con otra palabra (ej. leche, fideos, yerba o aceite) o escaneá el código.
              </p>
            </div>
          ) : (
            <div className="card-flush">
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="deal-row"
                  onClick={() => onSelectProduct(item)}
                >
                  <div className="thumb-64">
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
                    <div className="deal-top">
                      <div className="deal-title">{item.name}</div>
                      {item.discountPct > 0 && (
                        <span className="discount-badge">-{item.discountPct}%</span>
                      )}
                    </div>
                    <div className="deal-sub">{item.subtitle}</div>
                    <div className="deal-price-row">
                      <div className="price-group">
                        <span className="price-now">{formatARS(item.price)}</span>
                        {item.discountPct > 0 && (
                          <span className="price-old">{formatARS(item.listPrice)}</span>
                        )}
                      </div>
                      {item.savings > 0 ? (
                        <span className="saving-inline">Ahorrás {formatARS(item.savings)}</span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--slate)' }}>
                          {item.source === 'dia-live' ? 'Dia en vivo' : 'Sin descuento hoy'}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="card" aria-label="Resumen de ahorro mensual">
            <div className="savings-label">Ahorraste en noviembre</div>
            <div className="savings-amount">$ 34.890</div>
            <div>
              <span className="pill-stone">15,9% menos que el precio de lista · 6 compras</span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              style={{ marginTop: 14 }}
              onClick={onOpenCard}
            >
              <QrCode size={19} strokeWidth={1.9} aria-hidden="true" />
              <span>Mi tarjeta</span>
            </button>
          </section>

          <section aria-label="Descuentos de hoy">
            <div className="section-row" style={{ marginBottom: 10 }}>
              <h2 className="section-heading">Descuentos de hoy</h2>
              <button
                type="button"
                className="section-link"
                onClick={() => onOpenOffers('Todos')}
              >
                Ver los {totalOffersCount}
              </button>
            </div>

            <div className="card-flush">
              {featuredDeals.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="deal-row"
                  onClick={() => onSelectProduct(item)}
                >
                  <div className="thumb-64">
                    <img src={item.imageUrl} alt={item.name} className="thumb-img" />
                  </div>
                  <div className="deal-body">
                    <div className="deal-top">
                      <div className="deal-title">{item.name}</div>
                      {item.discountPct > 0 && (
                        <span className="discount-badge">-{item.discountPct}%</span>
                      )}
                    </div>
                    <div className="deal-sub">{item.subtitle}</div>
                    <div className="deal-price-row">
                      <div className="price-group">
                        <span className="price-now">{formatARS(item.price)}</span>
                        {item.discountPct > 0 && (
                          <span className="price-old">{formatARS(item.listPrice)}</span>
                        )}
                      </div>
                      {item.savings > 0 && (
                        <span className="saving-inline">Ahorrás {formatARS(item.savings)}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <button
            type="button"
            className="stone-callout"
            onClick={() => onOpenOffers('Para vos')}
          >
            <span>
              {habitualDealsCount} de tus compras habituales tienen descuento hoy
            </span>
            <ChevronRight size={20} color="#5C5E66" aria-hidden="true" />
          </button>
        </>
      )}
    </main>
  );
}
