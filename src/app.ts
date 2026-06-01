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
  private isRunning = false;

  constructor() {
    this.ui = new UIManager();
    this.ui.setToggleHandler(() => this.toggleCamera());
  }

  private async toggleCamera(): Promise<void> {
    if (this.isRunning) {
      this.stop();
    } else {
      await this.start();
    }
  }

  async start(): Promise<void> {
    this.ui.setCameraActive(true);
    this.ui.setStatus('Starting camera…');

    this.scanner = new BarcodeScannerEngine(
      {},
      {
        onDetect: (barcodes) => this.onDetect(barcodes),
        onError: (err) => this.onError(err),
        onReady: () => this.ui.setStatus('Camera active — show barcode'),
        onFrame: (barcodes) => this.ui.drawFrame(barcodes),
      }
    );

    const ok = await this.scanner.start(this.ui.getVideoElement());
    if (!ok) {
      this.scanner = null;
      return;
    }
    this.isRunning = true;
  }

  stop(): void {
    this.scanner?.stop();
    this.scanner = null;
    this.isRunning = false;
    this.ui.setCameraActive(false);
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
      void this.processAccumulated();
    }, this.accumulateWindowMs);
  }

  private async processAccumulated(): Promise<void> {
    const batch = this.accumulated;
    this.accumulated = [];

    if (batch.length === 0) {
      return;
    }

    const best = filterMultipleBarcodes(batch, this.parsers);
    if (best === null) {
      return;
    }

    // Collect all unique MPN candidates (including rejected ones) from the batch
    const seen = new Set<string>();
    const alternatives: { mpn: string; distributor: string }[] = [];
    for (const parser of this.parsers) {
      for (const raw of batch) {
        if (!parser.canParse(raw)) continue;
        const result = parser.parse(raw);
        if (result?.mpn && !seen.has(result.mpn) && result.mpn !== best.mpn) {
          seen.add(result.mpn);
          alternatives.push({ mpn: result.mpn, distributor: result.distributor });
        }
      }
    }

    const accepted = this.ui.onScanDetected(best);
    if (accepted && best.mpn) {
      console.log('[Scan]', best.distributor, best.mpn, best.quantity);
      await this.ui.copyMpn(best.mpn);
      this.ui.showAlternatives(alternatives);
    }
  }

  private onError(error: Error): void {
    console.error('Scanner error:', error);
    this.ui.setStatus(`Error: ${error.message}`);
    this.ui.showToast(error.message, 'error');
  }
}
