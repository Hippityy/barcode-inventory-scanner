import type { RawBarcode, ParsedComponent, Distributor } from '../types/index.ts';

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
  // Must contain at least one letter if longer than 6 chars, or have mixed alphanumeric
  const hasLetter = /[A-Za-z]/.test(trimmed);
  const hasDigit = /\d/.test(trimmed);
  const onlyDigitsAndLettersAndSymbols = /^[A-Za-z0-9\-_.\/]+$/.test(trimmed);
  return onlyDigitsAndLettersAndSymbols && (hasLetter || (hasDigit && trimmed.length > 6));
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
