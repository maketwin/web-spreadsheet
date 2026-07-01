import { describe, expect, it } from 'vitest';
import { Range } from '../../src/selection/Range';

describe('Range', () => {
  it('normalizes inverted coordinates', () => {
    expect(Range.normalize({ r1: 3, c1: 4, r2: 1, c2: 2 })).toEqual({ r1: 1, c1: 2, r2: 3, c2: 4 });
  });

  it('checks whether a cell is inside', () => {
    const range = new Range({ r1: 1, c1: 1, r2: 3, c2: 3 });

    expect(range.contains(2, 2)).toBe(true);
    expect(range.contains(4, 2)).toBe(false);
  });

  it('expands from the normalized anchor', () => {
    const range = Range.single(2, 2).expand(4, 5);

    expect(range.toAddress()).toEqual({ r1: 2, c1: 2, r2: 4, c2: 5 });
  });
});
