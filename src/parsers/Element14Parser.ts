import type { RawBarcode, ParsedComponent } from '@/types/index';
import type { BarcodeParser } from '@/parsers/BaseParser';
import { extractQuantity, looksLikeMpn, stripEciaPrefixes, mightBeNumericMpn } from '@/parsers/BaseParser';

/** Element14 (Farnell) barcode parser.
 *
 * Element14 uses:
 *  - Order codes: typically 7-digit numeric (e.g., 2361234, 1234567)
 *  - Sometimes 8-digit
 *  - Code 128 or Code 39 symbology
 *  - MPN may be in separate barcode or printed as text only
 *  - Less standardized than DigiKey/Mouser ECIA labels
 */
export class Element14Parser implements BarcodeParser {
  readonly distributor = 'element14' as const;

  canParse(raw: RawBarcode): boolean {
    if (raw.format !== 'CODE_128' && raw.format !== 'CODE_39' && raw.format !== 'DATA_MATRIX') {
      return false;
    }
    const stripped = stripEciaPrefixes(raw.text.trim());
    if (stripped.length === 0) {
      return false;
    }
    // Element14 order code pattern: 6-8 digit numeric
    if (/^\d{6,8}$/.test(stripped)) {
      return true;
    }
    // Short numeric (1-5 digits) → likely quantity
    if (/^\d{1,5}$/.test(stripped)) {
      return true;
    }
    // Alphanumeric MPN
    if (looksLikeMpn(stripped)) {
      return true;
    }
    // Long numeric could be MPN from distributors like Würth
    if (mightBeNumericMpn(stripped)) {
      return true;
    }
    return false;
  }

  parse(raw: RawBarcode): ParsedComponent | null {
    const stripped = stripEciaPrefixes(raw.text.trim());
    if (stripped.length === 0) {
      return null;
    }

    // 6-8 digit numeric → Element14 order code
    if (/^\d{6,8}$/.test(stripped)) {
      return {
        mpn: null,
        quantity: null,
        distributor: 'element14',
        raw: raw.text,
        confidence: 'low',
      };
    }

    // Short numeric (1-5 digits) → likely quantity
    if (/^\d{1,5}$/.test(stripped)) {
      const qty = extractQuantity(stripped);
      return {
        mpn: null,
        quantity: qty,
        distributor: 'element14',
        raw: raw.text,
        confidence: 'low',
      };
    }

    // Alphanumeric MPN-like
    if (looksLikeMpn(stripped)) {
      return {
        mpn: stripped,
        quantity: null,
        distributor: 'element14',
        raw: raw.text,
        confidence: 'medium',
      };
    }

    // Long numeric could be MPN from distributors like Würth/Molex
    if (mightBeNumericMpn(stripped)) {
      return {
        mpn: stripped,
        quantity: null,
        distributor: 'unknown',
        raw: raw.text,
        confidence: 'low',
      };
    }

    return null;
  }
}
