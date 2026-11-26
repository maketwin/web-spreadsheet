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

  it('a range selected without an explicit active cell starts at its top-left (the name box: the viewport follows the active cell)', () => {
    const wholeColumn = rangeSelection({ r1: 0, c1: 0, r2: 1_048_575, c2: 0 });
    expect(wholeColumn.active).toEqual({ r: 0, c: 0 });
    expect(wholeColumn.anchor).toEqual({ r: 0, c: 0 });
    const block = rangeSelection({ r1: 4, c1: 1, r2: 9, c2: 3 });
    expect(block.active).toEqual({ r: 4, c: 1 });
    // An explicit active cell still wins (drag and shift-extend rely on it).
    expect(rangeSelection({ r1: 0, c1: 0, r2: 2, c2: 2 }, undefined, { r: 2, c: 2 }).active).toEqual({ r: 2, c: 2 });
  });

  it('keeps sheet selection kind separate from a plain rectangular range', () => {
    const selection = sheetSelection({ r1: 0, c1: 0, r2: 999, c2: 25 });

    expect(selection.kind).toBe('sheet');
    expect(selectionLabel(selection)).toBe('A1:Z1000');
  });
});
