import type { ScanRecord, ParsedComponent, RawBarcode } from '@/types/index';

/** Generates a short unique ID */
function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** UI Manager for the barcode scanner app.
 *
 * Handles all DOM manipulation and user interactions.
 * Kept as a plain class with no framework dependencies.
 */
export class UIManager {
  private readonly video: HTMLVideoElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly statusEl: HTMLElement;
  private readonly lastScanMpn: HTMLElement;
  private readonly lastScanQty: HTMLElement;
  private readonly lastScanDist: HTMLElement;
  private readonly historyBody: HTMLElement;
  private readonly scanCountEl: HTMLElement;
  private readonly toggleInput: HTMLInputElement;
  private readonly toggleLabel: HTMLElement;
  private readonly toastContainer: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly exportBtn: HTMLButtonElement;
  private audioCtx: AudioContext | null = null;
  private scanHistory: ScanRecord[] = [];
  private lastScanTime = 0;
  private readonly debounceMs = 1500;

  constructor() {
    this.video = document.getElementById('scanner-video') as HTMLVideoElement;
    this.overlayCanvas = document.getElementById('barcode-overlay') as HTMLCanvasElement;
    this.statusEl = document.getElementById('scanner-status') as HTMLElement;
    this.lastScanMpn = document.getElementById('last-scan-mpn') as HTMLElement;
    this.lastScanQty = document.getElementById('last-scan-qty') as HTMLElement;
    this.lastScanDist = document.getElementById('last-scan-dist') as HTMLElement;
    this.historyBody = document.getElementById('history-body') as HTMLElement;
    this.scanCountEl = document.getElementById('scan-count') as HTMLElement;
    this.toggleInput = document.getElementById('camera-toggle') as HTMLInputElement;
    this.toggleLabel = document.querySelector('.toggle-label') as HTMLElement;
    this.toastContainer = document.getElementById('toast-container') as HTMLElement;
    this.clearBtn = document.getElementById('btn-clear') as HTMLButtonElement;
    this.exportBtn = document.getElementById('btn-export') as HTMLButtonElement;

    // Audio context for beep feedback
    try {
      this.audioCtx = new AudioContext();
    } catch {
      // Audio not available — silent mode
    }

    this.bindEvents();
  }

  /** Return the video element for the scanner engine. */
  getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  /** Bind UI event listeners. */
  private bindEvents(): void {
    this.clearBtn.addEventListener('click', () => this.clearHistory());
    this.exportBtn.addEventListener('click', () => this.exportCsv());
  }

  /** Set the camera toggle handler from the app controller. */
  setToggleHandler(handler: () => void): void {
    this.toggleInput.addEventListener('change', handler);
  }

  /** Update the toggle to reflect camera state. */
  setCameraActive(active: boolean): void {
    this.toggleInput.checked = active;
    this.toggleLabel.textContent = active ? 'Camera On' : 'Camera Off';
  }

  /** Update scanner status text. */
  setStatus(status: string): void {
    this.statusEl.textContent = status;
  }

  /** Draw bounding-box rectangles on the canvas overlay for each detected
   *  barcode.  Pass an empty array to clear. */
  drawFrame(barcodes: readonly RawBarcode[]): void {
    const canvas = this.overlayCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (vw === 0 || vh === 0) return;

    // Match canvas pixel dimensions to the video's intrinsic resolution
    // so bounding-box coords map 1:1.  CSS object-fit:cover scales it visually.
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }

    ctx.clearRect(0, 0, vw, vh);

