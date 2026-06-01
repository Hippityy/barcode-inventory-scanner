import { BarcodeDetector, prepareZXingModule, type BarcodeDetectorOptions } from 'barcode-detector/ponyfill';
import type { RawBarcode } from '@/types/index';

/** Options for the barcode scanner */
export interface ScannerOptions {
  /** Preferred camera device ID, or undefined for default */
  readonly deviceId?: string;
  /** Limit detection to specific formats (all by default) */
  readonly formats?: readonly RawBarcode['format'][];
}

/** Callbacks for scanner events */
export interface ScannerCallbacks {
  onDetect: (barcodes: RawBarcode[]) => void;
  onError: (error: Error) => void;
  onReady?: () => void;
  /** Fired every frame with all barcodes found (or empty array).
   *  Used to draw bounding-box overlays on the video preview. */
  onFrame?: (barcodes: RawBarcode[]) => void;
}

/** Wrapper around the Barcode Detection API (via barcode-detector ponyfill).
 *
 * Continuously scans the video stream and emits detected barcodes.
 * Uses ZXing-C++ WebAssembly under the hood for cross-browser consistency.
 */
export class BarcodeScannerEngine {
  private readonly options: ScannerOptions;
  private readonly callbacks: ScannerCallbacks;
  private detector: BarcodeDetector | null = null;
  private isRunning = false;
  private rafId: number | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;

  constructor(options: ScannerOptions, callbacks: ScannerCallbacks) {
    this.options = options;
    this.callbacks = callbacks;
  }

  /** Start scanning from the specified video element.
   *  Returns `true` if scanning started successfully, `false` otherwise. */
  async start(videoElement: HTMLVideoElement): Promise<boolean> {
    if (this.isRunning) {
      return true;
    }
    this.isRunning = true;
    this.videoElement = videoElement;

    try {
      // Preload WASM so the first detect() is fast
      await prepareZXingModule();

      const detectorFormats = this.options.formats?.length
        ? this.options.formats.map((f) => this.mapFormatToDetector(f))
        : undefined;

      this.detector = new BarcodeDetector({
        formats: detectorFormats as unknown as BarcodeDetectorOptions['formats'],
      });

      // Acquire camera stream and attach it to the video element
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      this.videoElement.srcObject = this.stream;

      // Explicitly play() — `autoplay` alone may not trigger when
      // srcObject is set programmatically. The scanLoop already
      // guards against unready frames (readyState < 2 check), so
      // we don't block on loadeddata here.
      await this.videoElement.play();

      this.rafId = requestAnimationFrame(() => this.scanLoop());
      this.callbacks.onReady?.();
      return true;
    } catch (err) {
      this.isRunning = false;
      this.releaseStream();
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /** Stop scanning and release resources. */
  stop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.releaseStream();
    this.videoElement = null;
    this.detector = null;
  }

  private releaseStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }

  private scanLoop(): void {
    if (!this.isRunning || !this.videoElement || !this.detector) {
      return;
    }

    // Wait for the video element to have actual frame data before asking
    // the detector to process it.  readyState >= 2 means HAVE_CURRENT_DATA.
    if (
      this.videoElement.readyState < 2 ||
      this.videoElement.videoWidth === 0 ||
      this.videoElement.videoHeight === 0
    ) {
      this.rafId = requestAnimationFrame(() => this.scanLoop());
      return;
    }

    this.detector
      .detect(this.videoElement)
      .then((detected) => {
        if (!this.isRunning) return;

        const barcodes: RawBarcode[] = detected.map((d) => ({
          text: d.rawValue,
          format: this.mapFormatFromDetector(d.format),
          boundingBox: d.boundingBox,
          cornerPoints: d.cornerPoints,
        }));

        // Fire frame callback even when empty — so the overlay can clear
        this.callbacks.onFrame?.(barcodes);

        if (barcodes.length > 0) {
          this.callbacks.onDetect(barcodes);
        }

        if (this.isRunning) {
          this.rafId = requestAnimationFrame(() => this.scanLoop());
        }
      })
      .catch((err) => {
        if (!this.isRunning) return;

        // ZXing throws when no barcode is found in a frame — ignore it
        // and keep scanning.  The ponyfill may wrap it in a DOMException.
        if (this.isNotFoundError(err)) {
          // Clear the overlay — no barcodes in this frame
          this.callbacks.onFrame?.([]);
          this.rafId = requestAnimationFrame(() => this.scanLoop());
          return;
        }

        this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        if (this.isRunning) {
          this.rafId = requestAnimationFrame(() => this.scanLoop());
        }
      });
  }

  /** Determine whether an error from detect() simply means "nothing found"
   *  rather than a real failure. */
  private isNotFoundError(err: unknown): boolean {
    if (err === null || typeof err !== 'object') return false;
    const msg = 'message' in err ? String((err as Error).message).toLowerCase() : '';
    return (
      msg.includes('not found') ||
      msg.includes('no multiformat readers') ||
      msg.includes('barcode detection service unavailable') ||
      msg.includes('invalid element or state')
    );
  }

  private mapFormatToDetector(format: RawBarcode['format']): string {
    switch (format) {
      case 'CODE_128':
        return 'code_128';
      case 'CODE_39':
        return 'code_39';
      case 'QR_CODE':
        return 'qr_code';
      case 'DATA_MATRIX':
        return 'data_matrix';
      case 'EAN_13':
        return 'ean_13';
      case 'UPC_A':
        return 'upc_a';
      default:
        return 'unknown';
    }
  }

  private mapFormatFromDetector(format: string): RawBarcode['format'] {
    switch (format) {
      case 'code_128':
        return 'CODE_128';
      case 'code_39':
        return 'CODE_39';
      case 'qr_code':
        return 'QR_CODE';
      case 'data_matrix':
        return 'DATA_MATRIX';
      case 'ean_13':
        return 'EAN_13';
      case 'upc_a':
        return 'UPC_A';
      default:
        return 'UNKNOWN';
    }
  }
}
