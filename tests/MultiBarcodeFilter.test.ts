import { describe, it, expect } from 'vitest';
import { filterMultipleBarcodes, mergeComponents, scoreComponent } from '@/parsers/MultiBarcodeFilter';
import { DigiKeyParser } from '@/parsers/DigiKeyParser';
import { MouserParser } from '@/parsers/MouserParser';
import { Element14Parser } from '@/parsers/Element14Parser';
import type { BarcodeParser } from '@/parsers/BaseParser';
import type { RawBarcode, ParsedComponent } from '@/types/index';

const parsers = [new DigiKeyParser(), new MouserParser(), new Element14Parser()];

describe('filterMultipleBarcodes', () => {
  it('returns null for empty barcode array', () => {
    const result = filterMultipleBarcodes([], parsers);
    expect(result).toBeNull();
  });

  it('returns null when no barcodes are parseable', () => {
    const barcodes: RawBarcode[] = [
      { text: '???', format: 'UNKNOWN' },
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).toBeNull();
  });

  it('selects high-confidence 2D DigiKey barcode with full fields', () => {
    const barcodes: RawBarcode[] = [
      { text: '[)>\x1E06\x1D1PLM358\x1DQ100\x1D', format: 'DATA_MATRIX' },
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358');
    expect(result!.quantity).toBe(100);
    expect(result!.confidence).toBe('high');
  });

  it('selects high-confidence 2D Mouser barcode with full fields', () => {
    const barcodes: RawBarcode[] = [
      { text: '>[)>\x1E06\x1D1PMAX232N\x1DQ50\x1D', format: 'DATA_MATRIX' },
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('MAX232N');
    expect(result!.quantity).toBe(50);
    expect(result!.distributor).toBe('mouser');
  });

  it('prefers 2D with both fields over 2D with partial fields', () => {
    const barcodes: RawBarcode[] = [
      { text: '[)>\x1E06\x1D1PLM358\x1D', format: 'DATA_MATRIX' }, // medium
      { text: '[)>\x1E06\x1D1PMAX232N\x1DQ50\x1D', format: 'DATA_MATRIX' }, // high
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('MAX232N');
    expect(result!.quantity).toBe(50);
    expect(result!.confidence).toBe('high');
  });

  it('merges multiple 1D barcodes into single result', () => {
    const barcodes: RawBarcode[] = [
      { text: 'LM358N', format: 'CODE_128' },
      { text: '100', format: 'CODE_128' },
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358N');
    expect(result!.quantity).toBe(100);
  });

  it('returns single 1D result when only one barcode parseable', () => {
    const barcodes: RawBarcode[] = [
      { text: 'LM358N', format: 'CODE_128' },
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358N');
    expect(result!.quantity).toBeNull();
  });

  it('ignores unparseable barcodes in a mixed batch', () => {
    const barcodes: RawBarcode[] = [
      { text: '???', format: 'UNKNOWN' },
      { text: '710-1234567', format: 'CODE_128' },
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).not.toBeNull();
    expect(result!.distributor).toBe('mouser');
  });

  it('prefers high confidence over medium in multiple 2D', () => {
    const barcodes: RawBarcode[] = [
      { text: '>[)>\x1E06\x1D1PABC\x1D', format: 'DATA_MATRIX' }, // mouser medium
      { text: '[)>\x1E06\x1D1PXYZ\x1DQ10\x1D', format: 'DATA_MATRIX' }, // dk high
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('XYZ');
    expect(result!.quantity).toBe(10);
    expect(result!.confidence).toBe('high');
  });

  it('handles Element14 order code and quantity together', () => {
    const barcodes: RawBarcode[] = [
      { text: '2361234', format: 'CODE_128' },
      { text: '50', format: 'CODE_128' },
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).not.toBeNull();
    expect(result!.distributor).toBe('element14');
    expect(result!.quantity).toBe(50);
  });

  it('prefers high confidence 1D over others', () => {
    const high1d: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: 'HIGH1D', quantity: null, distributor: 'unknown', raw: 'a', confidence: 'high' }),
    };
    const medium: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: 'MED', quantity: null, distributor: 'unknown', raw: 'b', confidence: 'medium' }),
    };
    const barcodes: RawBarcode[] = [{ text: 'x', format: 'CODE_128' }];
    const result = filterMultipleBarcodes(barcodes, [medium, high1d]);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('high');
  });

  it('falls back to highest-scored result when merge yields nothing', () => {
    const barcodes: RawBarcode[] = [
      { text: '12345678901', format: 'CODE_128' },
      { text: '12345678902', format: 'CODE_128' },
    ];
    const result = filterMultipleBarcodes(barcodes, parsers);
    expect(result).not.toBeNull();
    expect(result!.distributor).toBe('digikey');
  });
});

