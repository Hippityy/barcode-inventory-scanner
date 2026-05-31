import type { RawBarcode, ParsedComponent } from '@/types/index';
import type { BarcodeParser } from '@/parsers/BaseParser';
import { extractQuantity, looksLikeMpn } from '@/parsers/BaseParser';
import { isEciaFormat, parseEciaFields } from '@/parsers/EciaParser';

/** DigiKey barcode parser.
 *
 * DigiKey uses:
 *  - 2D Data Matrix (ECIA Format 06) with `[)>\x1E06\x1D` header
 *  - 1D Code 128, often all-numeric DigiKey part numbers (length > 10)
 *  - DigiKey PNs can also be alphanumeric like `MAX232N-ND`
 */
export class DigiKeyParser implements BarcodeParser {
  readonly distributor = 'digikey' as const;

  canParse(raw: RawBarcode): boolean {
    if (raw.format === 'DATA_MATRIX') {
      return isEciaFormat(raw.text) && !raw.text.includes('>[)>');
    }
    if (raw.format === 'CODE_128' || raw.format === 'CODE_39') {
      return this.looksLikeDigiKey1d(raw.text);
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

  private looksLikeDigiKey1d(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return false;
    }
    // DigiKey 1D: all numeric and length > 10 is strong indicator
    if (/^\d+$/.test(trimmed) && trimmed.length > 10) {
      return true;
    }
    // DigiKey PNs often end with -ND, -TR, -CT, -DK
    if (/^[A-Z0-9\-]+-(ND|TR|CT|DK)$/i.test(trimmed)) {
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
        distributor: 'digikey',
        raw: text,
        confidence: 'high',
      };
    }
    if (mpn !== null) {
      return {
        mpn,
        quantity,
        distributor: 'digikey',
        raw: text,
        confidence: 'medium',
      };
    }
    if (quantity !== null) {
      return {
        mpn,
        quantity,
        distributor: 'digikey',
        raw: text,
        confidence: 'low',
      };
    }
    return null;
  }

  private parse1d(text: string): ParsedComponent | null {
    const trimmed = text.trim();
    // If it looks like an MPN, treat it as such
    if (looksLikeMpn(trimmed)) {
      return {
        mpn: trimmed,
        quantity: null,
        distributor: 'digikey',
        raw: text,
        confidence: 'low',
      };
    }
    // All-numeric long barcode → DigiKey PN (we can't resolve MPN without API)
    if (/^\d+$/.test(trimmed) && trimmed.length > 10) {
      return {
        mpn: null,
        quantity: null,
        distributor: 'digikey',
        raw: text,
        confidence: 'low',
      };
    }
    return null;
  }
}
