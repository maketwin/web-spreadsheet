import { describe, expect, it } from 'vitest';
import { alpha2num, expr2xy, num2alpha, xy2expr } from '../../src/util/alphabet';

describe('alphabet', () => {
  it('num2alpha', () => {
    expect(num2alpha(0)).toBe('A');
    expect(num2alpha(25)).toBe('Z');
    expect(num2alpha(26)).toBe('AA');
    expect(num2alpha(701)).toBe('ZZ');
  });

  it('alpha2num', () => {
    expect(alpha2num('A')).toBe(0);
    expect(alpha2num('Z')).toBe(25);
    expect(alpha2num('AA')).toBe(26);
  });

  it('round trip 0-999', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(alpha2num(num2alpha(i))).toBe(i);
    }
  });

  it('expr2xy + xy2expr', () => {
    expect(expr2xy('A1')).toEqual({ x: 0, y: 0 });
    expect(xy2expr(0, 0)).toBe('A1');
    expect(expr2xy('Z100')).toEqual({ x: 25, y: 99 });
  });
});
