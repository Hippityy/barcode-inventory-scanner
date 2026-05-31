import { BarcodeScannerEngine } from '@/scanner/BarcodeScannerEngine';
import { DigiKeyParser } from '@/parsers/DigiKeyParser';
import { MouserParser } from '@/parsers/MouserParser';
import { Element14Parser } from '@/parsers/Element14Parser';
import { filterMultipleBarcodes } from '@/parsers/MultiBarcodeFilter';
import { UIManager } from '@/ui/UIManager';
import type { RawBarcode } from '@/types/index';

/** Main application controller.
 *
 * Wires the ZXing scanner, distributor parsers, multi-barcode filter,
 * and UI manager together into a cohesive mass-scanning workflow.
 */
export class InventoryScannerApp {
  private readonly ui: UIManager;
  private readonly parsers = [
    new DigiKeyParser(),
    new MouserParser(),
    new Element14Parser(),
  ];
  private scanner: BarcodeScannerEngine | null = null;
  private accumulated: RawBarcode[] = [];
  private accumulateTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly accumulateWindowMs = 400;

  constructor() {
    this.ui = new UIManager();
    this.ui.setStartHandler(() => this.start());
    this.ui.setStopHandler(() => this.stop());
  }

  async start(): Promise<void> {
    this.ui.setStatus('Starting camera…');

    this.scanner = new BarcodeScannerEngine(
      {},
      {
        onDetect: (barcodes) => this.onDetect(barcodes),
        onError: (err) => this.onError(err),
        onReady: () => this.ui.setStatus('Camera active — show barcode'),
      }
    );

    await this.scanner.start(this.ui.getVideoElement());
  }

  stop(): void {
    this.scanner?.stop();
    this.scanner = null;
    this.ui.setStatus('Camera stopped');
  }

  private onDetect(barcodes: RawBarcode[]): void {
    // Accumulate barcodes over a short window so if multiple codes
    // are visible in quick succession we can filter them together.
    for (const bc of barcodes) {
      this.accumulated.push(bc);
    }

    if (this.accumulateTimer !== null) {
      clearTimeout(this.accumulateTimer);
    }

    this.accumulateTimer = setTimeout(() => {
      this.processAccumulated();
    }, this.accumulateWindowMs);
  }

  private processAccumulated(): void {
    const batch = this.accumulated;
    this.accumulated = [];

    if (batch.length === 0) {
      return;
    }

    const best = filterMultipleBarcodes(batch, this.parsers);
    if (best === null) {
      return;
    }

    const accepted = this.ui.onScanDetected(best);
    if (accepted) {
      console.log('[Scan]', best.distributor, best.mpn, best.quantity);
    }
  }

  private onError(error: Error): void {
    console.error('Scanner error:', error);
    this.ui.setStatus(`Error: ${error.message}`);
  }
}
