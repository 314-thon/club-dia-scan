import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  ScanBarcode,
  Store,
} from 'lucide-react';
import { Branch, Product } from '../types/models';
import { FALLBACK_PRODUCT_IMG, formatARS, formatARSTight } from '../utils/format';
import { isFileProtocol } from '../utils/runtime';

interface ProductScreenProps {
  product: Product;
  branch: Branch;
  inVisitList: boolean;
  isStale: boolean;
  onBack: () => void;
  onScanAnother: () => void;
  onToggleVisitList: (product: Product) => void;
  onCompareBranches: (product: Product) => void;
}

export function ProductScreen({
  product,
  branch,
  inVisitList,
  isStale,
  onBack,
  onScanAnother,
  onToggleVisitList,
  onCompareBranches,
}: ProductScreenProps) {
  const hasPromo = product.discountPct > 0 && product.savings > 0;
  const maxUnits = product.limitQty ?? 4;
  const maxUnitsSavings = product.savings * maxUnits;

  return (
    <>
      <main className="screen-scroll no-nav">
        <header className="screen-header">
          <div className="screen-header-left">
            <button
              type="button"
              className="icon-btn"
              style={{ marginLeft: -10 }}
              aria-label="Volver a la pantalla anterior"
              onClick={onBack}
            >
              <ChevronLeft size={24} strokeWidth={2} aria-hidden="true" />
            </button>
            <h1 className="screen-title">Producto</h1>
          </div>
          {product.source === 'dia-live' && <span className="source-tag">Dia en vivo</span>}
        </header>

        {isStale && (
          <div className="amber-banner" role="status">
            <span>
              Estos precios corresponden a la última sincronización guardada. Conectate para
              confirmar cambios de hoy.
            </span>
          </div>
        )}

        <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="thumb-72">
            <img
              src={product.imageUrl}
              alt={product.name}
              className="thumb-img"
              crossOrigin={
                product.imageUrl.startsWith('https://') && !isFileProtocol()
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
          <div style={{ flex: 1, minInlineSize: 0 }}>
            <div className="product-cat-over">{product.subtitle}</div>
            <h2 className="product-detail-title">{product.name}</h2>
            <div className="product-ean">
              Código <span className="mono">{product.ean}</span>
            </div>
          </div>
        </section>

        <section className="card" aria-label="Precio y descuento vigente">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5, color: 'var(--ink)' }}>
              {!hasPromo && <Store size={16} color="#5C5E66" aria-hidden="true" />}
              <span>
                Precio de hoy en Sucursal <strong>{branch.name}</strong>
              </span>
            </div>
            {hasPromo && product.validRange && (
              <span
                className="pill-stone"
                style={{ marginTop: 0, fontSize: 12, padding: '4px 10px', flexShrink: 0 }}
              >
                {product.validRange}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <span className="product-price-hero">{formatARS(product.price)}</span>
            {hasPromo ? (
              <span className="discount-badge discount-badge-lg">-{product.discountPct}%</span>
            ) : (
              <span className="pill-stone" style={{ marginTop: 0, fontSize: 13 }}>
                Sin descuento hoy
              </span>
            )}
          </div>

          {hasPromo && (
            <div style={{ fontSize: 14, color: 'var(--slate)', marginTop: 6 }}>
              <span className="mono" style={{ textDecoration: 'line-through' }}>
                {formatARSTight(product.listPrice)}
              </span>{' '}
              precio regular
            </div>
          )}

          {hasPromo ? (
            <>
              <div className="pine-callout">
                <Check size={20} color="#166B45" strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <div>
                  <div className="pine-callout-title">
                    Ahorrás <span className="mono">{formatARS(product.savings)}</span> por unidad
                    con Club Dia
                  </div>
                  <div className="pine-callout-sub">
                    Mostrá tu DNI o el QR de Club Dia en caja.
                  </div>
                </div>
              </div>

              <div className="limit-grid">
                <div className="limit-row">
                  <span style={{ color: 'var(--slate)' }}>Límite por compra</span>
                  <span style={{ fontWeight: 700 }}>Hasta {maxUnits} unidades</span>
                </div>
                <div className="limit-row">
                  <span style={{ color: 'var(--slate)' }}>Con {maxUnits} unidades</span>
                  <span className="saving-inline" style={{ fontSize: 15 }}>
                    Ahorrás {formatARS(maxUnitsSavings)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="neutral-callout">
              <Info size={18} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
              <span>Hoy no hay cupón Club Dia para este producto en esta sucursal.</span>
            </div>
          )}
        </section>

        <button
          type="button"
          className="card"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            textAlign: 'left',
          }}
          onClick={() => onCompareBranches(product)}
        >
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 700 }}>Ver en otras sucursales</div>
            <div style={{ fontSize: 13.5, color: 'var(--slate)', marginTop: 2 }}>
              El descuento puede cambiar
            </div>
          </div>
          <ChevronRight size={20} color="#5C5E66" aria-hidden="true" />
        </button>
      </main>

      <div className="sticky-actions">
        <button type="button" className="btn-primary" onClick={onScanAnother}>
          <ScanBarcode size={19} aria-hidden="true" />
          <span>Escanear otro producto</span>
        </button>
        <button
          type="button"
          className={`btn-secondary${inVisitList ? ' saved-state' : ''}`}
          onClick={() => onToggleVisitList(product)}
        >
          {inVisitList ? <Check size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
          <span>{inVisitList ? 'Guardado en mi lista' : 'Guardar en mi lista'}</span>
        </button>
      </div>
    </>
  );
}
