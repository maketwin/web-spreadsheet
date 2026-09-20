import { describe, expect, it } from 'vitest';
import { hashFillText, usesHashOverflow } from '../../src/renderer/narrowOverflow';

describe('usesHashOverflow', () => {
  it('hashes finite numbers', () => {
    expect(usesHashOverflow(42, false, undefined, undefined)).toBe(true);
  });

  it('does not hash text or formula view', () => {
    expect(usesHashOverflow('hi', false, undefined, undefined)).toBe(false);
    expect(usesHashOverflow(42, true, '=A1', undefined)).toBe(false);
  });

  it('hashes date-like number formats even for string serials', () => {
    expect(usesHashOverflow('x', false, undefined, 'yyyy-mm-dd')).toBe(true);
  });
});

describe('hashFillText', () => {
  it('fills the available width with hashes', () => {
    expect(hashFillText((s) => s.length * 8, 40)).toBe('#####');
    expect(hashFillText((s) => s.length * 8, 7)).toBe('#');
  });
});
