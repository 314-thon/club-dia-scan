import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronRight,
  Flashlight,
  Keyboard,
  ListChecks,
  Loader2,
  PackageX,
  RotateCcw,
  Scale,
  Search,
  WifiOff,
  X,
  ZoomIn,
} from 'lucide-react';
import { Branch, Product, ScanIssue, SyncStatus, VisitItem } from '../types/models';
import {
  applyTrackTorch,
  applyTrackZoom,
  CameraStreamHandle,
  createRetailScannerEngine,
  openRearCameraStream,
  ScannerEngineHandle,
} from '../utils/barcodeScanner';
import { formatARS } from '../utils/format';
import { parseScannedGtin } from '../utils/gtin';
import { resolveAssetUrl } from '../utils/runtime';

interface ScannerScreenProps {
  branch: Branch;
  sync: SyncStatus;
  visitItems: VisitItem[];
  scanIssue: ScanIssue | null;
  lookingUpEan: boolean;
  activeLookupCode: string | null;
  onBack: () => void;
  onOpenBranches: () => void;
  onOpenManualEan: (initialCode?: string) => void;
  onSearchByName: () => void;
  onOpenVisitList: () => void;
  onRemoveVisitItem: (ean: string) => void;
  onSelectProduct: (product: Product) => void;
  onDetectedCode: (code: string, formatHint?: string) => Promise<void>;
  onClearScanIssue: () => void;
}

interface DebugTelemetry {
  engine: string;
  resolution: string;
  focusMode: string;
  lastRaw: string;
  lastFormat: string;
  lastChecksum: string;
  fpsTick: number;
}

function isInitialDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

