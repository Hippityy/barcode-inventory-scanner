import type { RawBarcode, ParsedComponent, Distributor } from '@/types/index';

/** Extract numeric quantity from a string, or null if not valid/parsable */
export function extractQuantity(qtyStr: string): number | null {
  const trimmed = qtyStr.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < 0 || parsed > 999999999) {
    return null;
  }
  return parsed;
}

/** Check if a string looks like a manufacturer part number */
export function looksLikeMpn(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return false;
  }
  const hasLetter = /[A-Za-z]/.test(trimmed);
  const onlyDigitsAndLettersAndSymbols = /^[A-Za-z0-9\-_.\/]+$/.test(trimmed);
  // Must contain at least one letter (true MPNs are never pure numeric)
  return onlyDigitsAndLettersAndSymbols && hasLetter;
}

/** Known ECIA data identifiers, longest first to avoid partial matches */
const ECIA_DIS = [
  '11K', '4L', '4K', '9D', '1T', '1P', '1V', '2P', '3S', '4S',
  'P', 'Q', 'K', 'S',
];

/** Strip leading ECIA data identifier from a barcode string.
 *
 * Distributors like Würth embed 1D barcodes with ECIA prefixes (e.g. "1P<MPN>").
 * This removes the prefix so downstream heuristics operate on the actual value.
 */
export function stripEciaPrefixes(text: string): string {
  const trimmed = text.trim();
  for (const di of ECIA_DIS) {
    if (trimmed.startsWith(di)) {
      return trimmed.slice(di.length).trim();
    }
  }
  return trimmed;
}

/** Weak heuristic for purely numeric MPNs (e.g. Würth 61300511121).
 *
 * Distinguishing these from order codes requires external data, so any match
 * is treated as low-confidence and presented to the user for verification.
 */
export function mightBeNumericMpn(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length > 16) {
    return false;
  }
  return /^\d+$/.test(trimmed);
}

/** Base interface for all barcode parsers */
export interface BarcodeParser {
  readonly distributor: Distributor;
  canParse(raw: RawBarcode): boolean;
  parse(raw: RawBarcode): ParsedComponent | null;
}

/** Try all parsers and return the highest-confidence result */
export function tryAllParsers(
  raw: RawBarcode,
  parsers: readonly BarcodeParser[]
): ParsedComponent | null {
  let best: ParsedComponent | null = null;
  for (const parser of parsers) {
    if (!parser.canParse(raw)) {
      continue;
    }
    const result = parser.parse(raw);
    if (result === null) {
      continue;
    }
    if (best === null) {
      best = result;
      continue;
    }
    if (result.confidence === 'high' && best.confidence !== 'high') {
      best = result;
      continue;
    }
    if (result.confidence === 'medium' && best.confidence === 'low') {
      best = result;
      continue;
    }
    // Prefer result with more fields populated
    const resultScore = (result.mpn ? 1 : 0) + (result.quantity !== null ? 1 : 0);
    const bestScore = (best.mpn ? 1 : 0) + (best.quantity !== null ? 1 : 0);
    if (resultScore > bestScore) {
      best = result;
      continue;
    }
  }
  return best;
}
