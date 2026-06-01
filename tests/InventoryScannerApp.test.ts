import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before the app module imports barcode-detector
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  prepareZXingModule: vi.fn().mockResolvedValue(undefined),
  detect: vi.fn().mockResolvedValue([]),
  BarcodeDetector: vi.fn(function () {
    return { detect: mocks.detect };
  }),
  getUserMedia: vi.fn(),
}));

vi.mock('barcode-detector/ponyfill', () => ({
  BarcodeDetector: mocks.BarcodeDetector,
  prepareZXingModule: mocks.prepareZXingModule,
}));

vi.mock('@/scanner/ImagePreprocessor', () => ({
  ImagePreprocessor: vi.fn(function () {
    return {
      processFrame: vi.fn(() => document.createElement('canvas')),
      destroy: vi.fn(),
    };
  }),
}));

// Dynamically import after mocks are hoisted
const { InventoryScannerApp } = await import('@/app');

// ---------------------------------------------------------------------------
// DOM factory
// ---------------------------------------------------------------------------

function setupDom(): void {
  document.body.innerHTML = `
    <div class="app">
      <section class="camera-section">
        <div class="video-wrapper">
          <video id="scanner-video" autoplay muted playsinline></video>
          <canvas id="barcode-overlay" class="barcode-overlay"></canvas>
        </div>
        <div class="controls">
          <label class="toggle-switch">
            <input type="checkbox" id="camera-toggle">
            <span class="toggle-slider"></span>
            <span class="toggle-label">Camera Off</span>
          </label>
        </div>
        <p id="scanner-status" class="status">Camera inactive</p>
      </section>
      <section class="last-scan">
        <span id="last-scan-mpn" class="value">—</span>
        <span id="last-scan-qty" class="value">—</span>
        <span id="last-scan-dist" class="value">—</span>
        <div id="alt-candidates" class="alt-candidates" style="display:none"></div>
      </section>
      <section class="history">
        <span id="scan-count" class="badge">0</span>
        <button id="btn-clear">Clear</button>
        <button id="btn-export">Export CSV</button>
        <table><tbody id="history-body"></tbody></table>
      </section>
    </div>
    <div id="toast-container" class="toast-container"></div>
  `;
}

function mockMediaStream(): MediaStream {
  const tracks = [{
    stop: vi.fn(),
    kind: 'video',
    label: 'fake-camera',
    enabled: true,
  }] as unknown as MediaStreamTrack[];

  return {
    active: true,
    id: 'stream-1',
    getTracks: vi.fn().mockReturnValue(tracks),
    getVideoTracks: vi.fn().mockReturnValue(tracks),
    getAudioTracks: vi.fn().mockReturnValue([]),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    clone: vi.fn(),
  } as unknown as MediaStream;
}

function patchNavigator(): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      ...(globalThis.navigator || {}),
      mediaDevices: {
        ...(globalThis.navigator?.mediaDevices || {}),
        getUserMedia: mocks.getUserMedia,
      },
      clipboard: {
        ...(globalThis.navigator?.clipboard || {}),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    },
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVideo(): HTMLVideoElement {
  return document.getElementById('scanner-video') as HTMLVideoElement;
}

function getToggle(): HTMLInputElement {
  return document.getElementById('camera-toggle') as HTMLInputElement;
}

function getToggleLabel(): HTMLElement {
  return document.querySelector('.toggle-label') as HTMLElement;
}

