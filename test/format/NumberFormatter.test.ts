import { describe, expect, it } from 'vitest';
import { formatValue } from '../../src/format/NumberFormatter';

describe('NumberFormatter', () => {
  it('formats currency values', () => {
    const result = formatValue(1234.5, 'currency');
    expect(result.formatted).toBe(true);
    expect(result.text).toContain('1,234.50');
    expect(result.text).toMatch(/¥|CNY/);
  });

  it('formats percent values', () => {
    const result = formatValue(0.75, 'percent');
    expect(result.formatted).toBe(true);
    expect(result.text).toBe('75.00%');
  });

  it('formats date values (serial number)', () => {
    // Excel serial 1 = 1900-01-01
    const result = formatValue(1, 'date');
    expect(result.formatted).toBe(true);
    expect(result.text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats time values (fractional day)', () => {
    const result = formatValue(0.5, 'time');
    expect(result.formatted).toBe(true);
    expect(result.text).toBe('12:00:00');
  });

  it('formats scientific notation', () => {
    const result = formatValue(12345, 'scientific');
    expect(result.formatted).toBe(true);
    expect(result.text).toMatch(/1\.23e\+4/i);
  });

  it('returns raw text for general format', () => {
    const result = formatValue(42, 'general');
    expect(result.formatted).toBe(false);
    expect(result.text).toBe('42');
  });

  it('returns raw text for non-number values', () => {
    const result = formatValue('hello', 'number');
    expect(result.formatted).toBe(false);
    expect(result.text).toBe('hello');
  });

  it('returns empty string for null', () => {
    const result = formatValue(null, 'number');
    expect(result.text).toBe('');
  });
});
