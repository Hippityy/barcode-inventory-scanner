import type { RawBarcode, ParsedComponent } from '@/types/index';
import type { BarcodeParser } from '@/parsers/BaseParser';
import { extractQuantity, looksLikeMpn, stripEciaPrefixes, mightBeNumericMpn } from '@/parsers/BaseParser';
import { isEciaFormat, parseEciaFields } from '@/parsers/EciaParser';

/** Mouser barcode parser.
 *
 * Mouser uses:
 *  - 2D Data Matrix (ECIA Format 06) with `>[)>\x1E06\x1D` header
 *  - 1D Code 128, but each field is in a SEPARATE barcode (disaggregated)
 */
export class MouserParser implements BarcodeParser {
  readonly distributor = 'mouser' as const;

  canParse(raw: RawBarcode): boolean {
    if (raw.format === 'DATA_MATRIX') {
      return isEciaFormat(raw.text) && raw.text.includes('>[)>');
    }
    if (raw.format === 'CODE_128' || raw.format === 'CODE_39') {
      return this.looksLikeMouser1d(raw.text);
    }
    return false;
  }

  parse(raw: RawBarcode): ParsedComponent | null {
    if (raw.format === 'DATA_MATRIX') {
      return this.parse2d(raw.text);
    }
    if (raw.format === 'CODE_128' || raw.format === 'CODE_39') {
      return this.parse1d(raw.text);
    }
    return null;
  }

  private looksLikeMouser1d(text: string): boolean {
    const trimmed = text.trim();
    const stripped = stripEciaPrefixes(trimmed);
    if (stripped.length === 0) {
      return false;
    }
    // Mouser part numbers often start with numeric prefix like 710-XXXXXXX
    if (/^\d{3}-[A-Z0-9]+$/i.test(stripped)) {
      return true;
    }
    // Generic alphanumeric that looks like an MPN
    if (looksLikeMpn(stripped)) {
      return true;
    }
    // Accept numeric MPN only if an ECIA prefix was explicitly present
    const hadPrefix = stripped !== trimmed;
    if (hadPrefix && mightBeNumericMpn(stripped)) {
      return true;
    }
    return false;
  }

  private parse2d(text: string): ParsedComponent | null {
    const fields = parseEciaFields(text);
    const mpn = fields.get('1P') ?? null;
    const qtyStr = fields.get('Q') ?? null;
    const quantity = qtyStr !== null ? extractQuantity(qtyStr) : null;

    if (mpn !== null && quantity !== null) {
      return {
        mpn,
        quantity,
        distributor: 'mouser',
        raw: text,
        confidence: 'high',
      };
    }
    if (mpn !== null) {
      return {
        mpn,
        quantity,
        distributor: 'mouser',
        raw: text,
        confidence: 'medium',
      };
    }
    if (quantity !== null) {
      return {
        mpn,
        quantity,
        distributor: 'mouser',
        raw: text,
        confidence: 'low',
      };
    }
    return null;
  }

  private parse1d(text: string): ParsedComponent | null {
    const trimmed = text.trim();
    const stripped = stripEciaPrefixes(trimmed);
    const hadPrefix = stripped !== trimmed;

    // Mouser P/N format: 710-XXXXXXX etc → not an MPN
    if (/^\d{3}-[A-Z0-9]+$/i.test(stripped)) {
      return {
        mpn: null,
        quantity: null,
        distributor: 'mouser',
        raw: text,
        confidence: 'low',
      };
    }
    // Alphanumeric MPN-like string
    if (looksLikeMpn(stripped)) {
      return {
        mpn: stripped,
        quantity: null,
        distributor: 'mouser',
        raw: text,
        confidence: 'medium',
      };
    }
    // Numeric MPN only if there was an explicit ECIA prefix
    if (hadPrefix && mightBeNumericMpn(stripped)) {
      return {
        mpn: stripped,
        quantity: null,
        distributor: 'mouser',
        raw: text,
        confidence: 'low',
      };
    }
    return null;
  }
}
