import { describe, expect, it } from 'vitest';
import { selectionFillBands } from '../../src/renderer/selectionFill';

describe('selectionFillBands', () => {
  it('fills the whole segment when there is no hole', () => {
    expect(selectionFillBands({ x: 0, y: 0, w: 100, h: 40 }, null)).toEqual([
      { x: 0, y: 0, w: 100, h: 40 },
    ]);
  });

  it('punches a single-cell hole with four side bands', () => {
    const bands = selectionFillBands(
      { x: 0, y: 0, w: 200, h: 60 },
      { x: 64, y: 20, w: 64, h: 20 },
    );
    expect(bands).toEqual([
      { x: 0, y: 0, w: 200, h: 20 },
      { x: 0, y: 40, w: 200, h: 20 },
      { x: 0, y: 20, w: 64, h: 20 },
      { x: 128, y: 20, w: 72, h: 20 },
    ]);
  });

  it('leaves no fill when the hole covers the whole segment (merged active area)', () => {
    const seg = { x: 40, y: 20, w: 128, h: 40 };
    expect(selectionFillBands(seg, seg)).toEqual([]);
  });

  it('clips a merge-sized hole to the current freeze segment', () => {
    // Segment is only the right half of a 2×1 merge hole.
    const bands = selectionFillBands(
      { x: 104, y: 20, w: 64, h: 20 },
      { x: 40, y: 20, w: 128, h: 20 },
    );
    expect(bands).toEqual([]);
  });
});
