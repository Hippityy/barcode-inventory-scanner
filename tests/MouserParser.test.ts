import { describe, it, expect } from 'vitest';
import { MouserParser } from '@/parsers/MouserParser';
import type { RawBarcode } from '@/types/index';

const parser = new MouserParser();

describe('MouserParser.canParse', () => {
  it('returns true for DATA_MATRIX with Mouser ECIA header', () => {
    const raw: RawBarcode = { text: '>[)>\x1E06\x1D1PABC\x1D', format: 'DATA_MATRIX' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns false for DATA_MATRIX with DigiKey header', () => {
    const raw: RawBarcode = { text: '[)>\x1E06\x1D1PABC\x1D', format: 'DATA_MATRIX' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns true for CODE_128 Mouser PN format', () => {
    const raw: RawBarcode = { text: '710-1234567', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for CODE_128 alphanumeric MPN', () => {
    const raw: RawBarcode = { text: 'LM358N', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for CODE_128 with 1P prefix', () => {
    const raw: RawBarcode = { text: '1PMAX123', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for CODE_128 with 1P prefix (numeric MPN)', () => {
    const raw: RawBarcode = { text: '1P61300511121', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns false for CODE_128 with 1P prefix but short numeric', () => {
    const raw: RawBarcode = { text: '1P100', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns false for CODE_128 long numeric without prefix', () => {
    const raw: RawBarcode = { text: '61300511121', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns false for 1D that does not match any pattern', () => {
    const raw: RawBarcode = { text: '???', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns false for empty CODE_128', () => {
    const raw: RawBarcode = { text: '', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns false for UNKNOWN format', () => {
    const raw: RawBarcode = { text: 'anything', format: 'UNKNOWN' };
    expect(parser.canParse(raw)).toBe(false);
  });
});

describe('MouserParser.parse', () => {
  it('returns high confidence when MPN and Q both present in 2D', () => {
    const raw: RawBarcode = {
      text: '>[)>\x1E06\x1D1PMAX232N\x1DQ50\x1D',
      format: 'DATA_MATRIX',
    };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('MAX232N');
    expect(result!.quantity).toBe(50);
    expect(result!.confidence).toBe('high');
    expect(result!.distributor).toBe('mouser');
  });

  it('returns medium confidence when only MPN present in 2D', () => {
    const raw: RawBarcode = {
      text: '>[)>\x1E06\x1D1PMAX232N\x1D',
      format: 'DATA_MATRIX',
    };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('MAX232N');
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('medium');
  });

  it('returns low confidence when only Q present in 2D', () => {
    const raw: RawBarcode = {
      text: '>[)>\x1E06\x1DQ50\x1D',
      format: 'DATA_MATRIX',
    };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBeNull();
    expect(result!.quantity).toBe(50);
    expect(result!.confidence).toBe('low');
  });

  it('returns null for 2D with no recognizable fields', () => {
    const raw: RawBarcode = {
      text: '>[)>\x1E06\x1D\x1D',
      format: 'DATA_MATRIX',
    };
    const result = parser.parse(raw);
    expect(result).toBeNull();
  });

  it('parses 1D Mouser PN as low-confidence distributor info', () => {
    const raw: RawBarcode = { text: '710-1234567', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBeNull();
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('low');
  });

  it('parses 1D MPN-like barcode as medium confidence', () => {
    const raw: RawBarcode = { text: 'LM358N', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358N');
    expect(result!.confidence).toBe('medium');
  });

  it('parses 1D with 1P prefix as MPN', () => {
    const raw: RawBarcode = { text: '1PMAX123', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('MAX123');
    expect(result!.confidence).toBe('medium');
  });

  it('parses 1D with 1P prefix numeric as MPN (low confidence)', () => {
    const raw: RawBarcode = { text: '1P61300511121', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('61300511121');
    expect(result!.confidence).toBe('low');
  });

  it('returns null for long numeric without prefix', () => {
    const raw: RawBarcode = { text: '61300511121', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).toBeNull();
  });

  it('returns null for 1D that does not match', () => {
    const raw: RawBarcode = { text: '???', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).toBeNull();
  });

  it('returns null for UNKNOWN format', () => {
    const raw: RawBarcode = { text: 'anything', format: 'UNKNOWN' };
    expect(parser.parse(raw)).toBeNull();
  });
});
