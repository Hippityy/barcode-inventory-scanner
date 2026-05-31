import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BarcodeScannerEngine, type ScannerCallbacks } from '@/scanner/BarcodeScannerEngine';
import type { RawBarcode } from '@/types/index';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted runs before vi.mock hoisting, so the factory can use it
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  prepareZXingModule: vi.fn().mockResolvedValue(undefined),
  detect: vi.fn().mockResolvedValue([]),
  BarcodeDetector: vi.fn(function () {
    return { detect: mocks.detect };
  }),
}));

vi.mock('barcode-detector/ponyfill', () => ({
  BarcodeDetector: mocks.BarcodeDetector,
  prepareZXingModule: mocks.prepareZXingModule,
}));

// Polyfill DOMRectReadOnly if jsdom lacks it
if (typeof DOMRectReadOnly === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).DOMRectReadOnly = class DOMRectReadOnly {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
    constructor(x: number, y: number, width: number, height: number) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.top = y;
      this.right = x + width;
      this.bottom = y + height;
      this.left = x;
    }
    toJSON() {
      return { x: this.x, y: this.y, width: this.width, height: this.height, top: this.top, right: this.right, bottom: this.bottom, left: this.left };
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCallbacks(): ScannerCallbacks {
  return {
    onDetect: vi.fn(),
    onError: vi.fn(),
    onReady: vi.fn(),
  };
}

function stubVideo(): HTMLVideoElement {
  return document.createElement('video');
}

/** Manual rAF controller — queues callbacks and fires them only when told. */
class RafController {
  private queue: Array<(time: number) => void> = [];
  private id = 0;
  private ids = new Map<number, (time: number) => void>();

  request = (cb: (time: number) => void): number => {
    this.id += 1;
    this.ids.set(this.id, cb);
    this.queue.push(cb);
    return this.id;
  };

  cancel = (id: number): void => {
    const cb = this.ids.get(id);
    if (cb) {
      this.ids.delete(id);
      const idx = this.queue.indexOf(cb);
      if (idx !== -1) this.queue.splice(idx, 1);
    }
  };

  /** Fire the next queued callback and return a promise that settles
   *  after any microtasks (Promise .then handlers) it creates. */
  async step(): Promise<void> {
    const cb = this.queue.shift();
    if (cb) {
      cb(performance.now());
    }
    // Allow Promise chains (detect().then(...)) to settle
    await new Promise((r) => setTimeout(r, 0));
  }

  /** Fire N steps. */
  async steps(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await this.step();
    }
  }

  clear(): void {
    this.queue = [];
    this.ids.clear();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BarcodeScannerEngine', () => {
  let rafCtrl: RafController;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareZXingModule.mockResolvedValue(undefined);
    mocks.detect.mockResolvedValue([]);

    rafCtrl = new RafController();
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(rafCtrl.request);
    cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(rafCtrl.cancel);
  });

  afterEach(() => {
    rafCtrl.clear();
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  describe('start', () => {
    it('prepares the WASM module before creating the detector', async () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      expect(mocks.prepareZXingModule).toHaveBeenCalledOnce();
    });

    it('creates BarcodeDetector with no format filter when formats omitted', async () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());

      expect(mocks.BarcodeDetector).toHaveBeenCalledOnce();
      expect(mocks.BarcodeDetector).toHaveBeenCalledWith({ formats: undefined });
    });

    it('creates BarcodeDetector with mapped format names', async () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine(
        { formats: ['CODE_128', 'DATA_MATRIX'] },
        cb
      );
      await engine.start(stubVideo());

      expect(mocks.BarcodeDetector).toHaveBeenCalledOnce();
      expect(mocks.BarcodeDetector).toHaveBeenCalledWith({
        formats: ['code_128', 'data_matrix'],
      });
    });

    it('emits mapped barcodes on detection', async () => {
      mocks.detect.mockResolvedValue([
        {
          rawValue: 'LM358N',
          format: 'code_128',
          boundingBox: new DOMRectReadOnly(10, 20, 100, 50),
          cornerPoints: [
            { x: 10, y: 20 },
            { x: 110, y: 20 },
            { x: 10, y: 70 },
            { x: 110, y: 70 },
          ],
        },
      ]);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      await rafCtrl.step(); // one scan iteration

      expect(cb.onDetect).toHaveBeenCalledOnce();
      const emitted = (cb.onDetect as ReturnType<typeof vi.fn>).mock.calls[0][0] as RawBarcode[];

      expect(emitted).toHaveLength(1);
      expect(emitted[0].text).toBe('LM358N');
      expect(emitted[0].format).toBe('CODE_128');
      expect(emitted[0].boundingBox).toBeDefined();
      expect(emitted[0].cornerPoints).toBeDefined();
      expect(emitted[0].cornerPoints).toHaveLength(4);
    });

    it('fires onReady only after the first successful detection', async () => {
      // First two frames empty, third frame has a barcode
      mocks.detect
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { rawValue: 'X', format: 'qr_code', boundingBox: new DOMRectReadOnly(0, 0, 1, 1), cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
        ]);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());

      await rafCtrl.step(); // frame 1 — empty
      await rafCtrl.step(); // frame 2 — empty
      await rafCtrl.step(); // frame 3 — barcode found

      expect(cb.onReady).toHaveBeenCalledOnce();
      expect(cb.onDetect).toHaveBeenCalledOnce();
    });

    it('fires onReady only once even across multiple consecutive detections', async () => {
      mocks.detect
        .mockResolvedValueOnce([
          { rawValue: 'A', format: 'code_128', boundingBox: new DOMRectReadOnly(0, 0, 1, 1), cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
        ])
        .mockResolvedValueOnce([
          { rawValue: 'B', format: 'code_128', boundingBox: new DOMRectReadOnly(0, 0, 1, 1), cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
        ]);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());

      await rafCtrl.step(); // first detection
      expect(cb.onReady).toHaveBeenCalledOnce();

      await rafCtrl.step(); // second detection
      expect(cb.onReady).toHaveBeenCalledOnce(); // still only once
      expect(cb.onDetect).toHaveBeenCalledTimes(2);
    });

    it('does not emit onDetect when no barcodes are found', async () => {
      mocks.detect.mockResolvedValue([]);
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      await rafCtrl.steps(3);

      expect(cb.onDetect).not.toHaveBeenCalled();
      expect(cb.onReady).not.toHaveBeenCalled();
    });

    it('calls onError when WASM preparation fails', async () => {
      const err = new Error('WASM load failed');
      mocks.prepareZXingModule.mockRejectedValue(err);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());

      expect(cb.onError).toHaveBeenCalledOnce();
      expect(cb.onError).toHaveBeenCalledWith(err);
    });

    it('calls onError when WASM preparation throws a non-Error value', async () => {
      mocks.prepareZXingModule.mockRejectedValue('plain string error');

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());

      expect(cb.onError).toHaveBeenCalledOnce();
      expect(cb.onError).toHaveBeenCalledWith(new Error('plain string error'));
    });

    it('calls onError when detector.detect throws', async () => {
      const err = new Error('Detection failure');
      mocks.detect.mockRejectedValue(err);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      await rafCtrl.step();

      expect(cb.onError).toHaveBeenCalledOnce();
      expect(cb.onError).toHaveBeenCalledWith(err);
    });

    it('calls onError with wrapped non-Error when detector.detect rejects with a string', async () => {
      mocks.detect.mockRejectedValue('bad detect');

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      await rafCtrl.step();

      expect(cb.onError).toHaveBeenCalledOnce();
      expect(cb.onError).toHaveBeenCalledWith(new Error('bad detect'));
    });

    it('does not re-queue rAF if engine is stopped during onDetect callback', async () => {
      mocks.detect.mockResolvedValue([
        { rawValue: 'A', format: 'code_128', boundingBox: new DOMRectReadOnly(0, 0, 1, 1), cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
      ]);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      // Stop the engine inside the detection callback before the loop re-queues
      (cb.onDetect as ReturnType<typeof vi.fn>).mockImplementation(() => engine.stop());

      await engine.start(stubVideo());
      await rafCtrl.step();

      expect(cb.onDetect).toHaveBeenCalledOnce();
      // No new rAF should have been queued after stop()
      expect(rafSpy).toHaveBeenCalledTimes(1); // only the initial start() rAF
    });

    it('does not re-queue rAF if engine is stopped during onError callback', async () => {
      mocks.detect.mockRejectedValue(new Error('boom'));

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      // Stop the engine inside the error callback before the loop re-queues
      (cb.onError as ReturnType<typeof vi.fn>).mockImplementation(() => engine.stop());

      await engine.start(stubVideo());
      await rafCtrl.step();

      expect(cb.onError).toHaveBeenCalledOnce();
      // No new rAF should have been queued after stop()
      expect(rafSpy).toHaveBeenCalledTimes(1); // only the initial start() rAF
    });

    it('continues scanning after a detection error', async () => {
      const err = new Error('Transient');
      mocks.detect
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce([
          { rawValue: 'OK', format: 'code_128', boundingBox: new DOMRectReadOnly(0, 0, 1, 1), cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
        ]);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());

      await rafCtrl.step(); // error frame
      expect(cb.onError).toHaveBeenCalledOnce();
      expect(cb.onDetect).not.toHaveBeenCalled();

      await rafCtrl.step(); // recovery frame
      expect(cb.onDetect).toHaveBeenCalledOnce();
      expect((cb.onDetect as ReturnType<typeof vi.fn>).mock.calls[0][0][0].text).toBe('OK');
    });

    it('is idempotent — second start does nothing', async () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      const video = stubVideo();

      await engine.start(video);
      await engine.start(video); // second call
      await rafCtrl.step();

      expect(mocks.BarcodeDetector).toHaveBeenCalledOnce();
    });

    it('maps unknown detector formats to UNKNOWN', async () => {
      mocks.detect.mockResolvedValue([
        {
          rawValue: '???',
          format: 'compact_pdf417',
          boundingBox: new DOMRectReadOnly(0, 0, 1, 1),
          cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
        },
      ]);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      await rafCtrl.step();

      const emitted = (cb.onDetect as ReturnType<typeof vi.fn>).mock.calls[0][0] as RawBarcode[];
      expect(emitted[0].format).toBe('UNKNOWN');
    });
  });

  describe('stop', () => {
    it('cancels the animation frame loop', async () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());

      const lastId = rafSpy.mock.results[rafSpy.mock.results.length - 1].value as number;
      engine.stop();

      expect(cafSpy).toHaveBeenCalledWith(lastId);
    });

    it('prevents further detections after stopping', async () => {
      mocks.detect.mockResolvedValue([
        { rawValue: 'A', format: 'code_128', boundingBox: new DOMRectReadOnly(0, 0, 1, 1), cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
      ]);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      await rafCtrl.step();

      const callsBefore = (cb.onDetect as ReturnType<typeof vi.fn>).mock.calls.length;
      engine.stop();
      await rafCtrl.steps(3);
      const callsAfter = (cb.onDetect as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(callsAfter).toBe(callsBefore);
    });

    it('allows restarting after stop', async () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);

      await engine.start(stubVideo());
      engine.stop();

      // Reset counters
      mocks.detect.mockClear();
      mocks.prepareZXingModule.mockClear();
      mocks.BarcodeDetector.mockClear();

      await engine.start(stubVideo());
      expect(mocks.prepareZXingModule).toHaveBeenCalledOnce();
    });

    it('is safe to stop an engine that was never started', () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      // Should not throw when no rAF is pending
      expect(() => engine.stop()).not.toThrow();
    });

    it('is safe to stop twice', async () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      engine.stop();
      // Second stop should be a no-op, not throw
      expect(() => engine.stop()).not.toThrow();
    });

    it('does not process detection results if engine is stopped while detect() is pending', async () => {
      let resolveDetect: (value: unknown) => void;
      mocks.detect.mockImplementation(() => new Promise((res) => {
        resolveDetect = res;
      }));

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      await rafCtrl.step(); // scanLoop runs, detect() called, promise pending

      engine.stop(); // stop before promise resolves
      resolveDetect!([
        { rawValue: 'X', format: 'code_128', boundingBox: new DOMRectReadOnly(0, 0, 1, 1), cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
      ]);
      await new Promise((r) => setTimeout(r, 0)); // let microtasks settle

      expect(cb.onDetect).not.toHaveBeenCalled();
      expect(cb.onReady).not.toHaveBeenCalled();
    });

    it('does not process detection error if engine is stopped while detect() is pending', async () => {
      let rejectDetect: (reason: Error) => void;
      mocks.detect.mockImplementation(() => new Promise((_res, rej) => {
        rejectDetect = rej;
      }));

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      await rafCtrl.step(); // scanLoop runs, detect() called, promise pending

      engine.stop(); // stop before promise rejects
      rejectDetect!(new Error('Late failure'));
      await new Promise((r) => setTimeout(r, 0)); // let microtasks settle

      expect(cb.onError).not.toHaveBeenCalled();
    });

    it('guards scanLoop when not running', async () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      engine.stop();
      // Directly invoke the private loop — should bail out immediately
      (engine as any).scanLoop();
      expect(cb.onDetect).not.toHaveBeenCalled();
      expect(cb.onError).not.toHaveBeenCalled();
    });
  });

  describe('format mapping', () => {
    it.each([
      ['code_128', 'CODE_128'],
      ['code_39', 'CODE_39'],
      ['qr_code', 'QR_CODE'],
      ['data_matrix', 'DATA_MATRIX'],
      ['ean_13', 'EAN_13'],
      ['upc_a', 'UPC_A'],
    ] as const)('maps detector format %s → %s', async (detectorFmt, internalFmt) => {
      mocks.detect.mockResolvedValue([
        {
          rawValue: 'X',
          format: detectorFmt,
          boundingBox: new DOMRectReadOnly(0, 0, 1, 1),
          cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
        },
      ]);

      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine({}, cb);
      await engine.start(stubVideo());
      await rafCtrl.step();

      const emitted = (cb.onDetect as ReturnType<typeof vi.fn>).mock.calls[0][0] as RawBarcode[];
      expect(emitted[0].format).toBe(internalFmt);
    });

    it('passes all supported format names to the detector', async () => {
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine(
        { formats: ['CODE_128', 'CODE_39', 'QR_CODE', 'DATA_MATRIX', 'EAN_13', 'UPC_A'] },
        cb
      );
      await engine.start(stubVideo());

      expect(mocks.BarcodeDetector).toHaveBeenCalledOnce();
      expect(mocks.BarcodeDetector).toHaveBeenCalledWith({
        formats: ['code_128', 'code_39', 'qr_code', 'data_matrix', 'ean_13', 'upc_a'],
      });
    });

    it('falls back to "unknown" for an unexpected format option', async () => {
      // Bypass the type system to exercise the defensive default
      const cb = makeCallbacks();
      const engine = new BarcodeScannerEngine(
        { formats: ['UNKNOWN' as RawBarcode['format']] },
        cb
      );
      await engine.start(stubVideo());

      expect(mocks.BarcodeDetector).toHaveBeenCalledOnce();
      expect(mocks.BarcodeDetector).toHaveBeenCalledWith({
        formats: ['unknown'],
      });
    });
  });
});
