import { BarcodeDetector } from 'barcode-detector/ponyfill';
import { prepareZXingModule } from 'barcode-detector/ponyfill';
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
  private hasFiredReady = false;

  constructor(options: ScannerOptions, callbacks: ScannerCallbacks) {
    this.options = options;
    this.callbacks = callbacks;
  }

  /** Start scanning from the specified video element. */
  async start(videoElement: HTMLVideoElement): Promise<void> {
    if (this.isRunning) {
      return;
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
        formats: detectorFormats,
      });

      this.rafId = requestAnimationFrame(() => this.scanLoop());
    } catch (err) {
      this.isRunning = false;
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Stop scanning and release resources. */
  stop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.videoElement = null;
    this.detector = null;
    this.hasFiredReady = false;
  }

  private scanLoop(): void {
    if (!this.isRunning || !this.videoElement || !this.detector) {
      return;
    }

    this.detector
      .detect(this.videoElement)
      .then((detected) => {
        if (!this.isRunning) return;

        if (detected.length > 0) {
          if (!this.hasFiredReady) {
            this.hasFiredReady = true;
            this.callbacks.onReady?.();
          }

          const barcodes: RawBarcode[] = detected.map((d) => ({
            text: d.rawValue,
            format: this.mapFormatFromDetector(d.format),
            boundingBox: d.boundingBox,
            cornerPoints: d.cornerPoints,
          }));

          this.callbacks.onDetect(barcodes);
        }

        if (this.isRunning) {
          this.rafId = requestAnimationFrame(() => this.scanLoop());
        }
      })
      .catch((err) => {
        if (!this.isRunning) return;
        this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        if (this.isRunning) {
          this.rafId = requestAnimationFrame(() => this.scanLoop());
        }
      });
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
