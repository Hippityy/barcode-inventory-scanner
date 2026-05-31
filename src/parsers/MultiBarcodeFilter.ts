import type { RawBarcode, ParsedComponent } from '@/types/index';
import type { BarcodeParser } from '@/parsers/BaseParser';
import { tryAllParsers } from '@/parsers/BaseParser';

/** Score a parsed component for ranking. Higher is better. */
export function scoreComponent(pc: ParsedComponent): number {
  let score = 0;
  if (pc.confidence === 'high') {
    score += 100;
  } else if (pc.confidence === 'medium') {
    score += 50;
  } else {
    score += 10;
  }
  if (pc.mpn !== null && pc.mpn.length > 0) {
    score += 40;
  }
  if (pc.quantity !== null && pc.quantity > 0) {
    score += 40;
  }
  return score;
}

/** Merge multiple parsed components into a single best-guess result.
 *
 * When we have multiple 1D barcodes from the same label, we can try
 * to combine an MPN barcode with a quantity barcode.
 */
export function mergeComponents(components: readonly ParsedComponent[]): ParsedComponent | null {
  if (components.length === 0) {
    return null;
  }
  if (components.length === 1) {
    return components[0];
  }

  let bestMpn: string | null = null;
  let bestQty: number | null = null;
  let bestDistributor: ParsedComponent['distributor'] = 'unknown';
  let bestConfidence: ParsedComponent['confidence'] = 'low';
  const raws: string[] = [];

  for (const pc of components) {
    raws.push(pc.raw);

    // Pick the best MPN
    if (pc.mpn !== null && pc.mpn.length > 0) {
      if (bestMpn === null || pc.confidence === 'high') {
        bestMpn = pc.mpn;
      }
    }

    // Pick the best quantity
    if (pc.quantity !== null && pc.quantity > 0) {
      if (bestQty === null) {
        bestQty = pc.quantity;
      }
    }

    // Pick highest-confidence distributor
    if (pc.distributor !== 'unknown') {
      bestDistributor = pc.distributor;
    }
    if (pc.confidence === 'high') {
      bestConfidence = 'high';
    } else if (pc.confidence === 'medium' && bestConfidence === 'low') {
      bestConfidence = 'medium';
    }
  }

  if (bestMpn === null && bestQty === null) {
    return null;
  }

  return {
    mpn: bestMpn,
    quantity: bestQty,
    distributor: bestDistributor,
    raw: raws.join('; '),
    confidence: bestConfidence,
  };
}

/** Smart filter that processes multiple barcodes and returns the best extracted component.
 *
 * Strategy:
 * 1. If any barcode is a high-confidence 2D ECIA barcode with both MPN and Qty → use it.
 * 2. Otherwise, try all parsers on all barcodes and merge the best results.
 * 3. If we have a 2D barcode (even partial), prefer it over 1D.
 * 4. For multiple 1D barcodes, try to merge an MPN + Qty pair.
 */
export function filterMultipleBarcodes(
  barcodes: readonly RawBarcode[],
  parsers: readonly BarcodeParser[]
): ParsedComponent | null {
  if (barcodes.length === 0) {
    return null;
  }

  const parsedResults: ParsedComponent[] = [];
  let hasHighConfidence2d = false;

  for (const raw of barcodes) {
    const result = tryAllParsers(raw, parsers);
    if (result !== null) {
      parsedResults.push(result);
      if (result.confidence === 'high' && raw.format === 'DATA_MATRIX') {
        hasHighConfidence2d = true;
      }
    }
  }

  if (parsedResults.length === 0) {
    return null;
  }

  // If we have a high-confidence 2D barcode, prefer it if it has both fields
  if (hasHighConfidence2d) {
    const complete2d = parsedResults.find(
      (r) => r.confidence === 'high' && r.mpn !== null && r.quantity !== null
    );
    if (complete2d) {
      return complete2d;
    }
  }

  // If we have any high-confidence result, use the best one
  const highResults = parsedResults.filter((r) => r.confidence === 'high');
  if (highResults.length > 0) {
    let best = highResults[0];
    for (const r of highResults) {
      if (scoreComponent(r) > scoreComponent(best)) {
        best = r;
      }
    }
    return best;
  }

  // Try merging multiple medium/low results
  const mergeResult = mergeComponents(parsedResults);
  if (mergeResult !== null) {
    return mergeResult;
  }

  // Fall back to the single best-scored result
  let best = parsedResults[0];
  for (const r of parsedResults) {
    if (scoreComponent(r) > scoreComponent(best)) {
      best = r;
    }
  }
  return best;
}
