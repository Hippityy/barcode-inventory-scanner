# Barcode Scanning Library Evaluation

> **Date:** 2026-06-01  
> **Context:** The project currently uses `@zxing/browser` (0.2.0) and `@zxing/library` (0.23.0) — a pure-TypeScript port of ZXing. The user flagged that this stack is old, in maintenance mode, and asked for a thorough evaluation of modern alternatives before further architectural decisions.

---

## Project Requirements

| Requirement | Weight |
|-------------|--------|
| Client-side only (static, no backend) | Mandatory |
| Real-time camera scanning | Mandatory |
| 1D barcode support (Code 128, Code 39, Codabar, ITF) | Mandatory |
| 2D barcode support (Data Matrix, QR) | Mandatory |
| Multi-barcode detection per frame | High |
| Spatial / position data per barcode | High |
| TypeScript / modern ESM | High |
| Lightweight bundle | High |
| GS1 / ECI data parsing (for `1P`, `Q` fields) | Medium |

---

## Candidate Libraries Evaluated

### 1. `@zxing/browser` + `@zxing/library` — CURRENT STACK ❌

| Attribute | Detail |
|-----------|--------|
| **Type** | Pure TS/JS port of ZXing Java |
| **Last push** | 2026-04-27 / 2026-04-30 |
| **Stars** | 285 / 2,906 |
| **Open issues** | 55 / 168 |
| **Bundle size** | **16.6 MB** combined (5.5 + 11.1) |
| **Multi-barcode** | ❌ Single-result callback design |
| **Position data** | ⚠️ `getResultPoints()` exists but is per-single-result |
| **Maintenance** | Maintenance mode; original Java ZXing is far ahead |

**Critical limitations:**
- `BrowserMultiFormatReader.decodeFromVideoDevice()` fires **one result at a time** via callback. There is no native `decodeMultiple` for images — only `PDF417Reader` implements the `MultipleBarcodeReader` interface.
- To get multiple barcodes from one frame you must drop to `MultiFormatReader` and manually iterate / mask, or decode from canvas repeatedly.
- The browser wrapper is a thin layer over the core library; both are large and carry significant JS parsing overhead.
- ECI/GS1 parsing exists but is JS-transpiled from Java patterns that predate modern C++ ZXing improvements.

**Verdict:** Should be replaced. The single-result architecture is a dead end for spatial multi-barcode analysis.

---

### 2. `zxing-wasm` ✅✅ — STRONG CANDIDATE

| Attribute | Detail |
|-----------|--------|
| **Type** | ZXing-C++ compiled to WebAssembly |
| **Last push** | 2026-05-31 (active) |
| **Stars** | 220 |
| **Open issues** | 6 |
| **Bundle size** | **3.5 MB** total (2.98 MB WASM + 0.5 MB JS bindings) |
| **Multi-barcode** | ✅ Native `readBarcodes()` → `Promise<ReadResult[]>` |
| **Position data** | ✅ Full bounding box: `topLeft`, `topRight`, `bottomLeft`, `bottomRight` |
| **Formats** | Code 128, Code 39, Data Matrix, QR, PDF417, Aztec, EAN/UPC, ITF, DataBar, etc. |
| **Maintenance** | Very active; tracks upstream zxing-cpp closely |

**Key API:**

```typescript
import { readBarcodes } from "zxing-wasm/reader";

const results = await readBarcodes(imageData, {
  formats: ["Code128", "DataMatrix"],
  maxNumberOfSymbols: 255,   // detect ALL barcodes in image
  tryHarder: true,
  tryInvert: true,
});
// results: Array<{ text, format, position: { topLeft, topRight, bottomLeft, bottomRight }, ... }>
```

**Advantages over current stack:**
- **5× smaller** bundle (3.5 MB vs 16.6 MB).
- **Native multi-barcode** — one call returns every barcode in the frame with coordinates.
- **Accurate position data** — four-corner bounding boxes, not just `ResultPoint` arrays of varying length.
- **C++ core** — faster decoding, better handling of skewed/damaged codes.
- **Modern ESM/CJS** with TypeScript types.
- Supports `tryDenoise`, `tryDownscale`, `tryRotate`, `tryInvert` out of the box.

