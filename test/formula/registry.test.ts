import { describe, expect, it } from 'vitest';
import { registry } from '../../src/formula/registry';

describe('formula registry', () => {
  it('registers at least 30 functions', () => {
    expect(registry.list()).toHaveLength(32);
  });

  it('evaluates SUM', () => {
    expect(registry.get('SUM')?.evaluate([1, 2, 3])).toBe(6);
  });

  it('evaluates AVERAGE', () => {
    expect(registry.get('AVERAGE')?.evaluate([1, 2, 3])).toBe(2);
  });

  it('evaluates IF', () => {
    expect(registry.get('IF')?.evaluate([false, 'yes', 'no'])).toBe('no');
  });

  it('evaluates CONCAT', () => {
    expect(registry.get('CONCAT')?.evaluate(['web', '-', 'spreadsheet'])).toBe('web-spreadsheet');
  });

  it('evaluates LEN', () => {
    expect(registry.get('LEN')?.evaluate(['formula'])).toBe(7);
  });

  it('evaluates UPPER', () => {
    expect(registry.get('UPPER')?.evaluate(['formula'])).toBe('FORMULA');
  });

  it('evaluates LOWER', () => {
    expect(registry.get('LOWER')?.evaluate(['Formula'])).toBe('formula');
  });
});
