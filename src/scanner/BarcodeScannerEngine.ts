import { BrowserMultiFormatReader } from '@zxing/browser';
import type { Result } from '@zxing/library';
import type { RawBarcode } from '@/types/index';

/** Options for the barcode scanner */
export interface ScannerOptions {
  /** Preferred camera device ID, or undefined for default */
  readonly deviceId?: string;
}

/** Callbacks for scanner events */
export interface ScannerCallbacks {
  onDetect: (barcodes: RawBarcode[]) => void;
  onError: (error: Error) => void;
  onReady?: () => void;
}

/** Wrapper around ZXing BrowserMultiFormatReader.
 *
 * Continuously scans the video stream and emits detected barcodes.
 */
export class BarcodeScannerEngine {
  private readonly reader: BrowserMultiFormatReader;
  private readonly options: ScannerOptions;
  private readonly callbacks: ScannerCallbacks;
  private controls: Awaited<ReturnType<BrowserMultiFormatReader['decodeFromVideoDevice']>> | null = null;
  private isRunning = false;

  constructor(options: ScannerOptions, callbacks: ScannerCallbacks) {
    this.reader = new BrowserMultiFormatReader();
    this.options = options;
    this.callbacks = callbacks;
  }

  /** Start scanning from the specified video element. */
  async start(videoElement: HTMLVideoElement): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    try {
      this.controls = await this.reader.decodeFromVideoDevice(
        this.options.deviceId ?? undefined,
        videoElement,
        (result: Result | undefined, error: Error | undefined) => {
          if (error) {
            // ZXing throws when no barcode found in a frame — ignore
            if (error.name === 'NotFoundException') {
              return;
            }
            this.callbacks.onError(error);
            return;
          }
          if (result) {
            this.handleResult(result);
          }
        }
      );

      this.callbacks.onReady?.();
    } catch (err) {
      this.isRunning = false;
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Stop scanning and release the camera. */
  stop(): void {
    this.isRunning = false;
    if (this.controls !== null) {
      this.controls.stop();
      this.controls = null;
    }
  }

  private handleResult(result: Result): void {
    const barcode: RawBarcode = {
      text: result.getText(),
      format: this.mapFormat(result.getBarcodeFormat().toString()),
    };
    this.callbacks.onDetect([barcode]);
  }

  private mapFormat(zxingFormat: string): RawBarcode['format'] {
    switch (zxingFormat) {
      case 'CODE_128':
        return 'CODE_128';
      case 'CODE_39':
        return 'CODE_39';
      case 'QR_CODE':
        return 'QR_CODE';
      case 'DATA_MATRIX':
        return 'DATA_MATRIX';
      case 'EAN_13':
        return 'EAN_13';
      case 'UPC_A':
        return 'UPC_A';
      default:
        return 'UNKNOWN';
    }
  }
}
