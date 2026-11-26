import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import { SheetData } from '../../src/store/SheetData';
import { parseRange } from '../../src/util/rangeNotation';
import { num2alpha } from '../../src/util/alphabet';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

import type * as NotationModule from '../../src/util/rangeNotation';

/** Counting wrapper around the real parseRange: the merge lookup path must
 * never re-parse stored ranges (that was the O(merges) per-cell cost). */
let mockParseCalls = 0;
vi.mock('../../src/util/rangeNotation', async (importOriginal) => {
  const actual = await importOriginal<typeof NotationModule>();
  return {
    ...actual,
    parseRange: (rangeStr: string) => {
      mockParseCalls += 1;
      return actual.parseRange(rangeStr);
    },
  };
});

/** Deterministic PRNG so the random merge batch is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rangeStr(r1: number, c1: number, r2: number, c2: number): string {
  const a = `${num2alpha(c1)}${r1 + 1}`;
  return r1 === r2 && c1 === c2 ? a : `${a}:${num2alpha(c2)}${r2 + 1}`;
}

/** Handcrafted shapes + a fixed-seed random batch, ≥ 30 merges overall. */
function seedMerges(store: Store): void {
  const fixed = [
    'A1', // single cell
    'C2:E2', // 1×N horizontal
    'G3:G10', // N×1 vertical
    'I5:K20', // big block
    'A1:C1', // row-0 edge (overlaps 'A1': first added must win)
    'A1000:J1000', // row-999 edge
    'A1:A50', // col-0 edge
    'Z1:Z100', // col-25 edge
    'Y1000:Z1000', // row-999 × col-25 corner
  ];
  for (const range of fixed) store.addMerge(range);
  const rand = mulberry32(20240917);
  const random: string[] = [];
  while (random.length < 24) {
    const r1 = Math.floor(rand() * TOTAL_ROWS);
    const r2 = Math.min(TOTAL_ROWS - 1, r1 + Math.floor(rand() * 30));
    const c1 = Math.floor(rand() * TOTAL_COLS);
    const c2 = Math.min(TOTAL_COLS - 1, c1 + Math.floor(rand() * 5));
    const range = rangeStr(r1, c1, r2, c2);
    if (!random.includes(range)) random.push(range);
  }
  for (const range of random) store.addMerge(range);
}

/** The reference the index must match: scan getMerges() in insertion order. */
function naiveMergeAt(store: Store, r: number, c: number): string | undefined {
  for (const rangeStr of store.getMerges()) {
    const { r1, c1, r2, c2 } = parseRange(rangeStr);
    if (r >= r1 && r <= r2 && c >= c1 && c <= c2) return rangeStr;
  }
  return undefined;
}

