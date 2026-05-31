import { describe, it, expect } from 'vitest';
import { DigiKeyParser } from '@/parsers/DigiKeyParser';
import type { RawBarcode } from '@/types/index';

const parser = new DigiKeyParser();

describe('DigiKeyParser.canParse', () => {
  it('returns true for DATA_MATRIX with DigiKey ECIA header', () => {
    const raw: RawBarcode = { text: '[)>\x1E06\x1D1PABC\x1D', format: 'DATA_MATRIX' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns false for DATA_MATRIX with Mouser header', () => {
    const raw: RawBarcode = { text: '>[)>\x1E06\x1D1PABC\x1D', format: 'DATA_MATRIX' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns false for DATA_MATRIX without ECIA header', () => {
    const raw: RawBarcode = { text: 'random', format: 'DATA_MATRIX' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns true for CODE_128 all-numeric >10 digits', () => {
    const raw: RawBarcode = { text: '12345678901', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns false for CODE_128 all-numeric <=10 digits', () => {
    const raw: RawBarcode = { text: '1234567890', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns true for CODE_128 ending with -ND', () => {
    const raw: RawBarcode = { text: 'MAX232N-ND', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for CODE_39 ending with -TR', () => {
    const raw: RawBarcode = { text: 'RC0603-TR', format: 'CODE_39' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for CODE_128 with 1P prefix (numeric)', () => {
    const raw: RawBarcode = { text: '1P61300511121', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns false for empty CODE_128', () => {
    const raw: RawBarcode = { text: '', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns false for UNKNOWN format', () => {
    const raw: RawBarcode = { text: '12345678901', format: 'UNKNOWN' };
    expect(parser.canParse(raw)).toBe(false);
  });
});

describe('DigiKeyParser.parse', () => {
  it('returns high confidence when MPN and Q both present in 2D', () => {
    const raw: RawBarcode = {
      text: '[)>\x1E06\x1D1PLM358\x1DQ100\x1D',
      format: 'DATA_MATRIX',
    };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358');
    expect(result!.quantity).toBe(100);
    expect(result!.confidence).toBe('high');
    expect(result!.distributor).toBe('digikey');
  });

  it('returns medium confidence when only MPN present in 2D', () => {
    const raw: RawBarcode = {
      text: '[)>\x1E06\x1D1PLM358\x1D',
      format: 'DATA_MATRIX',
    };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358');
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('medium');
  });

  it('returns low confidence when only Q present in 2D', () => {
    const raw: RawBarcode = {
      text: '[)>\x1E06\x1DQ50\x1D',
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
      text: '[)>\x1E06\x1D\x1D',
      format: 'DATA_MATRIX',
    };
    const result = parser.parse(raw);
    expect(result).toBeNull();
  });

  it('parses 1D MPN-like barcode', () => {
    const raw: RawBarcode = { text: 'LM358N', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358N');
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('low');
  });

  it('parses 1D all-numeric long barcode as DK PN', () => {
    const raw: RawBarcode = { text: '12345678901', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBeNull();
    expect(result!.quantity).toBeNull();
    expect(result!.distributor).toBe('digikey');
  });

  it('parses 1D with 1P prefix as MPN (alphanumeric)', () => {
    const raw: RawBarcode = { text: '1PMAX123', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('MAX123');
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('low');
  });

  it('parses 1D with 1P prefix as MPN (numeric)', () => {
    const raw: RawBarcode = { text: '1P61300511121', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('61300511121');
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('low');
  });

  it('returns null for 1D that does not match any pattern', () => {
    const raw: RawBarcode = { text: '???', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).toBeNull();
  });

  it('returns null for UNKNOWN format', () => {
    const raw: RawBarcode = { text: 'anything', format: 'UNKNOWN' };
    expect(parser.parse(raw)).toBeNull();
  });
});
