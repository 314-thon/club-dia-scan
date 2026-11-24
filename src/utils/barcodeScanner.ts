import { isStandaloneHtml } from './runtime';

export type RetailBarcodeFormat = 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e';

const RETAIL_FORMATS: RetailBarcodeFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

export interface DetectedBarcodeItem {
  rawValue: string;
  format: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface GenericBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<DetectedBarcodeItem[]>;
}

interface NativeBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): GenericBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

export interface ScannerEngineHandle {
  engine: 'native' | 'zxing-wasm';
  detectFrame: (
    video: HTMLVideoElement,
    workCanvas: HTMLCanvasElement,
    widePass: boolean
  ) => Promise<DetectedBarcodeItem | null>;
}

export interface CameraStreamHandle {
  stream: MediaStream;
  track: MediaStreamTrack;
  resolution: string;
  focusMode: string;
  supportsTorch: boolean;
  zoomRange: { min: number; max: number } | null;
}

let zxingPrepared = false;

async function tryCreateNativeDetector(): Promise<GenericBarcodeDetector | null> {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
    return null;
  }
  try {
    const Ctor = (window as unknown as { BarcodeDetector: NativeBarcodeDetectorConstructor })
      .BarcodeDetector;
    if (typeof Ctor.getSupportedFormats === 'function') {
      const supported = await Ctor.getSupportedFormats();
      if (!supported.includes('ean_13')) {
        return null;
      }
      const allowed = RETAIL_FORMATS.filter((f) => supported.includes(f));
      return new Ctor({ formats: allowed });
    }
    return new Ctor({ formats: RETAIL_FORMATS });
  } catch {
    return null;
  }
}

async function createZxingWasmDetector(): Promise<GenericBarcodeDetector> {
  const { BarcodeDetector: PonyfillDetector, prepareZXingModule } = await import(
    'barcode-detector/ponyfill'
  );

  if (!zxingPrepared) {
    zxingPrepared = true;
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => {
          if (path.endsWith('.wasm')) {
            return isStandaloneHtml() ? prefix + path : '/zxing_reader.wasm';
          }
          return prefix + path;
        },
      },
    });
  }

  return new PonyfillDetector({
    formats: RETAIL_FORMATS,
  }) as unknown as GenericBarcodeDetector;
}

function pickBestCenteredBarcode(
  barcodes: DetectedBarcodeItem[],
  frameWidth: number,
  frameHeight: number
): DetectedBarcodeItem | null {
  const valid = barcodes.filter((b) => Boolean(b.rawValue && b.rawValue.trim()));
  if (valid.length === 0) return null;
  if (valid.length === 1 || frameWidth <= 0 || frameHeight <= 0) return valid[0];

  const cx = frameWidth / 2;
  const cy = frameHeight / 2;

  let best = valid[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const item of valid) {
    const box = item.boundingBox;
    if (!box) continue;
    const bx = box.x + box.width / 2;
    const by = box.y + box.height / 2;
    const dist = Math.hypot(bx - cx, by - cy);
    if (dist < bestScore) {
      bestScore = dist;
      best = item;
    }
  }

  return best;
}

/**
 * Recorta el centro del video en píxeles reales de cámara manteniendo proporción exacta 1:1
 * (sin distorsionar por object-fit:cover ni reducir a 300px como hacía html5-qrcode).
 */
function drawNativeResolutionCrop(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  widePass: boolean
): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 64 || vh < 64) return false;

  const cropFracW = widePass ? 0.94 : 0.82;
  const cropFracH = widePass ? 0.84 : 0.56;

  const sx = Math.round(((1 - cropFracW) / 2) * vw);
  const sy = Math.round(((1 - cropFracH) / 2) * vh);
  const sw = Math.max(64, vw - sx * 2);
  const sh = Math.max(64, vh - sy * 2);

  // Tope alto (1280px) conservando proporción exacta para mantener nitidez en barras finas EAN-13
  const maxDim = 1280;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const dw = Math.max(64, Math.round(sw * scale));
  const dh = Math.max(64, Math.round(sh * scale));

  if (canvas.width !== dw) canvas.width = dw;
  if (canvas.height !== dh) canvas.height = dh;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
  return true;
}

export async function createRetailScannerEngine(): Promise<ScannerEngineHandle> {
  const nativeDetector = await tryCreateNativeDetector();
  if (nativeDetector) {
    return {
      engine: 'native',
      detectFrame: async (video) => {
        if (video.videoWidth < 64 || video.videoHeight < 64) return null;
        const list = await nativeDetector.detect(video);
        return pickBestCenteredBarcode(list, video.videoWidth, video.videoHeight);
      },
    };
  }

  const wasmDetector = await createZxingWasmDetector();
  return {
    engine: 'zxing-wasm',
    detectFrame: async (video, workCanvas, widePass) => {
      if (!drawNativeResolutionCrop(video, workCanvas, widePass)) return null;
      const list = await wasmDetector.detect(workCanvas);
      return pickBestCenteredBarcode(list, workCanvas.width, workCanvas.height);
    },
  };
}

export async function openRearCameraStream(): Promise<CameraStreamHandle> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('CAMERA_UNAVAILABLE');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (
      name === 'NotAllowedError' ||
      name === 'PermissionDeniedError' ||
      msg.includes('permission') ||
      msg.includes('denied') ||
      msg.includes('notallowed')
    ) {
      throw err;
    }
    // Fallback para cámaras web o dispositivos que rechazan ideal 1080p
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment' },
    });
  }

  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('NO_VIDEO_TRACK');
  }

  let supportsTorch = false;
  let zoomRange: { min: number; max: number } | null = null;
  let focusMode = 'default';

  try {
    const rawCaps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
    const advanced: Record<string, unknown>[] = [];

    if (Array.isArray(rawCaps.focusMode) && rawCaps.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
      focusMode = 'continuous';
    }
    if (Array.isArray(rawCaps.exposureMode) && rawCaps.exposureMode.includes('continuous')) {
      advanced.push({ exposureMode: 'continuous' });
    }
    if (advanced.length > 0 && track.applyConstraints) {
      await track.applyConstraints({
        advanced: advanced as unknown as MediaTrackConstraintSet[],
      });
    }

    if (rawCaps.torch === true) {
      supportsTorch = true;
    }

    const z = rawCaps.zoom as { min?: number; max?: number } | undefined;
    if (z && typeof z.max === 'number' && z.max >= 1.6) {
      const min = typeof z.min === 'number' ? z.min : 1;
      zoomRange = { min, max: Math.min(z.max, 4) };
    }
  } catch {
    // Algunos navegadores móviles no exponen getCapabilities o rechazan advanced constraints
  }

  const settings = track.getSettings?.() ?? {};
  const resolution =
    settings.width && settings.height ? `${settings.width}×${settings.height}` : 'auto';
  const actualFocus = (settings as Record<string, unknown>).focusMode;
  if (typeof actualFocus === 'string') {
    focusMode = actualFocus;
  }

  return {
    stream,
    track,
    resolution,
    focusMode,
    supportsTorch,
    zoomRange,
  };
}

export async function applyTrackTorch(track: MediaStreamTrack, enabled: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({
      advanced: [{ torch: enabled } as unknown as MediaTrackConstraintSet],
    });
    return true;
  } catch {
    return false;
  }
}

export async function applyTrackZoom(track: MediaStreamTrack, zoomFactor: number): Promise<boolean> {
  try {
    await track.applyConstraints({
      advanced: [{ zoom: zoomFactor } as unknown as MediaTrackConstraintSet],
    });
    return true;
  } catch {
    return false;
  }
}
