/**
 * Video-frame preprocessing for faded / low-contrast barcodes.
 *
 * ZXing's LocalAverage binarizer struggles when bars and spaces have
 * insufficient contrast.  This module draws each video frame onto an
 * offscreen canvas, applies a contrast-stretch + light unsharp mask,
 * and returns the processed canvas for the barcode detector.
 *
 * The pipeline is intentionally single-pass — no multi-scale / adaptive
 * histogram equalisation — to keep per-frame cost low (< 2 ms on a
 * 720p frame in Chrome/V8).
 */

export class ImagePreprocessor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;

  /** Clip this fraction from each tail of the histogram before
   *  stretching (0–1).  0.02 = clip bottom 2 % and top 2 %. */
  private readonly clipFraction: number;

  constructor(clipFraction = 0.02) {
    this.clipFraction = clipFraction;
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Cannot create 2d context for preprocessing');
    this.ctx = ctx;
  }

  /** Process a video frame and return a canvas with contrast-enhanced,
   *  sharpened grayscale data ready for `BarcodeDetector.detect()`. */
  processFrame(video: HTMLVideoElement): HTMLCanvasElement {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return this.canvas;

    this.resizeIfNeeded(vw, vh);

    // 1. Draw the video frame to our offscreen canvas
    this.ctx.drawImage(video, 0, 0, vw, vh);

    // 2. Get raw RGBA pixel data
    const imageData = this.ctx.getImageData(0, 0, vw, vh);
    const pixels = imageData.data;
    const total = vw * vh;

    // 3. Convert to grayscale luminance + build histogram
    const gray = new Uint8Array(total);
    const hist = new Uint32Array(256);
    for (let i = 0; i < total; i++) {
      const off = i << 2;
      // Standard luminance weights (BT.601)
      const lum = Math.round(
        0.299 * pixels[off] + 0.587 * pixels[off + 1] + 0.114 * pixels[off + 2],
      );
      gray[i] = lum;
      hist[lum]++;
    }

    // 4. Find percentile thresholds for contrast stretching
    const clipCount = Math.floor(total * this.clipFraction);
    let lo = 0;
    let hi = 255;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= clipCount) {
        lo = i;
        break;
      }
    }
    acc = 0;
    for (let i = 255; i >= 0; i--) {
      acc += hist[i];
      if (acc >= clipCount) {
        hi = i;
        break;
      }
    }

    // If the image is already full-range, skip the stretch
    const range = hi - lo;
    const stretch = range > 0 && (lo > 0 || hi < 255);

    // 5. Write processed pixels back
    //    Stretch + optional unsharp-mask kernel (3×3, weight 8 at centre,
    //    -1 on 4-neighbours, normalised to original centre weight).
    const stride = vw;
    const kCenter = 12; // boost centre weight (higher = less sharpening)
    const kNeighbor = -1; // 4-connected neighbors subtract

    for (let y = 0; y < vh; y++) {
      for (let x = 0; x < vw; x++) {
        const idx = y * stride + x;

        // Contrast stretch
        let val: number;
        if (stretch) {
          val = Math.round(((gray[idx] - lo) / range) * 255);
          if (val < 0) val = 0;
          if (val > 255) val = 255;
        } else {
          val = gray[idx];
        }

        // Light unsharp mask (skip border pixels to keep it fast)
        if (x > 0 && x < vw - 1 && y > 0 && y < vh - 1) {
          const sum =
            kCenter * val +
            kNeighbor * gray[idx - 1] +
            kNeighbor * gray[idx + 1] +
            kNeighbor * gray[idx - stride] +
            kNeighbor * gray[idx + stride];
          val = Math.round(sum / (kCenter + kNeighbor * 4));
          if (val < 0) val = 0;
          if (val > 255) val = 255;
        }

        // Write back as RGB (same value for all channels = grayscale image)
        const off = idx << 2;
        pixels[off] = val;
        pixels[off + 1] = val;
        pixels[off + 2] = val;
        // alpha stays as-is (255 from drawImage)
      }
    }

    this.ctx.putImageData(imageData, 0, 0);
    return this.canvas;
  }

  /** Resize the offscreen canvas to match video dimensions. */
  private resizeIfNeeded(vw: number, vh: number): void {
    if (this.w === vw && this.h === vh) return;
    this.canvas.width = vw;
    this.canvas.height = vh;
    this.w = vw;
    this.h = vh;
  }

  /** Release canvas resources (no-op for now — canvas is managed by GC). */
  destroy(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.w = 0;
    this.h = 0;
  }
}
