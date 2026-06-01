import { describe, it, expect } from 'vitest';
import { extractQuantity, looksLikeMpn, tryAllParsers, stripEciaPrefixes, mightBeNumericMpn } from '@/parsers/BaseParser';
import type { BarcodeParser } from '@/parsers/BaseParser';
import { DigiKeyParser } from '@/parsers/DigiKeyParser';
import { MouserParser } from '@/parsers/MouserParser';
import type { RawBarcode } from '@/types/index';

const parsers = [new DigiKeyParser(), new MouserParser()];

describe('extractQuantity', () => {
  it('returns null for empty string', () => {
    expect(extractQuantity('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(extractQuantity('   ')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(extractQuantity('abc')).toBeNull();
  });

  it('returns null for float string', () => {
    expect(extractQuantity('10.5')).toBeNull();
  });

  it('returns null for negative number', () => {
    expect(extractQuantity('-5')).toBeNull();
  });

  it('returns null for number exceeding max', () => {
    expect(extractQuantity('1000000000')).toBeNull();
  });

  it('parses valid integer at boundary max', () => {
    expect(extractQuantity('999999999')).toBe(999999999);
  });

  it('parses valid integer at zero', () => {
    expect(extractQuantity('0')).toBe(0);
  });

  it('parses valid integer with whitespace', () => {
    expect(extractQuantity('  42  ')).toBe(42);
  });
});

describe('looksLikeMpn', () => {
  it('returns false for empty string', () => {
    expect(looksLikeMpn('')).toBe(false);
  });

  it('returns false for single character', () => {
    expect(looksLikeMpn('A')).toBe(false);
  });

  it('returns false for letters-only string (no digits)', () => {
    expect(looksLikeMpn('AB')).toBe(false);
  });

  it('returns false for known non-MPN label metadata', () => {
    expect(looksLikeMpn('CUSTPO')).toBe(false);
    expect(looksLikeMpn('INVOICE')).toBe(false);
    expect(looksLikeMpn('COUNTRY')).toBe(false);
  });

  it('returns false for blacklisted prefix followed by number', () => {
    expect(looksLikeMpn('PO12345')).toBe(false);
    expect(looksLikeMpn('INV67890')).toBe(false);
  });

  it('does not reject strings that merely start with blacklisted prefix', () => {
    // "POWER01" starts with "PO" but is a legitimate MPN pattern
    expect(looksLikeMpn('POWER01')).toBe(true);
  });

  it('returns true for typical MPN with letters and digits', () => {
    expect(looksLikeMpn('LM358')).toBe(true);
  });

  it('returns true for MPN with dash', () => {
    expect(looksLikeMpn('MAX232N-ND')).toBe(true);
  });

  it('returns true for MPN with slash', () => {
    expect(looksLikeMpn('RC0603FR-0710KL')).toBe(true);
  });

  it('returns true for Molex-style hyphenated numeric MPN', () => {
    expect(looksLikeMpn('43045-0612')).toBe(true);
  });

  it('returns true for TE-style multi-hyphen numeric MPN', () => {
    expect(looksLikeMpn('1-480700-0')).toBe(true);
  });

  it('returns false for pure numeric short string', () => {
    expect(looksLikeMpn('123')).toBe(false);
  });

  it('returns false for pure numeric long string', () => {
    expect(looksLikeMpn('12345678')).toBe(false);
  });

  it('returns false for string with spaces', () => {
    expect(looksLikeMpn('LM 358')).toBe(false);
  });

  it('returns false for string with special chars outside allowed', () => {
    expect(looksLikeMpn('LM358@')).toBe(false);
  });
});

describe('stripEciaPrefixes', () => {
  it('strips 1P prefix', () => {
    expect(stripEciaPrefixes('1PMAX123')).toBe('MAX123');
  });

  it('strips Q prefix', () => {
    expect(stripEciaPrefixes('Q100')).toBe('100');
  });

  it('strips 11K prefix', () => {
    expect(stripEciaPrefixes('11K12345')).toBe('12345');
  });

  it('prefers longer DI match', () => {
    expect(stripEciaPrefixes('11KABC')).toBe('ABC');
  });

  it('returns original when no prefix matches', () => {
    expect(stripEciaPrefixes('LM358N')).toBe('LM358N');
  });

  it('trims whitespace after stripping', () => {
    expect(stripEciaPrefixes('  1P MAX123  ')).toBe('MAX123');
  });

  it('handles empty string', () => {
    expect(stripEciaPrefixes('')).toBe('');
  });
});

describe('mightBeNumericMpn', () => {
  it('returns true for 8-digit numeric', () => {
    expect(mightBeNumericMpn('12345678')).toBe(true);
  });

  it('returns true for 11-digit numeric (Würth-like)', () => {
    expect(mightBeNumericMpn('61300511121')).toBe(true);
  });

  it('returns true for 16-digit numeric', () => {
    expect(mightBeNumericMpn('1234567890123456')).toBe(true);
  });

  it('returns false for 7-digit numeric (order code territory)', () => {
    expect(mightBeNumericMpn('1234567')).toBe(false);
  });

  it('returns false for 17-digit numeric (too long)', () => {
    expect(mightBeNumericMpn('12345678901234567')).toBe(false);
  });

  it('returns false for alphanumeric', () => {
    expect(mightBeNumericMpn('LM358N')).toBe(false);
  });

  it('returns false for short quantity', () => {
    expect(mightBeNumericMpn('100')).toBe(false);
  });
});

describe('tryAllParsers', () => {
  it('returns null when no parsers match', () => {
    const raw: RawBarcode = { text: '???', format: 'UNKNOWN' };
    expect(tryAllParsers(raw, parsers)).toBeNull();
  });

  it('returns null when parser canParse is true but parse returns null', () => {
    const nullParser: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => null,
    };
    const raw: RawBarcode = { text: 'anything', format: 'CODE_128' };
    expect(tryAllParsers(raw, [nullParser])).toBeNull();
  });

  it('returns result from single matching parser', () => {
    const raw: RawBarcode = { text: 'LM358', format: 'CODE_128' };
    const result = tryAllParsers(raw, parsers);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358');
  });

  it('prefers high confidence over medium', () => {
    const mediumParser: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: 'MED', quantity: null, distributor: 'unknown', raw: 'm', confidence: 'medium' }),
    };
    const highParser: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: 'HIGH', quantity: 10, distributor: 'unknown', raw: 'h', confidence: 'high' }),
    };
    const raw: RawBarcode = { text: 'test', format: 'CODE_128' };
    const result = tryAllParsers(raw, [mediumParser, highParser]);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('high');
    expect(result!.mpn).toBe('HIGH');
  });

  it('prefers result with more populated fields at same confidence', () => {
    const lowMpnOnly: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: 'ABC', quantity: null, distributor: 'unknown', raw: 'x', confidence: 'low' }),
    };
    const lowBothFields: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: 'XYZ', quantity: 10, distributor: 'unknown', raw: 'y', confidence: 'low' }),
    };
    const raw: RawBarcode = { text: 'test', format: 'CODE_128' };
    const result = tryAllParsers(raw, [lowMpnOnly, lowBothFields]);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('XYZ');
    expect(result!.quantity).toBe(10);
  });

  it('prefers medium over low confidence', () => {
    const lowParser: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: 'LOW', quantity: null, distributor: 'unknown', raw: 'l', confidence: 'low' }),
    };
    const mediumParser: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: 'MED', quantity: null, distributor: 'unknown', raw: 'm', confidence: 'medium' }),
    };
    const raw: RawBarcode = { text: 'test', format: 'CODE_128' };
    const result = tryAllParsers(raw, [lowParser, mediumParser]);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('medium');
  });

  it('handles opposite field coverage for score calculation', () => {
    const mpnOnly: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: 'A', quantity: null, distributor: 'unknown', raw: 'x', confidence: 'low' }),
    };
    const qtyOnly: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: null, quantity: 10, distributor: 'unknown', raw: 'y', confidence: 'low' }),
    };
    const raw: RawBarcode = { text: 'test', format: 'CODE_128' };
    const result = tryAllParsers(raw, [mpnOnly, qtyOnly]);
    expect(result).not.toBeNull();
    // When scores tie, best keeps first
    expect(result!.mpn).toBe('A');
  });

  it('covers best.mpn falsy branch in score comparison', () => {
    const qtyFirst: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: null, quantity: 5, distributor: 'unknown', raw: 'x', confidence: 'low' }),
    };
    const qtySecond: BarcodeParser = {
      distributor: 'unknown',
      canParse: () => true,
      parse: () => ({ mpn: null, quantity: 10, distributor: 'unknown', raw: 'y', confidence: 'low' }),
    };
    const raw: RawBarcode = { text: 'test', format: 'CODE_128' };
    const result = tryAllParsers(raw, [qtyFirst, qtySecond]);
    expect(result).not.toBeNull();
    // Scores tie (both have only qty), so best stays first
    expect(result!.quantity).toBe(5);
  });
});
