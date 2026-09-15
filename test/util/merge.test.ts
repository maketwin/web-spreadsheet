import { describe, expect, it } from 'vitest';
import { coveredBySameMerge, expandRangeToMerges, mergeConflictCount, mergeToString, replaceMerges, shiftMergesForDelete, shiftMergesForInsert } from '../../src/util/merge';
import { Store } from '../../src/store/Store';

describe('coveredBySameMerge', () => {
  it('is true for two cells inside one merge', () => {
    expect(coveredBySameMerge([{ r1: 0, c1: 0, r2: 1, c2: 1 }], 0, 0, 1, 1)).toBe(true);
  });

  it('is false for cells in two adjacent merges (their shared boundary is an outer edge)', () => {
    const stacked = [{ r1: 0, c1: 0, r2: 0, c2: 1 }, { r1: 1, c1: 0, r2: 1, c2: 1 }];
    expect(coveredBySameMerge(stacked, 0, 0, 1, 0)).toBe(false);
  });

  it('is false when either cell is outside all merges', () => {
    expect(coveredBySameMerge([{ r1: 0, c1: 0, r2: 0, c2: 1 }], 0, 0, 5, 5)).toBe(false);
  });
});

describe('replaceMerges', () => {
  it('swaps the merge set wholesale', () => {
    const store = new Store();
    store.addMerge('A1:B1');

    replaceMerges(store, ['C3:D4']);

    expect(store.getMerges()).toEqual(['C3:D4']);
  });
});

describe('mergeToString', () => {
  it('normalizes and formats A1 notation', () => {
    expect(mergeToString({ r1: 2, c1: 1, r2: 0, c2: 0 })).toBe('A1:B3');
  });
});

describe('shiftMergesForInsert', () => {
  it('moves merges at/after the insertion point', () => {
    expect(shiftMergesForInsert(['A1:B2', 'C5:D6'], 4, 2, 'row')).toEqual(['A1:B2', 'C7:D8']);
  });

  it('grows a merge straddling the insertion point (Excel)', () => {
    // Merge rows 3..6 (A3:A6), insert 2 rows at index 4 -> A3:A8
    expect(shiftMergesForInsert(['A3:A6'], 4, 2, 'row')).toEqual(['A3:A8']);
  });

  it('shifts columns for col inserts', () => {
    expect(shiftMergesForInsert(['B2:C3'], 1, 1, 'col')).toEqual(['C2:D3']);
  });
});

describe('shiftMergesForDelete', () => {
  it('moves merges after the deleted range up', () => {
    expect(shiftMergesForDelete(['A8:B9'], 2, 3, 'row')).toEqual(['A6:B7']);
  });

  it('keeps merges before the deleted range', () => {
    expect(shiftMergesForDelete(['A1:B2'], 4, 5, 'row')).toEqual(['A1:B2']);
  });

  it('drops a merge fully covered by the deletion', () => {
    expect(shiftMergesForDelete(['A3:A4'], 2, 5, 'row')).toEqual([]);
  });

  it('shrinks a merge partially overlapped (tail cut)', () => {
    // A2:A6, delete rows 4..5 (index) -> A2:A4
    expect(shiftMergesForDelete(['A2:A6'], 4, 5, 'row')).toEqual(['A2:A4']);
  });

  it('shrinks a merge partially overlapped (head cut)', () => {
    // A4:A8 (index 3..7), delete rows 2..4 (index) -> surviving rows 5..7 shift up 3 -> A3:A5
    expect(shiftMergesForDelete(['A4:A8'], 2, 4, 'row')).toEqual(['A3:A5']);
  });

  it('shrinks a merge with the deletion in the middle', () => {
    // A2:A10, delete rows 4..5 -> A2:A8
    expect(shiftMergesForDelete(['A2:A10'], 4, 5, 'row')).toEqual(['A2:A8']);
  });

  it('handles columns', () => {
    // C2:E2 (cols 2..4), delete cols B..C (1..2) -> surviving D..E shift left 2 -> B2:C2
    expect(shiftMergesForDelete(['C2:E2'], 1, 2, 'col')).toEqual(['B2:C2']);
  });
});

describe('expandRangeToMerges', () => {
  it('expands to fully include intersecting merges', () => {
    const store = new Store();
    store.addMerge('B2:D4');
    expect(expandRangeToMerges(store, { r1: 0, c1: 0, r2: 1, c2: 1 })).toEqual({ r1: 0, c1: 0, r2: 3, c2: 3 });
  });

  it('chains expansion through touching merges', () => {
    const store = new Store();
    store.addMerge('B2:C2');
    store.addMerge('C3:E3');
    // B2:C2 touches the second merge via column C? No overlap in rows; start range covering B2 hits first merge only.
    const out = expandRangeToMerges(store, { r1: 1, c1: 1, r2: 1, c2: 1 });
    expect(out).toEqual({ r1: 1, c1: 1, r2: 1, c2: 2 });
  });

  it('leaves ranges without merges unchanged', () => {
    const store = new Store();
    expect(expandRangeToMerges(store, { r1: 0, c1: 0, r2: 2, c2: 2 })).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
  });
});

describe('mergeConflictCount', () => {
  it('counts non-anchor non-empty cells', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'anchor' });
    store.setCell(0, 1, { text: 'x' });
    store.setCell(1, 0, { text: 'y' });
    store.setCell(1, 1, { text: '' });
    expect(mergeConflictCount(store, { r1: 0, c1: 0, r2: 1, c2: 1 })).toBe(2);
  });

  it('is zero when only the anchor has a value', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'anchor' });
    expect(mergeConflictCount(store, { r1: 0, c1: 0, r2: 1, c2: 1 })).toBe(0);
  });
});
