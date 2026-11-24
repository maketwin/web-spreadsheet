import { describe, expect, it } from 'vitest';
import { nextSeriesValues } from '../../src/fill/series';

/**
 * Excel keeps the zero padding of pure-number sources when continuing the
 * series ("001","002" → "003","004","005"), overflowing the width naturally
 * ("009" → "010", "999" → "1000").
 */
describe('numeric series keeps zero padding (Excel)', () => {
  it('continues padded two-digit sources', () => {
    expect(nextSeriesValues(['001', '002'], 3)).toEqual(['003', '004', '005']);
  });

  it('carries over the padding width (…009 → 010)', () => {
    expect(nextSeriesValues(['008', '009'], 2)).toEqual(['010', '011']);
  });

  it('overflows the width naturally (999 → 1000)', () => {
    expect(nextSeriesValues(['998', '999'], 2)).toEqual(['1000', '1001']);
  });

  it('single padded number steps padded with Ctrl-drag', () => {
    expect(nextSeriesValues(['001'], 3, { singleNumberStep: true })).toEqual(['002', '003', '004']);
  });

  it('continues backwards across zero (000, -001)', () => {
    expect(nextSeriesValues(['001', '002'], 2, { direction: -1 })).toEqual(['000', '-001']);
  });

  it('text+number padding is unchanged (regression guard)', () => {
    expect(nextSeriesValues(['Item001', 'Item002'], 1)).toEqual(['Item003']);
    expect(nextSeriesValues(['A01'], 2)).toEqual(['A02', 'A03']);
    expect(nextSeriesValues(['A09'], 1)).toEqual(['A10']);
  });

  it('unpadded numbers stay unpadded (regression guard)', () => {
    expect(nextSeriesValues(['1', '3'], 2)).toEqual(['5', '7']);
    expect(nextSeriesValues(['5'], 2, { singleNumberStep: true })).toEqual(['6', '7']);
  });
});
