/**
 * Core types for the barcode inventory scanner.
 */

/** Supported distributor sources */
export type Distributor = 'digikey' | 'mouser' | 'element14' | 'unknown';

/** Barcode symbology formats */
export type BarcodeFormat = 'CODE_128' | 'CODE_39' | 'QR_CODE' | 'DATA_MATRIX' | 'EAN_13' | 'UPC_A' | 'UNKNOWN';

/** Raw barcode result from the scanner engine */
export interface RawBarcode {
  readonly text: string;
  readonly format: BarcodeFormat;
}

/** Parsed component fields extracted from a barcode */
export interface ParsedComponent {
  readonly mpn: string | null;
  readonly quantity: number | null;
  readonly distributor: Distributor;
  readonly raw: string;
  readonly confidence: 'high' | 'medium' | 'low';
}

/** A scan event to display in the history */
export interface ScanRecord {
  readonly id: string;
  readonly mpn: string;
  readonly quantity: number;
  readonly distributor: Distributor;
  readonly rawBarcodes: string[];
  readonly timestamp: number;
}

/** Result of the smart filter over multiple barcodes */
export interface FilterResult {
  readonly component: ParsedComponent | null;
  readonly mergedFrom: RawBarcode[];
}
