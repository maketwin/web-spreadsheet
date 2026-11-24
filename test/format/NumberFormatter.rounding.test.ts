import { describe, expect, it } from 'vitest';
import { formatValue } from '../../src/format/NumberFormatter';
import { formatCustom } from '../../src/format/CustomFormat';

/**
 * Excel rounds the *decimal* value half away from zero. The binary double for
 * 1.005 is 1.00499999999999989…, so naive toFixed/float paths print 1.00
 * where Excel prints 1.01.
 */
describe('Excel decimal rounding in number formats', () => {
  describe('custom 0.00 (two decimals)', () => {
    it.each([
      [1.005, '1.01'],
      [2.675, '2.68'],
      [1.255, '1.26'],
      [10.075, '10.08'],
      [1.345, '1.35'],
      [-1.005, '-1.01'],
    ])('formatValue %d → %s', (value, expected) => {
      expect(formatValue(value, '0.00').text).toBe(expected);
    });

    it.each([
      [1.005, '1.01'],
      [2.675, '2.68'],
      [-1.005, '-1.01'],
    ])('formatCustom %d → %s', (value, expected) => {
      expect(formatCustom(value, '0.00')?.text).toBe(expected);
    });
  });

  describe('custom #,##0 (integers, half away from zero)', () => {
    it.each([
      [0.5, '1'],
      [2.5, '3'],
      [-2.5, '-3'],
      [1.5, '2'],
    ])('formatValue %d → %s', (value, expected) => {
      expect(formatValue(value, '#,##0').text).toBe(expected);
    });
  });

  describe('percent multiplies by 100 first (decimal), then rounds', () => {
    it('formatValue percent 0.125025 → 12.50%', () => {
      expect(formatValue(0.125025, 'percent').text).toBe('12.50%');
    });
    it('formatCustom 0.00% 0.125025 → 12.50%', () => {
      expect(formatCustom(0.125025, '0.00%')?.text).toBe('12.50%');
    });
    it('custom 0.00% rounds the decimal product (0.06125 → 6.13%)', () => {
      expect(formatCustom(0.06125, '0.00%')?.text).toBe('6.13%');
    });
    it('built-in percent keeps two decimals for 0.75 → 75.00%', () => {
      expect(formatValue(0.75, 'percent').text).toBe('75.00%');
    });
  });

  describe('built-in number / currency go through the same rounding', () => {
    it('number 1.005 → 1.01', () => {
      expect(formatValue(1.005, 'number').text).toBe('1.01');
    });
    it('number 10.075 → 10.08', () => {
      expect(formatValue(10.075, 'number').text).toBe('10.08');
    });
    it('currency 1.005 keeps Excel rounding', () => {
      expect(formatValue(1.005, 'currency').text).toContain('1.01');
    });
  });

  describe('tiny negatives keep the sign when rounding lands on zero (Excel)', () => {
    it('custom 0.00: -0.001 → -0.00', () => {
      expect(formatCustom(-0.001, '0.00')?.text).toBe('-0.00');
      expect(formatValue(-0.001, '0.00').text).toBe('-0.00');
    });
    it('custom 0.00%: -0.00001 → -0.00%', () => {
      expect(formatCustom(-0.00001, '0.00%')?.text).toBe('-0.00%');
    });
    it('built-in percent: -0.00001 → -0.00%', () => {
      expect(formatValue(-0.00001, 'percent').text).toBe('-0.00%');
    });
    it('built-in number: -0.001 → -0.00', () => {
      expect(formatValue(-0.001, 'number').text).toBe('-0.00');
    });
  });

  describe('exponential notation and huge magnitudes never yield NaN', () => {
    it('tiny value rounds to zero', () => {
      expect(formatValue(1e-7, '0.00').text).toBe('0.00');
      expect(formatValue(1e-7, 'number').text).toBe('0.00');
    });
    it('large values format without NaN', () => {
      expect(formatValue(1e21, '0.00').text).not.toContain('NaN');
      expect(formatCustom(1e21, '#,##0')?.text).not.toContain('NaN');
      expect(formatValue(123456789012345680000, 'number').text).not.toContain('NaN');
    });
  });

  describe('padding past the shortest decimal form pads zeros, not binary noise', () => {
    it.each([
      [1234567.891, '0.0000000000', '1234567.8910000000'],
      [0.1, '0.00000000000000000000', '0.10000000000000000000'],
      [0.5, '0.00', '0.50'],
      [-0.001, '0.00', '-0.00'],
      [1234.5, '#,##0.00', '1,234.50'],
      [-1234.567, '#,##0.00', '-1,234.57'],
      [1.005, '0.00', '1.01'],
      [2.675, '0.00', '2.68'],
      [0.045, '0.00', '0.05'],
      [12, '000', '012'],
    ])('formatCustom %d %p → %p', (value, fmt, expected) => {
      expect(formatCustom(value, fmt)?.text).toBe(expected);
    });

    it('values with an exponential shortest form (≥1e21) keep the toFixed path', () => {
      expect(formatCustom(1e21, '0.00')?.text).toBe((1e21).toFixed(2));
      expect(formatCustom(2e21, '0.000')?.text).toBe((2e21).toFixed(3));
    });
  });

  describe('scientific mantissa rounds the decimal value half away from zero', () => {
    it.each([
      [1.005, '0.00E+00', '1.01E+00'],
      [-1.005, '0.00E+00', '-1.01E+00'],
      [9.995, '0.00E+00', '1.00E+01'],
      [-9.995, '0.00E+00', '-1.00E+01'],
      // Not at a rounding boundary: existing outputs stay.
      [12345.6789, '0.00E+00', '1.23E+04'],
      [7.654, '0.00E+00', '7.65E+00'],
      // Tiny magnitudes: mantissa rounding must not collapse them to zero.
      [1e-7, '0.00E+00', '1.00E-07'],
    ])('formatCustom %d %p → %p', (value, fmt, expected) => {
      expect(formatCustom(value, fmt)?.text).toBe(expected);
    });

    it('built-in scientific rounds the same way and keeps its lowercase exponent', () => {
      expect(formatValue(1.005, 'scientific').text).toBe('1.01e+0');
      expect(formatValue(9.995, 'scientific').text).toBe('1.00e+1');
      expect(formatValue(12345.6789, 'scientific').text).toBe('1.23e+4');
      expect(formatValue(1e-7, 'scientific').text).toBe('1.00e-7');
    });
  });

  describe('non-finite numbers never throw (a cell holding one must not abort the paint)', () => {
    it('custom scientific 0.00E+00 substitutes the plain string for NaN / ±Infinity', () => {
      expect(formatValue(NaN, '0.00E+00').text).toBe('NaN');
      expect(formatValue(Infinity, '0.00E+00').text).toBe('Infinity');
      expect(formatValue(-Infinity, '0.00E+00').text).toBe('-Infinity');
    });

    it('built-in scientific formats non-finite values without throwing', () => {
      expect(formatValue(NaN, 'scientific').text).toBe('NaN');
      expect(formatValue(Infinity, 'scientific').text).toBe('Infinity');
      expect(formatValue(-Infinity, 'scientific').text).toBe('-Infinity');
    });

    it('plain number sections substitute the plain string too', () => {
      expect(formatValue(NaN, '0.00').text).toBe('NaN');
      expect(formatValue(Infinity, '#,##0').text).toBe('Infinity');
    });
  });

  describe('zero-padded integers keep the sign in front (Excel)', () => {
    it('custom 000: -5 → -005 (sign before the padding)', () => {
      expect(formatCustom(-5, '000')?.text).toBe('-005');
      expect(formatValue(-5, '000').text).toBe('-005');
    });
    it('custom 0000: -12 → -0012', () => {
      expect(formatCustom(-12, '0000')?.text).toBe('-0012');
      expect(formatValue(-12, '0000').text).toBe('-0012');
    });
    it('existing sign/padding behaviour stays', () => {
      expect(formatValue(-5, '0.00').text).toBe('-5.00');
      expect(formatValue(5, '000').text).toBe('005');
      expect(formatValue(-1234.5, '#,##0.00').text).toBe('-1,234.50');
      expect(formatCustom(5, '000')?.text).toBe('005');
    });
  });
});