describe('merge index', () => {
  beforeEach(() => { mockParseCalls = 0; });

  it('getMergeAt matches a naive scan on every cell of a window and the first/last rows', () => {
    const store = new Store();
    seedMerges(store);
    expect(store.getMerges().length).toBeGreaterThanOrEqual(30);
    for (let r = 0; r < 60; r += 1) {
      for (let c = 0; c < TOTAL_COLS; c += 1) {
        expect(store.getMergeAt(r, c)).toBe(naiveMergeAt(store, r, c));
      }
    }
    for (const r of [0, TOTAL_ROWS - 1]) {
      for (let c = 0; c < TOTAL_COLS; c += 1) {
        expect(store.getMergeAt(r, c)).toBe(naiveMergeAt(store, r, c));
      }
    }
  });

  it('removeMerge drops only its own coverage; neighbours stay queryable', () => {
    const store = new Store();
    store.addMerge('B2:D4');
    store.addMerge('E2:G4');
    expect(store.getMergeAt(2, 3)).toBe('B2:D4');
    expect(store.getMergeAt(2, 4)).toBe('E2:G4');
    store.removeMerge('B2:D4');
    expect(store.getMergeAt(2, 3)).toBeUndefined();
    expect(store.getMergeAt(3, 3)).toBeUndefined();
    expect(store.getMergeAt(2, 4)).toBe('E2:G4');
    expect(store.getMergeAt(1, 4)).toBe('E2:G4'); // E2 (its anchor) still covered
  });

  it('overlapping merges: the earliest added wins until it is removed', () => {
    const store = new Store();
    store.addMerge('A1:C3');
    store.addMerge('B2:D4');
    expect(store.getMergeAt(1, 1)).toBe('A1:C3'); // B2
    expect(store.getMergeAt(3, 3)).toBe('B2:D4'); // D4
    store.removeMerge('A1:C3');
    expect(store.getMergeAt(1, 1)).toBe('B2:D4');
    expect(store.getMergeAt(3, 3)).toBe('B2:D4');
  });

  it('adding the same range twice then removing once leaves no coverage', () => {
    const store = new Store();
    store.addMerge('B2:D4');
    store.addMerge('B2:D4');
    expect(store.getMerges()).toEqual(['B2:D4']);
    store.removeMerge('B2:D4');
    for (let r = 0; r < 6; r += 1) {
      for (let c = 0; c < 6; c += 1) expect(store.getMergeAt(r, c)).toBeUndefined();
    }
  });

  it('lookups survive serialize round-trips (SheetData and Store)', () => {
    const sheet = new SheetData();
    for (const range of ['A1', 'C2:E2', 'G3:G10', 'I5:K20', 'A1000:J1000', 'Z1:Z100']) sheet.addMerge(range);
    const restoredSheet = SheetData.deserialize(sheet.serialize());
    expect(restoredSheet.getMerges()).toEqual(sheet.getMerges());
    for (let r = 0; r < 25; r += 1) {
      for (let c = 0; c < TOTAL_COLS; c += 1) {
        expect(restoredSheet.getMergeRectAt(r, c)?.range).toBe(sheet.getMergeRectAt(r, c)?.range);
        expect(restoredSheet.getMergeRectAt(r, c)).toEqual(sheet.getMergeRectAt(r, c));
      }
    }

    const store = new Store();
    seedMerges(store);
    const restoredStore = Store.deserialize(store.serialize());
    for (let r = 0; r < 60; r += 1) {
      for (let c = 0; c < TOTAL_COLS; c += 1) {
        expect(restoredStore.getMergeAt(r, c)).toBe(store.getMergeAt(r, c));
      }
    }
  });

  it('getMergeAt does not parse stored ranges on the lookup path', () => {
    const store = new Store();
    for (let i = 0; i < 50; i += 1) {
      store.addMerge(rangeStr(Math.floor(i / TOTAL_COLS), i % TOTAL_COLS, Math.floor(i / TOTAL_COLS), i % TOTAL_COLS));
    }
    expect(mockParseCalls).toBeGreaterThan(0); // the counter is actually wired up
    // All 50 merges stay queryable (these lookups parse nothing).
    for (let i = 0; i < 50; i += 1) {
      const r = Math.floor(i / TOTAL_COLS);
      const c = i % TOTAL_COLS;
      expect(store.getMergeAt(r, c)).toBe(rangeStr(r, c, r, c));
    }
    const before = mockParseCalls;
    for (let i = 0; i < 20_000; i += 1) store.getMergeAt(i % TOTAL_ROWS, i % TOTAL_COLS);
    expect(mockParseCalls).toBe(before);
  });

  it('getMergeRectAt returns the whole rect for covered cells and undefined outside', () => {
    const store = new Store();
    store.addMerge('A1');
    store.addMerge('B2:D4');
    expect(store.getMergeRectAt(0, 0)).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0, range: 'A1' });
    expect(store.getMergeRectAt(1, 1)).toEqual({ r1: 1, c1: 1, r2: 3, c2: 3, range: 'B2:D4' });
    expect(store.getMergeRectAt(3, 3)).toEqual({ r1: 1, c1: 1, r2: 3, c2: 3, range: 'B2:D4' });
    expect(store.getMergeRectAt(3, 4)).toBeUndefined();
    expect(store.getMergeRectAt(4, 1)).toBeUndefined();
    expect(store.getMergeRectAt(0, 1)).toBeUndefined();

    // Every covered cell reports the exact parsed bounds of the merge that
    // owns it (the earliest added one when regions overlap).
    seedMerges(store);
    for (const range of store.getMerges()) {
      const { r1, c1, r2, c2 } = parseRange(range);
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          if (naiveMergeAt(store, r, c) !== range) continue; // an earlier merge owns this cell
          expect(store.getMergeRectAt(r, c)).toEqual({ r1, c1, r2, c2, range });
        }
      }
    }
  });

  it('indexes one entry per 64-row band, never per row, whatever the range says', () => {
    const sheet = new SheetData();
    const bandEntries = (): number => (sheet as unknown as { mergesByRow: Map<number, unknown> }).mergesByRow.size;
    // A whole-grid merge touches every row the grid has…
    sheet.addMerge('A1:A1048576');
    expect(sheet.getMergeRectAt(TOTAL_ROWS - 1, 0)?.range).toBe('A1:A1048576');
    expect(sheet.getMergeRectAt(0, 0)?.range).toBe('A1:A1048576');
    // …without one index entry per row: bands of 64 rows cap the index.
    expect(bandEntries()).toBe(Math.ceil(TOTAL_ROWS / 64));
    // A range reaching far past the grid is indexed up to the last band only.
    sheet.removeMerge('A1:A1048576');
    sheet.addMerge('A1:A999999999');
    expect(bandEntries()).toBeLessThanOrEqual(Math.ceil(TOTAL_ROWS / 64));
    expect(sheet.getMergeRectAt(TOTAL_ROWS - 1, 0)?.range).toBe('A1:A999999999');
    sheet.removeMerge('A1:A999999999');
    expect(bandEntries()).toBe(0);
    // A small merge still costs exactly the bands it spans.
    sheet.addMerge('A63:B65');
    expect(bandEntries()).toBe(2);
    expect(sheet.getMergeRectAt(63, 1)?.range).toBe('A63:B65');
    expect(sheet.getMergeRectAt(64, 1)?.range).toBe('A63:B65');
  });
});
