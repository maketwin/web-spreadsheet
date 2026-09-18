import { describe, expect, it } from 'vitest';
import { parseInternalRangeKey, sparklineValues } from '../../src/sparkline/values';
import { Store } from '../../src/store/Store';

describe('parseInternalRangeKey', () => {
  it('parses "r,c:r,c" keys', () => {
    expect(parseInternalRangeKey('1,0:3,2')).toEqual({ r1: 1, c1: 0, r2: 3, c2: 2 });
  });

  it('treats a single endpoint as a one-cell range', () => {
    expect(parseInternalRangeKey('2,4')).toEqual({ r1: 2, c1: 4, r2: 2, c2: 4 });
  });

  it('normalizes reversed endpoints', () => {
    expect(parseInternalRangeKey('3,2:1,0')).toEqual({ r1: 1, c1: 0, r2: 3, c2: 2 });
  });
});

describe('sparklineValues', () => {
  it('collects numeric cell values and numeric text, skipping blanks and text', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(0, 1, { text: '20', value: '20' });
    store.setCell(0, 2, { text: 'n/a', value: 'n/a' });
    // (0,3) stays empty

    expect(sparklineValues(store, '0,0:0,3')).toEqual([10, 20]);
  });

  it('reads a rectangular range row-major', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1', value: 1 });
    store.setCell(0, 1, { text: '2', value: 2 });
    store.setCell(1, 0, { text: '3', value: 3 });
    store.setCell(1, 1, { text: '4', value: 4 });

    expect(sparklineValues(store, '0,0:1,1')).toEqual([1, 2, 3, 4]);
  });

  it('returns empty for an empty range', () => {
    expect(sparklineValues(new Store(), '5,5:6,6')).toEqual([]);
  });
});