    for (const bc of barcodes) {
      const box = bc.boundingBox;
      if (!box) continue;

      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = Math.max(2, vw * 0.002);
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      // Small label showing the barcode text
      ctx.fillStyle = '#00ff88';
      ctx.font = `${Math.max(11, vh * 0.022)}px monospace`;
      const label = bc.text.length > 24 ? bc.text.slice(0, 22) + '…' : bc.text;
      const textY = box.y > 20 ? box.y - 4 : box.y + box.height + 14;
      ctx.fillText(label, box.x, textY);
    }
  }

  /** Show a transient toast notification (bottom-right). */
  showToast(message: string, type: 'error' | 'info' = 'info'): void {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;

    // Click dismisses early
    const dismiss = () => {
      if (toast.parentNode) {
        toast.classList.add('toast--exiting');
        toast.addEventListener('animationend', () => toast.remove());
      }
    };
    toast.addEventListener('click', dismiss);

    // Auto-dismiss after 6 s
    const timer = setTimeout(dismiss, 6000);

    // Clean up timer if dismissed early
    toast.addEventListener('animationend', () => clearTimeout(timer), { once: true });

    this.toastContainer.appendChild(toast);
  }

  /** Called when a new component is detected. Returns true if accepted, false if debounced. */
  onScanDetected(component: ParsedComponent): boolean {
    const now = Date.now();
    if (now - this.lastScanTime < this.debounceMs) {
      return false;
    }

    // Prevent duplicate scans of the same MPN within debounce window
    const isDuplicate = this.scanHistory.some(
      (r) => r.mpn === component.mpn && r.quantity === component.quantity && now - r.timestamp < 5000
    );

    if (isDuplicate) {
      this.playTone(300, 0.1, 'square');
      return false;
    }

    this.lastScanTime = now;

    const record: ScanRecord = {
      id: makeId(),
      mpn: component.mpn ?? '',
      quantity: component.quantity ?? 0,
      distributor: component.distributor,
      rawBarcodes: component.raw.split('; '),
      timestamp: now,
    };

    this.scanHistory.unshift(record);
    this.updateLastScan(record);
    this.addHistoryRow(record);
    this.updateCount();
    this.playTone(880, 0.15, 'sine');
    return true;
  }

  private updateLastScan(record: ScanRecord): void {
    this.lastScanMpn.textContent = record.mpn || '—';
    this.lastScanQty.textContent = record.quantity > 0 ? String(record.quantity) : '—';
    this.lastScanDist.textContent = record.distributor;
  }

  private addHistoryRow(record: ScanRecord): void {
    const row = document.createElement('tr');
    row.dataset.id = record.id;

    const mpnCell = document.createElement('td');
    mpnCell.textContent = record.mpn || '—';

    const qtyCell = document.createElement('td');
    qtyCell.textContent = record.quantity > 0 ? String(record.quantity) : '—';

    const distCell = document.createElement('td');
    distCell.textContent = record.distributor;

    const actionsCell = document.createElement('td');
    const copyMpnBtn = document.createElement('button');
    copyMpnBtn.textContent = 'Copy MPN';
    copyMpnBtn.addEventListener('click', () => this.copyToClipboard(record.mpn, `MPN ${record.mpn}`));

    const copyQtyBtn = document.createElement('button');
    copyQtyBtn.textContent = 'Copy Qty';
    copyQtyBtn.addEventListener('click', () => this.copyToClipboard(String(record.quantity), `Qty ${record.quantity}`));

    const copyRowBtn = document.createElement('button');
    copyRowBtn.textContent = 'Copy Row';
    copyRowBtn.addEventListener('click', () => this.copyToClipboard(`${record.mpn}\t${record.quantity}`, `row`));

    actionsCell.appendChild(copyMpnBtn);
    actionsCell.appendChild(copyQtyBtn);
    actionsCell.appendChild(copyRowBtn);

    row.appendChild(mpnCell);
    row.appendChild(qtyCell);
    row.appendChild(distCell);
    row.appendChild(actionsCell);

    this.historyBody.insertBefore(row, this.historyBody.firstChild);
  }

  private updateCount(): void {
    this.scanCountEl.textContent = String(this.scanHistory.length);
  }

  private clearHistory(): void {
    this.scanHistory = [];
    this.historyBody.innerHTML = '';
    this.lastScanMpn.textContent = '—';
    this.lastScanQty.textContent = '—';
    this.lastScanDist.textContent = '—';
    this.updateCount();
  }

  private async copyToClipboard(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    this.showToast(`Copied ${label}`, 'info');
  }

  /** Copy MPN to clipboard and show feedback toast */
  copyMpn(mpn: string): void {
    this.copyToClipboard(mpn, `MPN ${mpn}`);
  }

  private exportCsv(): void {
    if (this.scanHistory.length === 0) {
      return;
    }
    const header = 'MPN,Quantity,Distributor,Timestamp\n';
    const rows = this.scanHistory
      .map(
        (r) =>
          `${this.csvEscape(r.mpn)},${r.quantity},${r.distributor},${new Date(r.timestamp).toISOString()}`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scans-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private csvEscape(text: string): string {
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  private playTone(freq: number, duration: number, type: OscillatorType): void {
    if (!this.audioCtx) {
      return;
    }
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start();
    osc.stop(this.audioCtx.currentTime + duration);
  }
}
