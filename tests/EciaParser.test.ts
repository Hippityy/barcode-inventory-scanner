import { describe, it, expect } from 'vitest';
import { isEciaFormat, parseEciaFields } from '@/parsers/EciaParser';

describe('isEciaFormat', () => {
  it('returns false for string shorter than 6 chars', () => {
    expect(isEciaFormat('12345')).toBe(false);
  });

  it('returns false when no ECIA header present', () => {
    expect(isEciaFormat('some random text\x1D')).toBe(false);
  });

  it('returns false when header present but no GS', () => {
    expect(isEciaFormat('[)>\x1E06')).toBe(false);
  });

  it('returns true for DigiKey-style header with GS', () => {
    expect(isEciaFormat('[)>\x1E06\x1D')).toBe(true);
  });

  it('returns true for Mouser-style header with GS', () => {
    expect(isEciaFormat('>[)>\x1E06\x1D')).toBe(true);
  });
});

describe('parseEciaFields', () => {
  it('returns empty map for empty string', () => {
    const fields = parseEciaFields('');
    expect(fields.size).toBe(0);
  });

  it('parses DigiKey-style 2D barcode with MPN and quantity', () => {
    const text = '[)>\x1E06\x1D1PLM358\x1DQ100\x1D';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('LM358');
    expect(fields.get('Q')).toBe('100');
  });

  it('parses Mouser-style 2D barcode with MPN and quantity', () => {
    const text = '>[)>\x1E06\x1D1PMAX232N\x1DQ50\x1D4K1\x1D';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('MAX232N');
    expect(fields.get('Q')).toBe('50');
    expect(fields.get('4K')).toBe('1');
  });

  it('strips trailing plain EOT', () => {
    const text = '[)>\x1E06\x1D1PABC\x1DQ10\x1D\x04';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('ABC');
    expect(fields.get('Q')).toBe('10');
  });

  it('strips trailing RS+EOT', () => {
    const text = '[)>\x1E06\x1D1PABC\x1DQ10\x1D\x1E\x04';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('ABC');
    expect(fields.get('Q')).toBe('10');
  });

  it('handles missing header gracefully', () => {
    const text = '1PABC\x1DQ10\x1D';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('ABC');
    expect(fields.get('Q')).toBe('10');
  });

  it('ignores empty segments', () => {
    const text = '[)>\x1E06\x1D\x1D1PABC\x1D\x1D';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('ABC');
  });

  it('handles 3-char DI 11K', () => {
    const text = '[)>\x1E06\x1D11K12345\x1D1PABC\x1D';
    const fields = parseEciaFields(text);
    expect(fields.get('11K')).toBe('12345');
    expect(fields.get('1P')).toBe('ABC');
  });

  it('handles 2-char DI 4L', () => {
    const text = '[)>\x1E06\x1D4LCN\x1D1PABC\x1D';
    const fields = parseEciaFields(text);
    expect(fields.get('4L')).toBe('CN');
    expect(fields.get('1P')).toBe('ABC');
  });

  it('parses Mouser-style header', () => {
    const text = '>[)>\x1E06\x1D1PMAX232N\x1DQ50\x1D';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('MAX232N');
    expect(fields.get('Q')).toBe('50');
  });

  it('handles header without RS character', () => {
    const text = '[)>06\x1D1PABC\x1DQ10\x1D';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('ABC');
    expect(fields.get('Q')).toBe('10');
  });

  it('strips trailing RS+EOT', () => {
    const text = '[)>\x1E06\x1D1PABC\x1DQ10\x1D\x1E\x04';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('ABC');
    expect(fields.get('Q')).toBe('10');
  });

  it('ignores segments without known DI', () => {
    const text = '[)>\x1E06\x1D1PABC\x1DUNKNOWN\x1DQ10\x1D';
    const fields = parseEciaFields(text);
    expect(fields.get('1P')).toBe('ABC');
    expect(fields.get('Q')).toBe('10');
    expect(fields.has('UNKNOWN')).toBe(false);
  });
});