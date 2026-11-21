import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  ChevronRight,
  Keyboard,
  ListChecks,
  Loader2,
  X,
  Zap,
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Branch, Product, SyncStatus, VisitItem } from '../types/models';
import { formatARS } from '../utils/format';
import { resolveAssetUrl } from '../utils/runtime';

interface ScannerScreenProps {
  branch: Branch;
  sync: SyncStatus;
  visitItems: VisitItem[];
  lastNotFoundEan: string | null;
  lookingUpEan: boolean;
  onBack: () => void;
  onOpenBranches: () => void;
  onOpenManualEan: () => void;
  onOpenVisitList: () => void;
  onRemoveVisitItem: (ean: string) => void;
  onSelectProduct: (product: Product) => void;
  onDetectedCode: (code: string) => Promise<void>;
  onClearNotFound: () => void;
}

export function ScannerScreen({
  branch,
  sync,
  visitItems,
  lastNotFoundEan,
  lookingUpEan,
  onBack,
  onOpenBranches,
  onOpenManualEan,
  onOpenVisitList,
  onRemoveVisitItem,
  onSelectProduct,
  onDetectedCode,
  onClearNotFound,
}: ScannerScreenProps) {
  const rawId = useId();
  const readerDomId = `club-dia-reader-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startSessionRef = useRef(0);
  const onDetectedCodeRef = useRef(onDetectedCode);
  const lastScannedRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const mountedRef = useRef(true);

  useEffect(() => {
    onDetectedCodeRef.current = onDetectedCode;
  }, [onDetectedCode]);

  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'denied' | 'unavailable'>(
    'starting'
  );
  const [torchOn, setTorchOn] = useState(false);
  const [torchNote, setTorchNote] = useState<string | null>(null);

  const stopInstance = useCallback(async (inst: Html5Qrcode | null) => {
    if (!inst) return;
    try {
      if (inst.isScanning) {
        await inst.stop();
      }
      inst.clear();
    } catch {
      // ignore cleanup errors
    }
  }, []);

  const stopCamera = useCallback(async () => {
    startSessionRef.current += 1;
    const inst = scannerRef.current;
    scannerRef.current = null;
    await stopInstance(inst);
  }, [stopInstance]);

  const startCamera = useCallback(async () => {
    const session = ++startSessionRef.current;
    setCameraState('starting');
    setTorchOn(false);
    setTorchNote(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('unavailable');
      return;
    }

    const prev = scannerRef.current;
    scannerRef.current = null;
    await stopInstance(prev);

    if (!mountedRef.current || session !== startSessionRef.current) {
      return;
    }

    let html5QrCode: Html5Qrcode | null = null;
    try {
      html5QrCode = new Html5Qrcode(readerDomId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
      });
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          disableFlip: false,
        },
        (decodedText) => {
          const now = Date.now();
          if (
            decodedText === lastScannedRef.current.code &&
            now - lastScannedRef.current.at < 3500
          ) {
            return;
          }
          lastScannedRef.current = { code: decodedText, at: now };
          void onDetectedCodeRef.current(decodedText);
        },
        () => {
          // frame without barcode — expected
        }
      );

      if (!mountedRef.current || session !== startSessionRef.current) {
        if (scannerRef.current === html5QrCode) {
          scannerRef.current = null;
        }
        await stopInstance(html5QrCode);
        return;
      }

      setCameraState('active');
    } catch (err) {
      if (scannerRef.current === html5QrCode) {
        scannerRef.current = null;
      }
      await stopInstance(html5QrCode);
      if (!mountedRef.current || session !== startSessionRef.current) return;
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed')) {
        setCameraState('denied');
      } else {
        setCameraState('unavailable');
      }
    }
  }, [readerDomId, stopInstance]);

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      void stopCamera();
    };
  }, [startCamera, stopCamera]);

  const handleToggleTorch = async () => {
    setTorchNote(null);
    const inst = scannerRef.current;
    if (!inst || cameraState !== 'active') {
      setTorchNote('La linterna requiere la cámara trasera activa.');
      return;
    }
    const next = !torchOn;
    try {
      const rawCaps = inst.getRunningTrackCapabilities() as Record<string, unknown>;
      const torch = inst.getRunningTrackCameraCapabilities().torchFeature();
      const supportsTorch = torch.isSupported() && rawCaps.torch !== false;
      if (!supportsTorch) {
        setTorchNote('Este navegador o cámara no permite activar el flash desde la web.');
        return;
      }
      try {
        await torch.apply(next);
      } catch {
        await inst.applyVideoConstraints({ torch: next } as MediaTrackConstraintSet);
      }
      setTorchOn(next);
    } catch {
      if (!next) {
        // Fallback for Android HALs where turning torch off via applyConstraints fails
        setTorchOn(false);
        void startCamera();
        return;
      }
      setTorchNote('Este navegador no permite activar el flash desde la web.');
    }
  };

  const totalCount = visitItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalEstimated = visitItems.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  const totalSavings = visitItems.reduce(
    (sum, item) => sum + item.product.savings * item.quantity,
    0
  );

  const isOffline = sync.mode === 'offline';

  return (
    <div className="scanner-screen">
      <div className="scanner-viewport">
        <img
          src={resolveAssetUrl('/assets/gondola.jpg')}
          alt=""
          aria-hidden="true"
          className="scanner-bg-fallback"
        />

        <div
          className={`scanner-video-host${cameraState === 'active' ? ' is-active' : ''}`}
          aria-hidden="true"
        >
          <div id={readerDomId} className="scanner-video-mount" />
        </div>

        <div className="scanner-top-overlay">
          <div className="scanner-header-row">
            <button
              type="button"
              className="scanner-back-btn"
              aria-label="Volver"
              onClick={onBack}
            >
              <ArrowLeft size={21} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="scanner-branch-pill"
              onClick={onOpenBranches}
              aria-label={`Cambiar sucursal: ${branch.name}`}
            >
              <span className="scanner-header-center">
                <span className="scanner-branch-name">{branch.name}</span>
                <span className="scanner-branch-addr">{branch.address}</span>
              </span>
              <ChevronRight size={20} style={{ flexShrink: 0, opacity: 0.85 }} aria-hidden="true" />
            </button>
          </div>

          <div className="scanner-glass-pill" role="status">
            <span
              className={`status-dot ${isOffline ? 'offline' : 'lock'}`}
              aria-hidden="true"
            />
            <span>
              {isOffline
                ? `Sin señal · usando precios de hoy, ${sync.lastSyncTime}`
                : 'Precios de hoy guardados'}
            </span>
          </div>
        </div>

        <div className="scanner-reticle-zone">
          <div className="scanner-frame" aria-hidden="true">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />
            <div className="scan-laser" />
          </div>

          <div className="scanner-glass-pill" style={{ textAlign: 'center' }}>
            {lookingUpEan ? (
              <>
                <Loader2 size={15} aria-hidden="true" />
                <span>Consultando precio en Dia...</span>
              </>
            ) : cameraState === 'denied' ? (
              <span>Sin permiso de cámara · Usá “Escribir código”</span>
            ) : cameraState === 'unavailable' ? (
              <span>Cámara no disponible · Probá “Escribir código”</span>
            ) : (
              <span>Apuntá al código de barras o QR del producto</span>
            )}
          </div>

          {(cameraState === 'denied' || cameraState === 'unavailable') && (
            <button
              type="button"
              className="scanner-glass-pill"
              onClick={() => void startCamera()}
              style={{ minBlockSize: 40 }}
            >
              <Camera size={15} aria-hidden="true" />
              <span>Reintentar cámara</span>
            </button>
          )}

          {torchNote && (
            <div className="scanner-glass-pill" role="status" style={{ fontSize: 12, textAlign: 'center' }}>
              {torchNote}
            </div>
          )}
        </div>

        <div className="scanner-actions-row">
          <button
            type="button"
            className={`scanner-glass-btn${torchOn ? ' active' : ''}`}
            onClick={() => void handleToggleTorch()}
            aria-pressed={torchOn}
          >
            <Zap size={18} aria-hidden="true" />
            <span>Linterna</span>
          </button>
          <button type="button" className="scanner-glass-btn" onClick={onOpenManualEan}>
            <Keyboard size={18} aria-hidden="true" />
            <span>Escribir código</span>
          </button>
        </div>
      </div>

      <section className="scanner-sheet" aria-label="Productos escaneados en esta visita">
        <div className="sheet-handle" aria-hidden="true" />

        {lastNotFoundEan ? (
          <div
            style={{
              background: 'var(--bg-canvas)',
              borderRadius: 16,
              padding: 14,
              marginBottom: 12,
              border: '1px solid var(--hairline)',
            }}
            role="alert"
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertCircle
                size={22}
                color="#C81E2B"
                style={{ flexShrink: 0, marginTop: 1 }}
                aria-hidden="true"
              />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {isOffline
                    ? 'No tenemos este producto en los precios guardados'
                    : 'No encontramos ese código en Dia'}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--slate)' }}>
                  Código <span className="mono">{lastNotFoundEan}</span>. Probá con más luz o
                  escribí otro código de barras EAN-13.
                </p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn-primary" onClick={onClearNotFound}>
                Reintentar
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  onClearNotFound();
                  onOpenManualEan();
                }}
              >
                Escribir código
              </button>
            </div>
          </div>
        ) : null}

        <div className="sheet-header">
          <h1 className="sheet-title">Escaneaste en esta visita</h1>
          <span className="pill-stone" style={{ marginTop: 0, fontSize: 13 }}>
            {totalCount} {totalCount === 1 ? 'producto' : 'productos'}
          </span>
        </div>

        {visitItems.length === 0 ? (
          <p style={{ margin: '8px 0 14px', fontSize: 13.5, color: 'var(--slate)' }}>
            Apuntá al código de barras de un producto o usá “Escribir código” para consultar su
            precio y descuento Club Dia.
          </p>
        ) : (
          <div>
            {visitItems.slice(0, 2).map((item) => (
              <div key={item.product.ean} className="visit-item-row">
                <button
                  type="button"
                  className="visit-item-btn"
                  onClick={() => onSelectProduct(item.product)}
                >
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
                    {item.product.name}
                    {item.quantity > 1 ? ` ×${item.quantity}` : ''}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--slate)', marginTop: 2 }}>
                    {item.product.subtitle}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
                      {formatARS(item.product.price * item.quantity)}
                    </span>
                    {item.product.discountPct > 0 ? (
                      <>
                        <span className="price-old">
                          {formatARS(item.product.listPrice * item.quantity)}
                        </span>
                        <span className="discount-badge">-{item.product.discountPct}%</span>
                        <span className="saving-inline">
                          Ahorrás {formatARS(item.product.savings * item.quantity)}
                        </span>
                      </>
                    ) : (
                      <span
                        className="pill-stone"
                        style={{ marginTop: 0, fontSize: 12, padding: '3px 9px' }}
                      >
                        Sin descuento hoy
                      </span>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 44, height: 44 }}
                  aria-label={`Quitar ${item.product.name} de esta visita`}
                  onClick={() => onRemoveVisitItem(item.product.ean)}
                >
                  <X size={19} color="#5C5E66" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="visit-footer">
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--slate)' }}>Total estimado</div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
              {formatARS(totalEstimated)}
            </div>
            {totalSavings > 0 && (
              <div className="saving-inline" style={{ fontSize: 12.5 }}>
                Ahorrás {formatARS(totalSavings)}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn-primary"
            style={{ width: 'auto', paddingInline: 18, flexShrink: 0 }}
            onClick={onOpenVisitList}
          >
            <ListChecks size={18} aria-hidden="true" />
            <span>Ver mi lista ({totalCount})</span>
          </button>
        </div>
      </section>
    </div>
  );
}