**Trade-offs:**
- WASM must be fetched at runtime (can be self-hosted or CDN).
- Slightly more boilerplate to wire into a video stream (no built-in `decodeFromVideoDevice`).
- `prepareZXingModule()` must be called before first use to load/instantiate the WASM.

---

### 3. `barcode-detector` ✅✅ — RECOMMENDED

| Attribute | Detail |
|-----------|--------|
| **Type** | Ponyfill / polyfill for the native Barcode Detection API |
| **Backend** | `zxing-wasm` under the hood |
| **Last push** | 2026-05-31 (active) |
| **Stars** | 217 |
| **Open issues** | 5 |
| **Bundle size** | **0.25 MB** JS + shared 3 MB WASM |
| **Multi-barcode** | ✅ `detect(image)` → `Promise<DetectedBarcode[]>` |
| **Position data** | ✅ `boundingBox: DOMRectReadOnly` + `cornerPoints: [Point2D, Point2D, Point2D, Point2D]` |
| **Formats** | All formats supported by `zxing-wasm` (Code 128, Data Matrix, etc.) |

**Key API:**

```typescript
import { BarcodeDetector } from "barcode-detector/ponyfill";

const detector = new BarcodeDetector({
  formats: ["code_128", "data_matrix", "code_39", "qr_code"],
});

const barcodes = await detector.detect(videoFrame);
// barcodes: Array<{ rawValue, format, boundingBox, cornerPoints }>
```

**Why this is the best choice:**
1. **Standard API** — The `BarcodeDetector` interface is a W3C spec. Code is portable to native browser implementations.
2. **Native fast path** — On Chrome/Edge, if the native `BarcodeDetector` exists, the ponyfill can defer to it (though format support may be limited; the ponyfill always uses zxing-wasm for full coverage).
3. **Tiny JS footprint** — The wrapper is only 0.25 MB; all heavy lifting is in the shared WASM.
4. **Multi-barcode native** — `detect()` returns an array. No manual iteration or masking needed.
5. **Clean position data** — `boundingBox` and `cornerPoints` are standard DOM-ish shapes, easy to map to canvas crops for OCR.
6. **Zero global pollution** — `ponyfill` import doesn't touch `globalThis`. A `polyfill` subpath is available if desired.
7. **Self-hostable WASM** — `prepareZXingModule()` lets you override the WASM serving path for CSP or offline use.

**Trade-offs:**
- Same WASM fetch requirement as `zxing-wasm`.
- Native Barcode Detection API (Chrome/Edge) supports fewer formats than the ponyfill; the ponyfill ignores the native implementation and always uses zxing-wasm to ensure consistency. This is actually a pro for us.

---

### 4. `html5-qrcode` ⚠️

| Attribute | Detail |
|-----------|--------|
| **Last push** | 2025-12-01 |
| **Last release** | **2023-04-15** (stale) |
| **Stars** | 6,149 |
| **Bundle size** | 2.51 MB |
| **Backend** | `@zxing/library` (same old stack) |

**Verdict:** Popular wrapper, but fundamentally uses the same `@zxing/library` we want to move away from. Stale releases. Not a true alternative.

---

### 5. `@ericblade/quagga2` ⚠️

| Attribute | Detail |
|-----------|--------|
| **Type** | Advanced 1D barcode scanner |
| **Last push** | 2026-05-28 (active) |
| **Stars** | 899 |
| **Bundle size** | 3.53 MB |
| **Multi-barcode** | Limited |
| **2D support** | ❌ No Data Matrix, no QR |

**Verdict:** Excellent for 1D-only use cases. Not suitable for electronics labels that mix 1D (Code 128) and 2D (Data Matrix).

---

### 6. `@undecaf/zbar-wasm` ⚠️

| Attribute | Detail |
|-----------|--------|
| **Type** | ZBar C++ → WASM |
| **Last push** | 2024-07-19 (moderately stale) |
| **Stars** | 191 |
| **Bundle size** | 3.14 MB |
| **Multi-barcode** | ✅ |
| **Position data** | Limited |

**Verdict:** ZBar is fast but historically weaker than ZXing on Data Matrix and skewed codes. Less active than zxing-wasm ecosystem. Not recommended over ZXing-C++ WASM.

