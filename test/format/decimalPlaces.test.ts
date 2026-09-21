import { describe, expect, it } from 'vitest';
import { adjustDecimalPlaces } from '../../src/format/decimalPlaces';
import { formatValue } from '../../src/format/NumberFormatter';

describe('adjustDecimalPlaces', () => {
  it('general: increase → 0.0, decrease → no-op', () => {
    expect(adjustDecimalPlaces(undefined, 1)).toBe('0.0');
    expect(adjustDecimalPlaces('general', 1)).toBe('0.0');
    expect(adjustDecimalPlaces(undefined, -1)).toBeNull();
    expect(adjustDecimalPlaces('general', -1)).toBeNull();
  });

  it('built-in number/percent map to custom then adjust', () => {
    expect(adjustDecimalPlaces('number', 1)).toBe('#,##0.000');
    expect(adjustDecimalPlaces('number', -1)).toBe('#,##0.0');
    expect(adjustDecimalPlaces('percent', 1)).toBe('0.000%');
    expect(adjustDecimalPlaces('percent', -1)).toBe('0.0%');
  });

  it('custom formats add/remove one 0, dropping the dot at zero decimals', () => {
    expect(adjustDecimalPlaces('0.00', 1)).toBe('0.000');
    expect(adjustDecimalPlaces('0.00', -1)).toBe('0.0');
    expect(adjustDecimalPlaces('0.0', -1)).toBe('0');
    expect(adjustDecimalPlaces('0', -1)).toBeNull();
    expect(adjustDecimalPlaces('0', 1)).toBe('0.0');
    expect(adjustDecimalPlaces('#,##0', 1)).toBe('#,##0.0');
  });

  it('keeps the % suffix position when inserting', () => {
    expect(adjustDecimalPlaces('0%', 1)).toBe('0.0%');
    expect(adjustDecimalPlaces('0.00%', -1)).toBe('0.0%');
  });

  it('unsupported built-ins are no-ops', () => {
    expect(adjustDecimalPlaces('currency', 1)).toBeNull();
    expect(adjustDecimalPlaces('date', -1)).toBeNull();
  });

  it('adjusted formats render as expected', () => {
    const fmt = adjustDecimalPlaces('number', 1)!;
    expect(formatValue(3.14159, fmt).text).toBe('3.142');
    const p = adjustDecimalPlaces('percent', -1)!;
    expect(formatValue(0.125, p).text).toBe('12.5%');
  });
});