export function ScannerScreen({
  branch,
  sync,
  visitItems,
  scanIssue,
  lookingUpEan,
  activeLookupCode,
  onBack,
  onOpenBranches,
  onOpenManualEan,
  onSearchByName,
  onOpenVisitList,
  onRemoveVisitItem,
  onSelectProduct,
  onDetectedCode,
  onClearScanIssue,
}: ScannerScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamHandleRef = useRef<CameraStreamHandle | null>(null);
  const engineRef = useRef<ScannerEngineHandle | null>(null);
  const startSessionRef = useRef(0);
  const mountedRef = useRef(true);
  const onDetectedCodeRef = useRef(onDetectedCode);
  const pausedByStateRef = useRef(false);

  const pendingConfirmRef = useRef<{ canonical: string; at: number }>({ canonical: '', at: 0 });
  const lastAcceptedRef = useRef<{ canonical: string; at: number }>({ canonical: '', at: 0 });

  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'denied' | 'unavailable'>(
    'starting'
  );
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [zoomActive, setZoomActive] = useState(false);
  const [detectedCodeBanner, setDetectedCodeBanner] = useState<string | null>(null);
  const [showSlowFocusTip, setShowSlowFocusTip] = useState(false);
  const [debugMode, setDebugMode] = useState<boolean>(isInitialDebugEnabled);
  const debugTapRef = useRef<{ count: number; lastAt: number }>({ count: 0, lastAt: 0 });
  const [debugInfo, setDebugInfo] = useState<DebugTelemetry>({
    engine: 'iniciando...',
    resolution: '-',
    focusMode: '-',
    lastRaw: '-',
    lastFormat: '-',
    lastChecksum: '-',
    fpsTick: 0,
  });

  useEffect(() => {
    onDetectedCodeRef.current = onDetectedCode;
  }, [onDetectedCode]);

  useEffect(() => {
    pausedByStateRef.current = lookingUpEan || Boolean(scanIssue);
    if (!lookingUpEan && !scanIssue) {
      setDetectedCodeBanner(null);
    }
  }, [lookingUpEan, scanIssue]);

  // Vibración doble cuando aparece un error de escaneo
  useEffect(() => {
    if (scanIssue) {
      setShowSlowFocusTip(false);
      try {
        navigator.vibrate?.([60, 50, 95]);
      } catch {
        // ignore
      }
    }
  }, [scanIssue]);

  // Sugerencia no bloqueante si pasan ~6.5 s con cámara activa sin lograr decodificar
  useEffect(() => {
    if (cameraState !== 'active' || lookingUpEan || scanIssue || detectedCodeBanner) {
      setShowSlowFocusTip(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowSlowFocusTip(true);
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [cameraState, detectedCodeBanner, lookingUpEan, scanIssue]);

  const stopCamera = useCallback(() => {
    startSessionRef.current += 1;
    const handle = streamHandleRef.current;
    streamHandleRef.current = null;
    if (handle) {
      handle.stream.getTracks().forEach((t) => t.stop());
    }
    const videoEl = videoRef.current;
    if (videoEl) {
      videoEl.srcObject = null;
    }
    setTorchOn(false);
    setZoomActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    const session = ++startSessionRef.current;
    setCameraState('starting');
    setShowSlowFocusTip(false);
    setTorchOn(false);
    setZoomActive(false);

    const prev = streamHandleRef.current;
    streamHandleRef.current = null;
    if (prev) {
      prev.stream.getTracks().forEach((t) => t.stop());
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('unavailable');
      return;
    }

    try {
      const [camHandle, engineHandle] = await Promise.all([
        openRearCameraStream(),
        engineRef.current ? Promise.resolve(engineRef.current) : createRetailScannerEngine(),
      ]);

      if (!mountedRef.current || session !== startSessionRef.current) {
        camHandle.stream.getTracks().forEach((t) => t.stop());
        return;
      }

      engineRef.current = engineHandle;
      streamHandleRef.current = camHandle;
      setSupportsTorch(camHandle.supportsTorch);
      setZoomRange(camHandle.zoomRange);

      const videoEl = videoRef.current;
      if (!videoEl) {
        camHandle.stream.getTracks().forEach((t) => t.stop());
        return;
      }

      videoEl.srcObject = camHandle.stream;
      await videoEl.play();

      if (!mountedRef.current || session !== startSessionRef.current) {
        camHandle.stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const actualRes =
        videoEl.videoWidth && videoEl.videoHeight
          ? `${videoEl.videoWidth}×${videoEl.videoHeight}`
          : camHandle.resolution;

      setDebugInfo((prevInfo) => ({
        ...prevInfo,
        engine: engineHandle.engine,
        resolution: actualRes,
        focusMode: camHandle.focusMode,
      }));
      setCameraState('active');
    } catch (err) {
      if (!mountedRef.current || session !== startSessionRef.current) return;
      const name = err instanceof DOMException ? err.name : '';
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (
        name === 'NotAllowedError' ||
        name === 'PermissionDeniedError' ||
        msg.includes('permission') ||
        msg.includes('denied') ||
        msg.includes('notallowed')
      ) {
        setCameraState('denied');
      } else {
        setCameraState('unavailable');
      }
    }
  }, []);

  // Ciclo de vida + recuperación automática al volver de segundo plano / desbloqueo
  useEffect(() => {
    mountedRef.current = true;
    void startCamera();

    const onVisibility = () => {
      if (!mountedRef.current) return;
      if (document.hidden) {
        stopCamera();
      } else {
        void startCamera();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // Loop de decodificación no solapado (~11 fps), pausado automáticamente durante lookup o alerta
  useEffect(() => {
    if (cameraState !== 'active') return;

    let cancelled = false;
    let timerId: number | null = null;
    let tickCount = 0;

    if (!workCanvasRef.current) {
      workCanvasRef.current = document.createElement('canvas');
    }

    const runTick = async () => {
      if (cancelled) return;

      const engine = engineRef.current;
      const video = videoRef.current;
      const canvas = workCanvasRef.current;

      if (
        engine &&
        video &&
        canvas &&
        !pausedByStateRef.current &&
        !document.hidden &&
        video.readyState >= 2
      ) {
        tickCount += 1;
        const widePass = tickCount % 3 === 0;

        try {
          const hit = await engine.detectFrame(video, canvas, widePass);
          if (!cancelled && hit && !pausedByStateRef.current) {
            const parsed = parseScannedGtin(hit.rawValue, hit.format);

            if (debugMode) {
              setDebugInfo((prev) => ({
                ...prev,
                resolution:
                  video.videoWidth && video.videoHeight
                    ? `${video.videoWidth}×${video.videoHeight}`
                    : prev.resolution,
                lastRaw: hit.rawValue,
                lastFormat: hit.format,
                lastChecksum: parsed.status,
                fpsTick: tickCount,
              }));
            }

            if (parsed.status === 'valid' || parsed.status === 'weighable') {
              const now = Date.now();
              const canonical = parsed.canonicalEan;

              // Con ZXing-WASM requerimos 2 lecturas idénticas seguidas (< 1,2 s) para cero falsos positivos;
              // con BarcodeDetector nativo del sistema basta 1 lectura con checksum GS1 válido.
              let confirmed = engine.engine === 'native';
              if (!confirmed) {
                if (
                  pendingConfirmRef.current.canonical === canonical &&
                  now - pendingConfirmRef.current.at < 1200
                ) {
                  confirmed = true;
                } else {
                  pendingConfirmRef.current = { canonical, at: now };
                }
              }

              if (confirmed) {
                const isDuplicateCooldown =
                  lastAcceptedRef.current.canonical === canonical &&
                  now - lastAcceptedRef.current.at < 2600;

                if (!isDuplicateCooldown) {
                  lastAcceptedRef.current = { canonical, at: now };
                  pendingConfirmRef.current = { canonical: '', at: 0 };
                  pausedByStateRef.current = true;
                  setDetectedCodeBanner(canonical);
                  setShowSlowFocusTip(false);
                  try {
                    navigator.vibrate?.(45);
                  } catch {
                    // ignore
                  }
                  void onDetectedCodeRef.current(parsed.rawDigits, hit.format);
                }
              }
            }
          }
        } catch {
          // Ignorar errores transitorios de frame individual
        }
      }

      if (!cancelled) {
        timerId = window.setTimeout(() => {
          void runTick();
        }, 90);
      }
    };

    void runTick();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [cameraState, debugMode]);

  const handleToggleTorch = async () => {
    const track = streamHandleRef.current?.track;
    if (!track || !supportsTorch) return;
    const next = !torchOn;
    const ok = await applyTrackTorch(track, next);
    if (ok) {
      setTorchOn(next);
    } else if (!next) {
      void startCamera();
    }
  };

  const handleToggleZoom = async () => {
    const track = streamHandleRef.current?.track;
    if (!track || !zoomRange) return;
    const nextActive = !zoomActive;
    const targetZoom = nextActive ? Math.min(2, zoomRange.max) : zoomRange.min;
    const ok = await applyTrackZoom(track, targetZoom);
    if (ok) {
      setZoomActive(nextActive);
    }
  };

  const handleStatusPillTap = () => {
    const now = Date.now();
    if (now - debugTapRef.current.lastAt < 650) {
      debugTapRef.current.count += 1;
    } else {
      debugTapRef.current.count = 1;
    }
    debugTapRef.current.lastAt = now;
    if (debugTapRef.current.count >= 4) {
      debugTapRef.current.count = 0;
      setDebugMode((prev) => !prev);
    }
  };

  const handleResumeScan = () => {
    lastAcceptedRef.current = { canonical: '', at: 0 };
    pendingConfirmRef.current = { canonical: '', at: 0 };
    setDetectedCodeBanner(null);
    onClearScanIssue();
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
  const visibleReadCode = activeLookupCode || detectedCodeBanner;
  const isDetectedState = Boolean(lookingUpEan || visibleReadCode) && !scanIssue;

  const extraControlCount = (supportsTorch ? 1 : 0) + (zoomRange ? 1 : 0);

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
          <video ref={videoRef} className="scanner-native-video" playsInline muted autoPlay />
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

          <button
            type="button"
            className="scanner-glass-pill"
            onClick={handleStatusPillTap}
            aria-label={
              isOffline
                ? `Sin señal, usando precios de hoy ${sync.lastSyncTime}`
                : 'Precios de hoy guardados'
            }
          >
            <span className={`status-dot ${isOffline ? 'offline' : 'lock'}`} aria-hidden="true" />
            <span>
              {isOffline
                ? `Sin señal · usando precios de hoy, ${sync.lastSyncTime}`
                : 'Precios de hoy guardados'}
            </span>
          </button>

          {debugMode && (
            <div className="scanner-debug-box mono" role="status">
              <div>
                motor: <strong>{debugInfo.engine}</strong> · res: {debugInfo.resolution} · foco:{' '}
                {debugInfo.focusMode}
              </div>
              <div>
                último: <strong>{debugInfo.lastRaw}</strong> ({debugInfo.lastFormat}) · gtin:{' '}
                {debugInfo.lastChecksum}
              </div>
            </div>
          )}
        </div>

        <div className="scanner-reticle-zone">
          {scanIssue ? (
            <div className="scanner-issue-card" role="alert" aria-live="assertive">
              <div className="scanner-issue-top">
                <div
                  className={`scanner-issue-icon${
                    scanIssue.kind === 'weighable' ? ' is-amber' : ''
                  }`}
                  aria-hidden="true"
                >
                  {scanIssue.kind === 'network' ? (
                    <WifiOff size={24} strokeWidth={2.2} />
                  ) : scanIssue.kind === 'weighable' ? (
                    <Scale size={24} strokeWidth={2.2} />
                  ) : scanIssue.kind === 'invalid-code' ? (
                    <AlertCircle size={24} strokeWidth={2.2} />
                  ) : (
                    <PackageX size={24} strokeWidth={2.2} />
                  )}
                </div>
                <div style={{ flex: 1, minInlineSize: 0 }}>
                  <div className="scanner-issue-title">{scanIssue.title}</div>
                  {scanIssue.code && (
                    <div className="scanner-issue-code mono">Código {scanIssue.code}</div>
                  )}
                </div>
              </div>

              <p className="scanner-issue-desc">{scanIssue.description}</p>

              <div className="scanner-issue-actions">
                {scanIssue.kind === 'network' && scanIssue.code ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      const retryCode = scanIssue.code;
                      onClearScanIssue();
                      void onDetectedCode(retryCode);
                    }}
                  >
                    <RotateCcw size={18} aria-hidden="true" />
                    <span>Reintentar consulta</span>
                  </button>
                ) : (
                  <button type="button" className="btn-primary" onClick={handleResumeScan}>
                    <Camera size={18} aria-hidden="true" />
                    <span>Escanear de nuevo</span>
                  </button>
                )}

                <div className="scanner-issue-secondary-row">
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ minBlockSize: 42, fontSize: 13.5, paddingInline: 10 }}
                    onClick={() => {
                      onClearScanIssue();
                      onSearchByName();
                    }}
                  >
                    <Search size={16} aria-hidden="true" />
                    <span>Buscar nombre</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ minBlockSize: 42, fontSize: 13.5, paddingInline: 10 }}
                    onClick={() => {
                      const code = scanIssue.code;
                      onClearScanIssue();
                      onOpenManualEan(code);
                    }}
                  >
                    <Keyboard size={16} aria-hidden="true" />
                    <span>Corregir código</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div
                className={`scanner-frame${isDetectedState ? ' is-detected' : ''}`}
                aria-hidden="true"
              >
                <span className="corner tl" />
                <span className="corner tr" />
                <span className="corner bl" />
                <span className="corner br" />
                <div className="scan-laser" />
              </div>

              <div
                className={`scanner-glass-pill${isDetectedState ? ' is-detected-pill' : ''}`}
                style={{ textAlign: 'center' }}
              >
                {isDetectedState ? (
                  <>
                    {lookingUpEan ? (
                      <Loader2 size={16} className="spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 size={16} aria-hidden="true" />
                    )}
                    <span>
                      Leído <strong className="mono">{visibleReadCode}</strong> · Buscando precio...
                    </span>
                  </>
                ) : cameraState === 'denied' ? (
                  <span>Sin permiso de cámara · Usá “Escribir código”</span>
                ) : cameraState === 'unavailable' ? (
                  <span>Cámara no disponible · Probá “Escribir código”</span>
                ) : cameraState === 'starting' ? (
                  <>
                    <Loader2 size={15} className="spin" aria-hidden="true" />
                    <span>Activando cámara trasera...</span>
                  </>
                ) : (
                  <span>Centrá el código de barras del producto en el recuadro</span>
                )}
              </div>

              {showSlowFocusTip && !isDetectedState && cameraState === 'active' && (
                <div className="scanner-focus-tip" role="status">
                  ¿Cuesta enfocar? Alejá el envase unos 15 cm
                  {zoomRange ? ' o activá 2×' : ' o usá “Escribir código”'}.
                </div>
              )}

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
            </>
          )}
        </div>

        <div
          className="scanner-actions-row"
          style={{
            gridTemplateColumns:
              extraControlCount === 2
                ? 'auto auto 1fr'
                : extraControlCount === 1
                  ? 'auto 1fr'
                  : '1fr',
          }}
        >
          {zoomRange && (
            <button
              type="button"
              className={`scanner-glass-btn${zoomActive ? ' is-toggled' : ''}`}
              onClick={() => void handleToggleZoom()}
              aria-pressed={zoomActive}
              aria-label={zoomActive ? 'Volver a zoom 1x' : 'Acercar cámara 2x'}
            >
              <ZoomIn size={18} aria-hidden="true" />
              <span className="mono">{zoomActive ? '2×' : '1×'}</span>
            </button>
          )}

          {supportsTorch && (
            <button
              type="button"
              className={`scanner-glass-btn${torchOn ? ' is-toggled' : ''}`}
              onClick={() => void handleToggleTorch()}
              aria-pressed={torchOn}
              aria-label={torchOn ? 'Apagar linterna' : 'Encender linterna'}
            >
              <Flashlight size={18} aria-hidden="true" />
              <span>Luz</span>
            </button>
          )}

          <button type="button" className="scanner-glass-btn" onClick={() => onOpenManualEan()}>
            <Keyboard size={18} aria-hidden="true" />
            <span>Escribir código</span>
          </button>
        </div>
      </div>

      <section className="scanner-sheet" aria-label="Productos escaneados en esta visita">
        <div className="sheet-handle" aria-hidden="true" />

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
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 6,
                      flexWrap: 'wrap',
                    }}
                  >
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
