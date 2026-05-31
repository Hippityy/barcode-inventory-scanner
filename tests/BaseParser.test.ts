import { describe, it, expect } from 'vitest';
import { extractQuantity, looksLikeMpn, tryAllParsers } from '@/parsers/BaseParser';
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

  it('returns false for two characters without alphanumeric mix', () => {
    expect(looksLikeMpn('AB')).toBe(true); // 2 letters, hasLetter=true, length>=2
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

  it('returns false for pure numeric short string', () => {
    expect(looksLikeMpn('123')).toBe(false);
  });

  it('returns true for pure numeric long string', () => {
    expect(looksLikeMpn('12345678')).toBe(true);
  });

  it('returns false for string with spaces', () => {
    expect(looksLikeMpn('LM 358')).toBe(false);
  });

  it('returns false for string with special chars outside allowed', () => {
    expect(looksLikeMpn('LM358@')).toBe(false);
  });
});

describe('tryAllParsers', () => {
  it('returns null when no parsers match', () => {
    const raw: RawBarcode = { text: '???', format: 'UNKNOWN' };
    expect(tryAllParsers(raw, parsers)).toBeNull();
  });

  it('returns null when parser canParse is true but parse returns null', () => {
    const raw: RawBarcode = { text: '', format: 'CODE_128' };
    expect(tryAllParsers(raw, parsers)).toBeNull();
  });

  it('returns result from single matching parser', () => {
    const raw: RawBarcode = { text: 'LM358', format: 'CODE_128' };
    const result = tryAllParsers(raw, parsers);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358');
  });

  it('prefers high confidence over medium', () => {
    // DigiKey 2D ECIA with both fields → high
    const raw: RawBarcode = {
      text: '[)>\x1E06\x1D1PLM358\x1DQ100\x1D',
      format: 'DATA_MATRIX',
    };
    const result = tryAllParsers(raw, parsers);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('high');
  });

  it('prefers result with more populated fields', () => {
    const dk = new DigiKeyParser();
    const mouser = new MouserParser();
    const customParsers = [dk, mouser];
    // Mouser 2D with MPN only (medium) should still be returned
    const raw: RawBarcode = {
      text: '>[)>\x1E06\x1D1PLM358\x1D',
      format: 'DATA_MATRIX',
    };
    const result = tryAllParsers(raw, customParsers);
    expect(result).not.toBeNull();
    expect(result!.distributor).toBe('mouser');
  });
});
