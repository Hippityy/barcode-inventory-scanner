import { describe, it, expect } from 'vitest';
import { Element14Parser } from '@/parsers/Element14Parser';
import type { RawBarcode } from '@/types/index';

const parser = new Element14Parser();

describe('Element14Parser.canParse', () => {
  it('returns true for 7-digit numeric CODE_128', () => {
    const raw: RawBarcode = { text: '2361234', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for 6-digit numeric CODE_39', () => {
    const raw: RawBarcode = { text: '123456', format: 'CODE_39' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for 8-digit numeric DATA_MATRIX', () => {
    const raw: RawBarcode = { text: '12345678', format: 'DATA_MATRIX' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for alphanumeric MPN-like CODE_128', () => {
    const raw: RawBarcode = { text: 'LM358N', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for numeric string with 9 digits (possible MPN)', () => {
    const raw: RawBarcode = { text: '123456789', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns true for CODE_128 with 1P prefix', () => {
    const raw: RawBarcode = { text: '1PMAX123', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(true);
  });

  it('returns false for empty barcode', () => {
    const raw: RawBarcode = { text: '', format: 'CODE_128' };
    expect(parser.canParse(raw)).toBe(false);
  });

  it('returns false for UNKNOWN format', () => {
    const raw: RawBarcode = { text: '2361234', format: 'UNKNOWN' };
    expect(parser.canParse(raw)).toBe(false);
  });
});

describe('Element14Parser.parse', () => {
  it('parses 7-digit order code', () => {
    const raw: RawBarcode = { text: '2361234', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBeNull();
    expect(result!.quantity).toBeNull();
    expect(result!.distributor).toBe('element14');
    expect(result!.confidence).toBe('low');
  });

  it('parses short numeric as quantity', () => {
    const raw: RawBarcode = { text: '100', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBeNull();
    expect(result!.quantity).toBe(100);
    expect(result!.confidence).toBe('low');
  });

  it('parses alphanumeric as MPN', () => {
    const raw: RawBarcode = { text: 'LM358N', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('LM358N');
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('medium');
  });

  it('parses 9-digit numeric as possible MPN', () => {
    const raw: RawBarcode = { text: '123456789', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('123456789');
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('low');
  });

  it('parses 1P prefixed barcode as MPN', () => {
    const raw: RawBarcode = { text: '1PMAX123', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('MAX123');
    expect(result!.confidence).toBe('medium');
  });

  it('parses 11-digit numeric as possible MPN (Würth-like)', () => {
    const raw: RawBarcode = { text: '61300511121', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).not.toBeNull();
    expect(result!.mpn).toBe('61300511121');
    expect(result!.quantity).toBeNull();
    expect(result!.confidence).toBe('low');
  });

  it('returns null for non-matching barcode', () => {
    const raw: RawBarcode = { text: '???', format: 'CODE_128' };
    const result = parser.parse(raw);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const raw: RawBarcode = { text: '', format: 'CODE_128' };
    expect(parser.parse(raw)).toBeNull();
  });
});
