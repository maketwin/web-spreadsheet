import { describe, expect, it } from 'vitest';
import { roundHalfAwayFromZero } from '../../src/util/roundHalfAwayFromZero';

describe('roundHalfAwayFromZero', () => {
  it('rounds the decimal value, not the binary double', () => {
    expect(roundHalfAwayFromZero(1.005, 2)).toBe(1.01);
    expect(roundHalfAwayFromZero(2.675, 2)).toBe(2.68);
    expect(roundHalfAwayFromZero(1.255, 2)).toBe(1.26);
    expect(roundHalfAwayFromZero(10.075, 2)).toBe(10.08);
    expect(roundHalfAwayFromZero(1.345, 2)).toBe(1.35);
  });

  it('mirrors the sign: negatives round away from zero', () => {
    expect(roundHalfAwayFromZero(-1.005, 2)).toBe(-1.01);
    expect(roundHalfAwayFromZero(-2.675, 2)).toBe(-2.68);
    expect(roundHalfAwayFromZero(-0.001, 2)).toBe(-0);
  });

  it('half away from zero at zero decimals', () => {
    expect(roundHalfAwayFromZero(0.5, 0)).toBe(1);
    expect(roundHalfAwayFromZero(2.5, 0)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5, 0)).toBe(-3);
    expect(roundHalfAwayFromZero(1.5, 0)).toBe(2);
    expect(roundHalfAwayFromZero(-1.5, 0)).toBe(-2);
  });

  it('carries across digit boundaries', () => {
    expect(roundHalfAwayFromZero(9.999, 2)).toBe(10);
    expect(roundHalfAwayFromZero(0.999, 2)).toBe(1);
    expect(roundHalfAwayFromZero(-9.999, 2)).toBe(-10);
  });

  it('supports more decimals than the input has', () => {
    expect(roundHalfAwayFromZero(0.125025, 4)).toBe(0.125);
    expect(roundHalfAwayFromZero(0.00015, 4)).toBe(0.0002);
    expect(roundHalfAwayFromZero(1.005, 1)).toBe(1);
    expect(roundHalfAwayFromZero(2.675, 1)).toBe(2.7);
  });

  it('handles exponential notation input', () => {
    expect(roundHalfAwayFromZero(1e-7, 2)).toBe(0);
    expect(roundHalfAwayFromZero(1.2345678901234568e-7, 8)).toBe(0.00000012);
    expect(roundHalfAwayFromZero(2.5e-8, 8)).toBe(0.00000003);
  });

  it('handles very large magnitudes without NaN', () => {
    expect(roundHalfAwayFromZero(1e21, 2)).toBe(1e21);
    expect(roundHalfAwayFromZero(123456789012345680000, 2)).toBe(123456789012345680000);
    expect(roundHalfAwayFromZero(1e300, 2)).toBe(1e300);
  });

  it('negative decimals round to tens/hundreds', () => {
    expect(roundHalfAwayFromZero(12345, -2)).toBe(12300);
    expect(roundHalfAwayFromZero(12350, -2)).toBe(12400);
    expect(roundHalfAwayFromZero(-12350, -2)).toBe(-12400);
  });

  it('non-finite inputs pass through unchanged (no NaN fabrication)', () => {
    expect(roundHalfAwayFromZero(Number.NaN, 2)).toBeNaN();
    expect(roundHalfAwayFromZero(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
    expect(roundHalfAwayFromZero(Number.NEGATIVE_INFINITY, 2)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('absurd precision requests fall back to the input instead of NaN', () => {
    expect(roundHalfAwayFromZero(1.5, 4000)).toBe(1.5);
  });
});
