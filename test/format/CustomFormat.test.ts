import { describe, expect, it } from 'vitest';
import { formatCustom } from '../../src/format/CustomFormat';
import { formatValue } from '../../src/format/NumberFormatter';

describe('formatCustom (T3.3)', () => {
  describe('numeric placeholders', () => {
    it('#,##0.00 groups thousands with two decimals', () => {
      expect(formatCustom(1234567.891, '#,##0.00')).toBe('1,234,567.89');
    });
    it('#,##0.00 rounds', () => {
      expect(formatCustom(1.007, '#,##0.00')).toBe('1.01');
    });
    it('0 pads integer digits', () => {
      expect(formatCustom(5, '000')).toBe('005');
    });
    it('# drops empty digits', () => {
      expect(formatCustom(0.5, '#.##')).toBe('0.5');
    });
    it('0.0% multiplies by 100', () => {
      expect(formatCustom(0.1234, '0.0%')).toBe('12.3%');
    });
    it('0.00E+00 scientific', () => {
      expect(formatCustom(12345, '0.00E+00')).toBe('1.23E+04');
    });
  });

  describe('sections', () => {
    it('positive;negative uses absolute value in second section', () => {
      expect(formatCustom(-42, '0;[\\-]0'.replace('[\\-]', '-'))).toBe('-42');
    });
    it('negative section can add parentheses', () => {
      expect(formatCustom(-42, '0;(0)')).toBe('(42)');
    });
    it('zero section', () => {
      expect(formatCustom(0, '0;-0;"zero"')).toBe('zero');
    });
    it('text section with @', () => {
      expect(formatCustom('hello', '0;-0;"zero";"="@')).toBe('=hello');
    });
    it('text without text section passes through', () => {
      expect(formatCustom('abc', '#,##0.00')).toBe('abc');
    });
  });

  describe('literals', () => {
    it('quoted literal', () => {
      expect(formatCustom(5, '0" kg"')).toBe('5 kg');
    });
    it('escaped char', () => {
      expect(formatCustom(5, '0\\%')).toBe('5%');
    });
  });

  describe('dates (Excel serial)', () => {
    // serial for 2026-09-11 = days since 1899-12-30
    const serial = Math.round((Date.UTC(2026, 8, 11) - Date.UTC(1899, 11, 30)) / 86400000);
    it('yyyy-mm-dd', () => {
      expect(formatCustom(serial, 'yyyy-mm-dd')).toBe('2026-09-11');
    });
    it('yy/mmm/dd mixed literals', () => {
      expect(formatCustom(serial, 'dd-mmm-yy')).toBe('11-Sep-26');
    });
    it('mmmm full month name', () => {
      expect(formatCustom(serial, 'mmmm')).toBe('September');
    });
    it('hh:mm:ss with minutes disambiguation', () => {
      const noon = serial + 0.5;
      expect(formatCustom(noon, 'hh:mm:ss')).toBe('12:00:00');
    });
    it('h AM/PM via hh AM/PM', () => {
      const evening = serial + 0.75;
      expect(formatCustom(evening, 'hh AM/PM')).toBe('06 PM');
    });
  });

  describe('unsupported input', () => {
    it('pure literal format returns undefined', () => {
      expect(formatCustom(1, 'hello')).toBeUndefined();
    });
  });
});

describe('formatValue custom integration', () => {
  it('routes unknown strings through the custom formatter', () => {
    expect(formatValue(1234.5, '#,##0.00')).toEqual({ text: '1,234.50', formatted: true });
  });
  it('keeps built-in enums on the fast path', () => {
    expect(formatValue(0.5, 'percent')).toEqual({ text: '50.00%', formatted: true });
  });
  it('unusable custom strings fall back to raw text', () => {
    expect(formatValue(5, ';;;')).toEqual({ text: '5', formatted: false });
  });
});
