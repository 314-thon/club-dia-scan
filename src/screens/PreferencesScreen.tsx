import { AlertTriangle, ChevronRight, Database, Loader2, RefreshCw } from 'lucide-react';
import { SwitchControl } from '../components/SwitchControl';
import {
  Branch,
  CategoryBreakdown,
  Product,
  SyncStatus,
  UserPreferences,
} from '../types/models';
import { formatARS, formatSyncDateLabel } from '../utils/format';
import { isStandaloneHtml } from '../utils/runtime';

interface PreferencesScreenProps {
  branch: Branch;
  sync: SyncStatus;
  breakdown: CategoryBreakdown[];
  habitualProducts: Product[];
  preferences: UserPreferences;
  refreshingCatalog: boolean;
  onChangePreferences: (next: UserPreferences) => void;
  onSelectProduct: (product: Product) => void;
  onOpenPrivacy: () => void;
  onOpenOffersForYou: () => void;
  onRequestLocation: () => Promise<void>;
  onRefreshCatalog: () => Promise<void>;
}

export function PreferencesScreen({
  branch,
  sync,
  breakdown,
  habitualProducts,
  preferences,
  refreshingCatalog,
  onChangePreferences,
  onSelectProduct,
  onOpenPrivacy,
  onOpenOffersForYou,
  onRequestLocation,
  onRefreshCatalog,
}: PreferencesScreenProps) {
  const handleToggleArrival = (checked: boolean) => {
    onChangePreferences({ ...preferences, branchArrivalAlert: checked });
    if (checked) {
      void onRequestLocation();
    }
  };

  const standalone = isStandaloneHtml();
  const imgSync = sync.imageSync;
  const imgPct =
    imgSync.total > 0 ? Math.min(100, Math.round((imgSync.cached / imgSync.total) * 100)) : 0;
  const estMbCached = ((imgSync.cached * 5.2) / 1024).toFixed(1).replace('.', ',');
  const estMbTotal = Math.max(1, Math.round((imgSync.total * 5.2) / 1024));
  const isBusy = refreshingCatalog || imgSync.status === 'syncing' || imgSync.status === 'checking';

  let imgStatusNote = standalone
    ? 'Catálogo completo incluido en el prototipo HTML. Funciona sin servidor ni señal en góndola.'
    : 'Actualización automática 1 vez por día. Las fotos ya guardadas no se vuelven a descargar.';
  if (!standalone && imgSync.status === 'syncing') {
    imgStatusNote = `Descargando solo fotos nuevas (${imgSync.downloadedNow.toLocaleString('es-AR')} nuevas · ${imgSync.skipped.toLocaleString('es-AR')} reutilizadas)...`;
  } else if (!standalone && (imgSync.status === 'paused' || sync.mode === 'offline')) {
    imgStatusNote =
      imgSync.cached < imgSync.total
        ? 'En pausa sin señal. Retoma automáticamente desde donde quedó al reconectarte.'
        : 'Base completa disponible sin señal en góndola.';
  } else if (!standalone && imgSync.status === 'done' && imgSync.total > 0) {
    imgStatusNote =
      imgSync.skipped > 0 && imgSync.downloadedNow === 0
        ? `Listo sin señal · ${imgSync.skipped.toLocaleString('es-AR')} fotos reutilizadas sin volver a bajar.`
        : `Listo sin señal · ${imgSync.downloadedNow.toLocaleString('es-AR')} nuevas, ${imgSync.skipped.toLocaleString('es-AR')} ya existentes.`;
  }

  return (
    <main className="screen-scroll">
      <header>
        <h1 className="screen-title">Preferencias</h1>
        <p className="screen-subtitle">
          Cómo usamos tus compras para mostrarte descuentos
        </p>
      </header>

      <section className="card" aria-label="Categorías más compradas">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <h2 className="section-heading" style={{ fontSize: 18 }}>
            Lo que más comprás
          </h2>
          <span className="pill-stone" style={{ marginTop: 0, fontSize: 12.5, padding: '4px 12px' }}>
            Noviembre
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {breakdown.map((cat) => (
            <div key={cat.label} className="cat-bar-item">
              <div className="cat-bar-top">
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{cat.label}</span>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 13.5 }}>{cat.pct}%</strong>
                  <span className="mono" style={{ fontSize: 13.5, color: 'var(--slate)' }}>
                    {formatARS(cat.amount)}
                  </span>
                </span>
              </div>
              <div className="cat-bar-track" aria-hidden="true">
                <div className="cat-bar-fill" style={{ width: `${cat.pct}%` }} />
              </div>
            </div>
          ))}
        </div>

        <hr className="divider" style={{ margin: '16px 0 12px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 14.5, color: 'var(--slate)' }}>Ahorraste</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--pine)' }}>
            $ 34.890
          </span>
        </div>
      </section>

      <section aria-label="Habituales con descuento hoy">
        <div style={{ marginBottom: 10 }}>
          <h2 className="section-heading">Habituales con descuento hoy</h2>
          <div style={{ fontSize: 13.5, color: 'var(--slate)', marginTop: 2 }}>
            Sucursal {branch.name}
          </div>
        </div>

        {preferences.personalizedDeals ? (
          <div className="card-flush">
            {habitualProducts.map((item) => (
              <button
                key={item.id}
                type="button"
                className="habitual-row"
                onClick={() => onSelectProduct(item)}
              >
                <div style={{ minInlineSize: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--slate)', marginTop: 2 }}>
                    {item.habitualFreq ?? 'Compra frecuente'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
                    {formatARS(item.price)}
                  </span>
                  {item.discountPct > 0 && (
                    <span className="discount-badge">-{item.discountPct}%</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="card">
            <p style={{ margin: 0, fontSize: 14, color: 'var(--slate)' }}>
              Pausaste las recomendaciones según tus compras. Podés volver a activarlas abajo
              cuando quieras.
            </p>
          </div>
        )}
      </section>

      <section className="card" aria-label="Catálogo y fotos sin conexión">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={18} color="#166B45" aria-hidden="true" />
            <h2 className="section-heading" style={{ fontSize: 18 }}>
              Catálogo sin señal
            </h2>
          </div>
          <span className="pill-stone" style={{ marginTop: 0, fontSize: 12, padding: '3px 10px' }}>
            {formatSyncDateLabel(sync.lastSyncDateKey, sync.lastSyncTime)}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="offline-sync-row">
            <span style={{ color: 'var(--slate)' }}>Precios y EAN guardados</span>
            <strong className="mono">{sync.catalogCount.toLocaleString('es-AR')} productos</strong>
          </div>

          {!standalone && (
            <div className="cat-bar-item">
              <div className="offline-sync-row">
                <span style={{ color: 'var(--slate)' }}>Fotos 160×160</span>
                <span className="mono" style={{ fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {imgSync.cached.toLocaleString('es-AR')} / {imgSync.total.toLocaleString('es-AR')} ({imgPct}%)
                </span>
              </div>
              <div
                className="cat-bar-track"
                role="progressbar"
                aria-valuenow={imgPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progreso de descarga de fotos sin conexión"
              >
                <div className="offline-sync-fill" style={{ width: `${imgPct}%` }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--slate)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>~{estMbCached} MB de ~{estMbTotal} MB</span>
                <span>Solo delta diario</span>
              </div>
            </div>
          )}

          <p style={{ margin: 0, fontSize: 13, color: 'var(--slate)' }}>{imgStatusNote}</p>

          {!standalone && (
            <button
              type="button"
              className="btn-secondary"
              style={{ marginTop: 2 }}
              disabled={isBusy || sync.mode === 'offline'}
              onClick={() => void onRefreshCatalog()}
            >
              {isBusy ? (
                <Loader2 size={17} className="spin" aria-hidden="true" />
              ) : (
                <RefreshCw size={17} aria-hidden="true" />
              )}
              <span>
                {refreshingCatalog
                  ? 'Actualizando precios...'
                  : imgSync.status === 'syncing'
                    ? 'Sincronizando fotos nuevas...'
                    : 'Actualizar catálogo ahora'}
              </span>
            </button>
          )}
        </div>
      </section>

      <section className="card" aria-label="Privacidad y avisos">
        <h2 className="section-heading" style={{ fontSize: 18, marginBottom: 6 }}>
          Privacidad y avisos
        </h2>

        <SwitchControl
          title="Descuentos según tus compras"
          description="Usamos tu historial solo para mostrarte ofertas que te sirvan. Podés pausarlo cuando quieras."
          checked={preferences.personalizedDeals}
          onChange={(checked) =>
            onChangePreferences({ ...preferences, personalizedDeals: checked })
          }
          footer={
            <button type="button" className="link-underline" onClick={onOpenPrivacy}>
              Tus derechos (Ley 25.326)
            </button>
          }
        />

        <SwitchControl
          title="Aviso al llegar a una sucursal"
          description="Usamos tu ubicación solo para detectar cuál es tu sucursal."
          checked={preferences.branchArrivalAlert}
          onChange={handleToggleArrival}
          footer={
            sync.gpsState === 'denied' ? (
              <div className="amber-banner" style={{ marginTop: 10 }}>
                <AlertTriangle
                  size={17}
                  style={{ flexShrink: 0, marginTop: 1 }}
                  aria-hidden="true"
                />
                <span>
                  El navegador bloqueó el acceso a ubicación. Podés elegir tu sucursal manualmente
                  desde Inicio.
                </span>
              </div>
            ) : null
          }
        />
      </section>

      <button type="button" className="stone-callout" onClick={onOpenOffersForYou}>
        <span>Tenés {habitualProducts.length} cupones para usar hoy en esta sucursal</span>
        <ChevronRight size={20} color="#5C5E66" aria-hidden="true" />
      </button>
    </main>
  );
}