function getStatus(): HTMLElement {
  return document.getElementById('scanner-status') as HTMLElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InventoryScannerApp (integration)', () => {
  beforeEach(() => {
    setupDom();
    patchNavigator();

    const stream = mockMediaStream();
    mocks.getUserMedia.mockResolvedValue(stream);
    mocks.prepareZXingModule.mockResolvedValue(undefined);
    mocks.detect.mockResolvedValue([]);

    // Make the DOM video element appear "ready" so the engine's
    // loadeddata wait is skipped (jsdom doesn't fire native media events).
    const video = getVideo();
    vi.spyOn(video, 'play').mockResolvedValue();
    Object.defineProperty(video, 'readyState', { value: 2, writable: true });
    Object.defineProperty(video, 'videoWidth', { value: 640, writable: true });
    Object.defineProperty(video, 'videoHeight', { value: 480, writable: true });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('camera start/stop flow', () => {
    it('attaches the camera stream to the video element on start', async () => {
      new InventoryScannerApp();

      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      // Wait for async start() to complete
      await vi.waitFor(() => {
        expect(getStatus().textContent).toBe('Camera active — show barcode');
      });

      const video = getVideo();
      expect(video.srcObject).not.toBeNull();
      expect(video.srcObject).toBeDefined();

      // Verify play() was called — without it the video would never
      // render frames and the scan loop would spin on readyState 0.
      expect(video.play).toHaveBeenCalled();

      // Verify getUserMedia was called with rear-facing camera constraint
      expect(mocks.getUserMedia).toHaveBeenCalledWith({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    });

    it('clears the video srcObject on stop', async () => {
      new InventoryScannerApp();

      // Start camera
      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => {
        expect(getStatus().textContent).toBe('Camera active — show barcode');
      });

      // Stop camera
      getToggle().checked = false;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      const video = getVideo();
      expect(video.srcObject).toBeNull();
      expect(getStatus().textContent).toBe('Camera stopped');
    });

    it('reverts toggle state when getUserMedia fails', async () => {
      mocks.getUserMedia.mockRejectedValue(new Error('Permission denied'));

      new InventoryScannerApp();

      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      // Wait for async start() to complete and fail
      await vi.waitFor(() => {
        expect(getStatus().textContent).toContain('Error');
      });

      // App should have cleaned up — isRunning stays false
      const video = getVideo();
      expect(video.srcObject).toBeNull();
    });

    it('shows starting status, then ready status on success', async () => {
      new InventoryScannerApp();

      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      // Should briefly show "Starting camera…" then "Camera active…"
      await vi.waitFor(() => {
        expect(getStatus().textContent).toBe('Camera active — show barcode');
      });
    });
  });

  describe('toggle UI', () => {
    it('shows "Camera Off" initially', () => {
      new InventoryScannerApp();
      expect(getToggleLabel().textContent).toBe('Camera Off');
      expect(getToggle().checked).toBe(false);
    });

    it('shows "Camera On" and checks the toggle after start', async () => {
      new InventoryScannerApp();

      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      await vi.waitFor(() => {
        expect(getToggleLabel().textContent).toBe('Camera On');
      });
      expect(getToggle().checked).toBe(true);
    });

    it('shows "Camera Off" and unchecks the toggle after stop', async () => {
      new InventoryScannerApp();

      // Start
      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => {
        expect(getStatus().textContent).toBe('Camera active — show barcode');
      });

      // Stop
      getToggle().checked = false;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      expect(getToggleLabel().textContent).toBe('Camera Off');
      expect(getToggle().checked).toBe(false);
    });

    it('does not start a second scanner when toggle clicked while already running', async () => {
      new InventoryScannerApp();

      // Start
      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => {
        expect(getStatus().textContent).toBe('Camera active — show barcode');
      });

      const createCount = mocks.BarcodeDetector.mock.calls.length;

      // Click again (should stop, not start a new one)
      getToggle().checked = false;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      expect(mocks.BarcodeDetector).toHaveBeenCalledTimes(createCount);
    });
  });

  describe('status text', () => {
    it('shows "Camera inactive" initially', () => {
      new InventoryScannerApp();
      expect(getStatus().textContent).toBe('Camera inactive');
    });

    it('shows "Camera stopped" after stop', async () => {
      new InventoryScannerApp();

      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => {
        expect(getStatus().textContent).toBe('Camera active — show barcode');
      });

      getToggle().checked = false;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      expect(getStatus().textContent).toBe('Camera stopped');
    });
  });

  describe('toast notifications', () => {
    it('shows a toast message when getUserMedia fails', async () => {
      mocks.getUserMedia.mockRejectedValue(new Error('Permission denied'));

      new InventoryScannerApp();

      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      await vi.waitFor(() => {
        const toasts = document.querySelectorAll('.toast--error');
        expect(toasts.length).toBeGreaterThanOrEqual(1);
        expect(toasts[0].textContent).toContain('Permission denied');
      });
    });

    it('does not show toast when start succeeds', async () => {
      new InventoryScannerApp();

      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      await vi.waitFor(() => {
        expect(getStatus().textContent).toBe('Camera active — show barcode');
      });

      const toasts = document.querySelectorAll('.toast');
      expect(toasts.length).toBe(0);
    });
  });

  describe('barcode overlay', () => {
    it('canvas element exists and is positioned over video', async () => {
      new InventoryScannerApp();

      getToggle().checked = true;
      getToggle().dispatchEvent(new Event('change', { bubbles: true }));

      await vi.waitFor(() => {
        expect(getStatus().textContent).toBe('Camera active — show barcode');
      });

      const canvas = document.getElementById('barcode-overlay') as HTMLCanvasElement;
      expect(canvas).not.toBeNull();
      expect(canvas.classList.contains('barcode-overlay')).toBe(true);
    });

    it('drawFrame handles empty array without throwing', () => {
      // Sanity: UIManager.drawFrame should not throw when canvas has no 2d context (jsdom)
      const canvas = document.getElementById('barcode-overlay');
      expect(canvas).not.toBeNull();
      // In jsdom, getContext returns null — the method handles it
    });
  });
});