describe('scoreComponent', () => {
  it('scores high confidence with all fields highest', () => {
    const pc: ParsedComponent = { mpn: 'A', quantity: 10, distributor: 'digikey', raw: '', confidence: 'high' };
    expect(scoreComponent(pc)).toBe(180);
  });
  it('scores medium confidence with mpn only', () => {
    const pc: ParsedComponent = { mpn: 'A', quantity: null, distributor: 'digikey', raw: '', confidence: 'medium' };
    expect(scoreComponent(pc)).toBe(90);
  });
  it('scores low confidence with qty only', () => {
    const pc: ParsedComponent = { mpn: null, quantity: 10, distributor: 'digikey', raw: '', confidence: 'low' };
    expect(scoreComponent(pc)).toBe(50);
  });
  it('scores low confidence with nothing', () => {
    const pc: ParsedComponent = { mpn: null, quantity: null, distributor: 'digikey', raw: '', confidence: 'low' };
    expect(scoreComponent(pc)).toBe(10);
  });
});

describe('mergeComponents', () => {
  it('returns null for empty array', () => {
    expect(mergeComponents([])).toBeNull();
  });
  it('returns the same component for single element', () => {
    const pc: ParsedComponent = { mpn: 'X', quantity: 5, distributor: 'mouser', raw: '', confidence: 'high' };
    expect(mergeComponents([pc])).toEqual(pc);
  });
  it('uses high confidence when one result has it', () => {
    const a: ParsedComponent = { mpn: 'A', quantity: null, distributor: 'digikey', raw: '', confidence: 'high' };
    const b: ParsedComponent = { mpn: null, quantity: 10, distributor: 'digikey', raw: '', confidence: 'low' };
    const merged = mergeComponents([a, b]);
    expect(merged!.confidence).toBe('high');
    expect(merged!.mpn).toBe('A');
    expect(merged!.quantity).toBe(10);
  });
  it('returns null when all components have null mpn and qty', () => {
    const a: ParsedComponent = { mpn: null, quantity: null, distributor: 'digikey', raw: '', confidence: 'medium' };
    const b: ParsedComponent = { mpn: null, quantity: null, distributor: 'element14', raw: '', confidence: 'low' };
    expect(mergeComponents([a, b])).toBeNull();
  });
  it('skips second MPN when bestMpn already set and confidence is not high', () => {
    const a: ParsedComponent = { mpn: 'FIRST', quantity: null, distributor: 'digikey', raw: '', confidence: 'medium' };
    const b: ParsedComponent = { mpn: 'SECOND', quantity: null, distributor: 'digikey', raw: '', confidence: 'medium' };
    const merged = mergeComponents([a, b]);
    expect(merged!.mpn).toBe('FIRST');
  });
  it('skips second quantity when bestQty already set', () => {
    const a: ParsedComponent = { mpn: null, quantity: 10, distributor: 'digikey', raw: '', confidence: 'low' };
    const b: ParsedComponent = { mpn: null, quantity: 20, distributor: 'digikey', raw: '', confidence: 'low' };
    const merged = mergeComponents([a, b]);
    expect(merged!.quantity).toBe(10);
  });
});

describe('filterMultipleBarcodes tie-break coverage', () => {
  it('picks higher-scored high result in the high-results loop', () => {
    const highPartial: BarcodeParser = {
      distributor: 'unknown',
      canParse: (raw: RawBarcode) => raw.text === 'a',
      parse: () => ({ mpn: 'PARTIAL', quantity: null, distributor: 'unknown', raw: '', confidence: 'high' }),
    };
    const highFull: BarcodeParser = {
      distributor: 'unknown',
      canParse: (raw: RawBarcode) => raw.text === 'b',
      parse: () => ({ mpn: 'FULL', quantity: 100, distributor: 'unknown', raw: '', confidence: 'high' }),
    };
    const barcodes: RawBarcode[] = [
      { text: 'a', format: 'CODE_128' },
      { text: 'b', format: 'CODE_128' },
    ];
    const result = filterMultipleBarcodes(barcodes, [highPartial, highFull]);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('FULL');
    expect(result!.quantity).toBe(100);
  });

  it('picks higher-scored fallback result when merge yields nothing', () => {
    const lowNull: BarcodeParser = {
      distributor: 'unknown',
      canParse: (raw: RawBarcode) => raw.text === 'a',
      parse: () => ({ mpn: null, quantity: null, distributor: 'unknown', raw: '', confidence: 'low' }),
    };
    const mediumNull: BarcodeParser = {
      distributor: 'unknown',
      canParse: (raw: RawBarcode) => raw.text === 'b',
      parse: () => ({ mpn: null, quantity: null, distributor: 'unknown', raw: '', confidence: 'medium' }),
    };
    const barcodes: RawBarcode[] = [
      { text: 'a', format: 'CODE_128' },
      { text: 'b', format: 'CODE_128' },
    ];
    const result = filterMultipleBarcodes(barcodes, [lowNull, mediumNull]);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('medium');
  });

  it('falls through when high-confidence 2D lacks quantity', () => {
    const high2dPartial: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: (raw: RawBarcode) => ({
        mpn: 'PART2D',
        quantity: null,
        distributor: 'unknown',
        raw: raw.text,
        confidence: 'high',
      }),
    };
    const barcodes: RawBarcode[] = [
      { text: '2d', format: 'DATA_MATRIX' },
    ];
    const result = filterMultipleBarcodes(barcodes, [high2dPartial]);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('PART2D');
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('high');
  });
});
