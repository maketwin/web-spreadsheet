import { describe, expect, it } from 'vitest';
import { cellSelection, columnSelection, extendSelection, rangeSelection, rowSelection, selectionLabel, sheetSelection } from '../../src/selection/Selection';

describe('Selection', () => {
  it('labels cells, ranges, rows, and columns', () => {
    expect(selectionLabel(cellSelection(0, 0))).toBe('A1');
    expect(selectionLabel(rangeSelection({ r1: 0, c1: 0, r2: 2, c2: 3 }))).toBe('A1:D3');
    expect(selectionLabel(columnSelection(1, 1000))).toBe('B:B');
    expect(selectionLabel(columnSelection(3, 1000, 1))).toBe('B:D');
    expect(selectionLabel(rowSelection(4, 26))).toBe('5:5');
    expect(selectionLabel(rowSelection(4, 26, 1))).toBe('2:5');
  });

  it('extends from the original anchor', () => {
    const selection = extendSelection(cellSelection(1, 1), { r: 3, c: 4 });

    expect(selection.kind).toBe('range');
    expect(selection.range).toEqual({ r1: 1, c1: 1, r2: 3, c2: 4 });
    expect(selection.anchor).toEqual({ r: 1, c: 1 });
    expect(selection.active).toEqual({ r: 3, c: 4 });
  });

  it('keeps sheet selection kind separate from a plain rectangular range', () => {
    const selection = sheetSelection({ r1: 0, c1: 0, r2: 999, c2: 25 });

    expect(selection.kind).toBe('sheet');
    expect(selectionLabel(selection)).toBe('A1:Z1000');
  });
});