---

### 7. Commercial SDKs ❌

| Library | Size | License |
|---------|------|---------|
| `dynamsoft-javascript-barcode` | 17.8 MB | Commercial (free tier exists) |
| `scanbot-web-sdk` | **106.57 MB** | Commercial |

**Verdict:** Too heavy, license incompatible with an open-source static app.

---

## Format Support Matrix

All evaluated ZXing-based libraries support the formats we need. ZBar is the only one with weaker Data Matrix support.

| Format | `@zxing/*` | `zxing-wasm` | `barcode-detector` | `quagga2` | `zbar-wasm` |
|--------|-----------|--------------|-------------------|-----------|-------------|
| Code 128 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Code 39 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Data Matrix | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| QR Code | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| PDF417 | ✅ | ✅ | ✅ | ❌ | ❌ |
| Codabar | ✅ | ✅ | ✅ | ✅ | ✅ |
| ITF | ✅ | ✅ | ✅ | ✅ | ✅ |
| EAN/UPC | ✅ | ✅ | ✅ | ✅ | ✅ |
| GS1 parsing (ECI) | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## Multi-Barcode & Spatial Capability Comparison

| Library | Multi-result API | Position Type | Ease of spatial analysis |
|---------|-----------------|---------------|-------------------------|
| `@zxing/browser` | ❌ Single callback | `ResultPoint[]` (variable length) | Hard |
| `zxing-wasm` | ✅ `readBarcodes()` → `ReadResult[]` | `Position { topLeft, topRight, bottomLeft, bottomRight }` | Easy |
| `barcode-detector` | ✅ `detect()` → `DetectedBarcode[]` | `boundingBox` + `cornerPoints[4]` | Very easy |
| `html5-qrcode` | ❌ Same as `@zxing` | Same as `@zxing` | Hard |

**Conclusion:** `barcode-detector` and `zxing-wasm` are the only candidates that make spatial multi-barcode analysis straightforward.

---

## Recommendation

### Primary: `barcode-detector` (ponyfill)

Replace `@zxing/browser` + `@zxing/library` with `barcode-detector`.

**Why:**
- Same underlying engine as `zxing-wasm` (ZXing-C++), so decode quality is best-in-class.
- Standard API means easier maintenance and future migration to native browser support.
- Returns **all barcodes in one frame** with **bounding boxes** — unlocks the spatial grouping and OCR-cropping features we want.
- 5× smaller than current stack.
- Actively maintained by the same author as `zxing-wasm`.

### Migration path

1. Remove `@zxing/browser` and `@zxing/library`.
2. Install `barcode-detector`.
3. Rewrite `BarcodeScannerEngine.ts`:
   - Use `prepareZXingModule()` on app startup (can preload WASM).
   - In the video loop, draw frame to offscreen canvas → `detector.detect(canvas)`.
   - Receive `DetectedBarcode[]` — no more single-result callback gymnastics.
   - Pass the array (with `boundingBox` / `cornerPoints`) to `MultiBarcodeFilter`.
4. Update `RawBarcode` type to include `boundingBox` and `cornerPoints`.
5. Parsers remain unchanged — they still receive `text` and `format` strings.

### WASM hosting

For a static app on GitHub Pages:
- Default: WASM loads from jsDelivr CDN (works out of the box).
- Optional: Copy `zxing_reader.wasm` to `public/` and override `locateFile` in `prepareZXingModule` for CSP or offline resilience.

---

## Appendix: Native Barcode Detection API

Chrome and Edge ship a native `BarcodeDetector` class. It is fast (GPU-accelerated in some cases) but has limited format support and may not support Data Matrix on all platforms. The `barcode-detector` ponyfill **always** uses `zxing-wasm` to ensure consistent cross-browser behavior, so we don't need to branch logic between native and polyfill paths.

---

## Sources

- NPM registry data retrieved 2026-06-01
- GitHub API metadata for all repositories
- Package type definitions inspected locally (`/tmp/barcode-eval/`)
- `barcode-detector` README: https://github.com/Sec-ant/barcode-detector
- `zxing-wasm` README: https://github.com/Sec-ant/zxing-wasm
