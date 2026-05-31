# Potential Spatial & OCR Solutions for MPN Extraction

> **Status:** Design proposals — not yet implemented.  
> **Goal:** Reliably extract MPNs from labels where the MPN is not inside a barcode, while keeping the app lightweight and client-side only.

---

## 1. Position-Aware Barcode Grouping (Spatial Deduplication)

### What it does
Uses the spatial coordinates (`getResultPoints()`) returned by ZXing for each barcode to group multiple detections into a single "label" and suppress duplicates.

### How it works
- Capture `ResultPoint` `{x, y}` arrays from every `Result`.
- Track detections across a short buffer (e.g., 500 ms or 10 frames).
- Two barcodes are considered the **same** if:
  - Text matches, OR
  - Positions are within a small pixel threshold (`~30 px`) and format is identical.
- A **label group** is a cluster of barcodes whose bounding boxes overlap significantly.

### Pros
- No extra libraries; uses data ZXing already provides.
- Eliminates duplicate scan entries when the same barcode is seen across consecutive frames.
- Could prevent merging scans from two different parts held side-by-side.

### Cons
- `ResultPoint` ordering and coordinate systems vary by barcode format.
- Adds state-management complexity (buffers, thresholds, frame timestamps).
- Still doesn't tell you **which** barcode on a label is the MPN.

### When to use
As a foundational improvement before any other spatial feature. Even standalone, it makes the scan log cleaner.

---

## 2. Snapshot Multi-Decode (One Frame → All Barcodes)

### What it does
Instead of relying on the continuous video callback (which fires once per detected barcode), freeze a single frame and decode **all** barcodes present in that image at once, returning a complete set with positions.

### How it works
1. Capture current video frame to a `<canvas>`.
2. Instead of `BrowserMultiFormatReader.decodeFromVideoDevice()`, use the lower-level:
   - `MultiFormatReader.decode()` or
   - Repeatedly call `decodeFromCanvas()` and blank out found regions until no more barcodes are found.
3. Collect every `Result` into an array.
4. Pass the array to `MultiBarcodeFilter` / parser pipeline.

### Pros
- Guarantees we see the full label at once, not a staggered stream.
- Simplifies grouping logic — everything in one array is from the same physical label.
- Enables downstream spatial analysis (e.g., sort barcodes left-to-right).

### Cons
- ZXing's browser wrapper doesn't expose a clean `decodeMultiple` for images; requires dropping to core `MultiFormatReader` or iterative decode-and-mask.
- `decodeMultiple` is only natively implemented for `PDF417Reader` in this library version.
- Slightly higher per-frame CPU cost than continuous callback mode.

### When to use
When we need the full context of a label in one shot — especially before applying OCR region hints.

---

## 3. Barcode-Guided Local OCR ("Crop & Read")

### What it does
If no barcode contains a high-confidence MPN, use the barcode's position as an anchor, crop the nearby printed text, and run lightweight OCR on that small region.

### How it works
1. From snapshot multi-decode, get all barcode bounding boxes.
2. For each barcode, define a **search strip** above/below/left/right (e.g., 1.5× barcode height).
3. Run OCR (e.g., Tesseract.js or a lighter model) **only on that crop**.
4. Feed OCR output through existing heuristics:
   - `looksLikeMpn()` for alphanumeric strings.
   - `mightBeNumericMpn()` for 8–16 digit numeric strings.
5. Keep the candidate with highest parser confidence.

### Pros
- Avoids full-frame OCR (~10 MB model, 1–3 s) by running on tiny crops (~50 KB, <100 ms).
- MPNs are almost always printed adjacent to a barcode on distributor labels.
- Can read purely numeric MPNs (Würth, Molex, TE) that barcodes don't carry.

### Cons
- Adds a runtime dependency (Tesseract.js or smaller WASM OCR).
- Requires snapshot multi-decode to know *where* to crop.
- OCR errors on skewed/low-contrast prints may need retry/rotation logic.

### When to use
As a fallback after barcode parsing yields no MPN. Best suited for Würth, Molex, and generic passives where MPN is human-readable only.

---

## 4. Label-Layout Heuristics (Per-Distributor Spatial Rules)

### What it does
Hard-code known spatial layouts for specific distributors (e.g., DigiKey's typical 3-barcode strip) and use relative positions to select the MPN barcode.

### How it works
- After snapshot multi-decode, sort barcodes by position (left-to-right or top-to-bottom).
- Apply distributor-specific rules:
  - **DigiKey 1D strip (3 barcodes):** left = order code, middle = quantity, right = MPN.
  - **Mouser bag label:** single barcode + printed MPN below.
- Use text patterns to *guess* distributor if unknown, then apply layout.

### Pros
- No OCR needed if the MPN is in a barcode and position is consistent.
- Very fast — pure geometry + string matching.

### Cons
- Distributors change label layouts without notice.
- Same distributor uses different layouts for reels, cut tape, and boxes.
- Fragile; high maintenance burden.
- **Not recommended** as a primary strategy.

### When to use
Potentially as a confidence-boosting hint, not a sole source of truth. Lower priority than other solutions.

---

## Summary Matrix

| Solution | Extra Deps | Complexity | Solves "No MPN in Barcode" | Recommended Priority |
|----------|-----------|------------|---------------------------|---------------------|
| Position-Aware Grouping | None | Medium | No | **1st** (foundation) |
| Snapshot Multi-Decode | None | Medium | Partially | **2nd** (enables rest) |
| Barcode-Guided Local OCR | Tesseract.js (light) | High | **Yes** | **3rd** (fallback) |
| Label-Layout Heuristics | None | Low–Medium | Partially | **4th** (low priority) |

---

## Recommended Implementation Order

1. **Add `ResultPoint` to `RawBarcode`** and build a small spatial buffer in `BarcodeScannerEngine`.
2. **Prototype snapshot multi-decode** using `MultiFormatReader` on a canvas frame; compare reliability vs. continuous mode.
3. **If step 2 is stable**, add local OCR fallback using Tesseract.js with a `createWorker('eng', 1, { logger: ... })` configured for single-line character recognition.
4. **Keep layout heuristics as a last resort** — only if OCR fails and we have strong distributor detection.

---

## Notes

- `BrowserMultiFormatReader` (ZXing browser wrapper) is designed around **single-result callbacks**. Any multi-barcode-per-frame feature requires either:
  - Dropping to core `MultiFormatReader`, or
  - Iterative decode-and-mask on a canvas.
- `MultipleBarcodeReader` interface exists in `@zxing/library` but is only implemented for `PDF417Reader` in this version; QR/Code 128 do not expose `decodeMultiple`.
- Tesseract.js traineddata can be cached in `IndexedDB` after first load to avoid repeated CDN fetches.
- All proposals preserve the **static client-side** constraint: no server, no auth, no shared state.
