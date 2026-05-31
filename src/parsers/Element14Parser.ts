import type { RawBarcode, ParsedComponent } from '@/types/index';
import type { BarcodeParser } from '@/parsers/BaseParser';
import { extractQuantity, looksLikeMpn } from '@/parsers/BaseParser';

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
    const trimmed = raw.text.trim();
    if (trimmed.length === 0) {
      return false;
    }
    // Element14 order code pattern: 6-8 digit numeric
    if (/^\d{6,8}$/.test(trimmed)) {
      return true;
    }
    // Short numeric (1-5 digits) → likely quantity
    if (/^\d{1,5}$/.test(trimmed)) {
      return true;
    }
    // Alphanumeric MPN
    if (looksLikeMpn(trimmed)) {
      return true;
    }
    return false;
  }

  parse(raw: RawBarcode): ParsedComponent | null {
    const trimmed = raw.text.trim();
    if (trimmed.length === 0) {
      return null;
    }

    // 6-8 digit numeric → Element14 order code
    if (/^\d{6,8}$/.test(trimmed)) {
      return {
        mpn: null,
        quantity: null,
        distributor: 'element14',
        raw: raw.text,
        confidence: 'low',
      };
    }

    // Short numeric (1-5 digits) → likely quantity
    if (/^\d{1,5}$/.test(trimmed)) {
      const qty = extractQuantity(trimmed);
      return {
        mpn: null,
        quantity: qty,
        distributor: 'element14',
        raw: raw.text,
        confidence: 'low',
      };
    }

    // Alphanumeric MPN-like
    if (looksLikeMpn(trimmed)) {
      return {
        mpn: trimmed,
        quantity: null,
        distributor: 'element14',
        raw: raw.text,
        confidence: 'medium',
      };
    }

    return null;
  }
}
