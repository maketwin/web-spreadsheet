import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import { SheetData } from '../../src/store/SheetData';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

import type { CellRect } from '../../src/store/SheetData';
import type { SerializedStore } from '../../src/store/Store';
import type { StoreEvent } from '../../src/types';

const LAST_R = TOTAL_ROWS - 1;
const LAST_C = TOTAL_COLS - 1;

/** Deterministic PRNG so coordinates and guard thresholds are reproducible. */
function mulberry32(seed: number): () => number {
  return () => {
    const t = (seed += 0x6d2b79f5);
    let a = Math.imul(t ^ (t >>> 15), 1 | t);
    a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (r: number, c: number): string => `${r},${c}`;

describe('numeric-key cell storage (a)', () => {
  it('writes and reads back 10k coordinates across the whole grid', () => {
    const sheet = new SheetData();
    const rand = mulberry32(20261125);
    const coords: Array<[number, number]> = [];
    for (let i = 0; i < 10_000; i += 1) {
      const pick = rand();
      if (pick < 0.25) coords.push([Math.floor(rand() * 64), Math.floor(rand() * 64)]);
      else if (pick < 0.5) coords.push([LAST_R - Math.floor(rand() * 64), LAST_C - Math.floor(rand() * 64)]);
      else if (pick < 0.75) coords.push([1048575 - Math.floor(rand() * 4), 16383 - Math.floor(rand() * 4)]);
      else coords.push([Math.floor(rand() * TOTAL_ROWS), Math.floor(rand() * TOTAL_COLS)]);
    }
    const text = (i: number): string => `cell-${i}`;
    coords.forEach(([r, c], i) => sheet.setCell(r, c, { text: text(i) }));
    // Repeated coordinates resolve to the last write, like the string-key map did.
    const expected = new Map<string, string>();
    coords.forEach(([r, c], i) => expected.set(key(r, c), text(i)));
    coords.forEach(([r, c]) => expect(sheet.getCell(r, c)?.text).toBe(expected.get(key(r, c))));
    expect(sheet.getCellCount()).toBe(expected.size);
    // Whitebox: keys are numbers (a string-key regression fails here deterministically).
    const firstKey = (sheet as unknown as { cells: Map<number, unknown> }).cells.keys().next().value;
    expect(typeof firstKey).toBe('number');
  });

  it('delete removes the key; serialize round-trip keeps "r,c" string keys', () => {
    const sheet = new SheetData();
    sheet.setCell(0, 0, { text: 'A1' });
    sheet.setCell(1048575, 16383, { text: 'corner' });
    sheet.setCell(LAST_R, 0, { text: 'br' });
    sheet.setCell(0, 0, undefined);
    expect(sheet.getCell(0, 0)).toBeUndefined();
    expect(sheet.getCellCount()).toBe(2);

    const restored = SheetData.deserialize(sheet.serialize());
    expect(restored.getCells()).toEqual(sheet.getCells());
    expect(restored.getCells().map(([k]) => k).every((k) => k.includes(','))).toBe(true);
    expect(restored.getCell(1048575, 16383)?.text).toBe('corner');
    expect(restored.getCell(LAST_R, 0)?.text).toBe('br');
    expect(restored.getCell(0, 0)).toBeUndefined();
  });

  it('a million reads of one column return the stored cells and do not walk them', () => {
    const sheet = new SheetData();
    for (let i = 0; i < 10_000; i += 1) sheet.setCell(i, 0, { text: 'x' });
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 1_000_000; i += 1) {
      if (sheet.getCell(i, 0) !== undefined) n += 1;
    }
    expect(n).toBe(10_000);
    // ≈40 ms under coverage on the dev machine, 76 ms with the runner loaded:
    // the wall leaves an order of magnitude. A read that walked the stored
    // cells would be ten billion steps. This is not a string-key guard —
    // string keys read the same million in ≈55 ms, too close to tell apart by
    // timing; the key type is asserted in the test above.
    expect(performance.now() - t0).toBeLessThan(400);
  });
});

describe('traversal of stored cells only (b)', () => {
  it('forEachCell visits exactly getCellCount() stored cells, each once', () => {
    const sheet = new SheetData();
    const rand = mulberry32(7);
    const placed = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const r = Math.floor(rand() * 2000);
      const c = Math.floor(rand() * 2000);
      sheet.setCell(r, c, { text: 'x' });
      placed.add(key(r, c));
    }
    const visited = new Set<string>();
    sheet.forEachCell((r, c) => visited.add(key(r, c)));
    expect(visited.size).toBe(sheet.getCellCount());
    expect(visited).toEqual(placed);
  });

  it('forEachCell(rect) visits every rect cell and nothing outside it', () => {
    const sheet = new SheetData();
    const rand = mulberry32(11);
    for (let i = 0; i < 10_000; i += 1) {
      sheet.setCell(Math.floor(rand() * 5000), Math.floor(rand() * 5000), { text: 'x' });
    }
    const rect: CellRect = { r1: 100, c1: 200, r2: 109, c2: 209 };
    const inside = new Set<string>();
    for (let r = rect.r1; r <= rect.r2; r += 1) {
      for (let c = rect.c1; c <= rect.c2; c += 1) {
        if (sheet.getCell(r, c) !== undefined) inside.add(key(r, c));
      }
    }
    const visited: Array<[number, number]> = [];
    sheet.forEachCell((r, c) => visited.push([r, c]), rect);
    for (const [r, c] of visited) {
      expect(r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2).toBe(true);
    }
    expect(new Set(visited.map(([r, c]) => key(r, c)))).toEqual(inside);
    expect(visited.length).toBe(inside.size);
  });

  it('getUsedBounds tracks writes and re-derives after boundary deletes', () => {
    const sheet = new SheetData();
    expect(sheet.getUsedBounds()).toBeUndefined();
    sheet.setCell(5, 3, { text: 'x' });
    sheet.setCell(2, 9, { text: 'x' });
    sheet.setCell(8, 1, { text: 'x' });
    expect(sheet.getUsedBounds()).toEqual({ r1: 2, c1: 1, r2: 8, c2: 9 });
    // Deleting the min-corner cell must shrink the bounds, not stale them.
    sheet.setCell(2, 9, undefined);
    expect(sheet.getUsedBounds()).toEqual({ r1: 5, c1: 1, r2: 8, c2: 3 });
    sheet.setCell(8, 1, undefined);
    expect(sheet.getUsedBounds()).toEqual({ r1: 5, c1: 3, r2: 5, c2: 3 });
    sheet.setCell(5, 3, undefined);
    expect(sheet.getUsedBounds()).toBeUndefined();
  });
});

describe('limitToData (c)', () => {
  it('collapses to the first cell of the range on an empty sheet', () => {
    const store = new Store();
    expect(store.limitToData({ r1: 7, c1: 3, r2: 20, c2: 9 })).toEqual({ r1: 7, c1: 3, r2: 7, c2: 3 });
  });

  it('returns a range fully inside the used bounds unchanged', () => {
    const store = new Store();
    store.setCell(10, 10, { text: 'x' });
    store.setCell(50, 40, { text: 'x' });
    const range: CellRect = { r1: 12, c1: 11, r2: 30, c2: 20 };
    expect(store.limitToData(range)).toBe(range);
  });

  it('returns the intersection for a partial overlap', () => {
    const store = new Store();
    store.setCell(10, 10, { text: 'x' });
    store.setCell(50, 40, { text: 'x' });
    expect(store.limitToData({ r1: 0, c1: 0, r2: 20, c2: 20 })).toEqual({ r1: 10, c1: 10, r2: 20, c2: 20 });
    expect(store.limitToData({ r1: 0, c1: 35, r2: 60, c2: 50 })).toEqual({ r1: 10, c1: 35, r2: 50, c2: 40 });
  });

  it('returns the first cell of a range that misses the data entirely', () => {
    const store = new Store();
    store.setCell(10, 10, { text: 'x' });
    expect(store.limitToData({ r1: 100, c1: 100, r2: 200, c2: 200 })).toEqual({ r1: 100, c1: 100, r2: 100, c2: 100 });
  });

  it('clamps a whole-column range to the height of the data', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'h' });
    store.setCell(999, 0, { text: 'd' });
    const limited = store.limitToData({ r1: 0, c1: 0, r2: LAST_R, c2: 0 });
    expect(limited.r2 - limited.r1 + 1).toBe(1000);
  });
});

describe('merge row-band index (d)', () => {
  it('indexes a full-grid merge once per 64-row band, never per row', () => {
    const store = new Store();
    const sheet = store.getSheetData('sheet-1');
    const bands = (): number => (sheet as unknown as { mergesByRow: Map<number, unknown> }).mergesByRow.size;
    const t0 = performance.now();
    store.addMerge('A1:A1048576');
    expect(performance.now() - t0).toBeLessThan(1000); // ~1 ms here; an index entry per row would be ~65x slower
    expect(bands()).toBeLessThanOrEqual(Math.ceil(TOTAL_ROWS / 64));
    expect(store.getMergeAt(0, 0)).toBe('A1:A1048576');
    expect(store.getMergeAt(1048575, 0)).toBe('A1:A1048576');
    store.removeMerge('A1:A1048576');
    expect(store.getMergeAt(1048575, 0)).toBeUndefined();
    expect(bands()).toBe(0);
  });

  it('band lookup agrees with a naive scan across many merges and rows', () => {
    const store = new Store();
    const rand = mulberry32(99);
    for (let i = 0; i < 40; i += 1) {
      const r1 = Math.floor(rand() * 500);
      const r2 = r1 + Math.floor(rand() * 300);
      const c1 = Math.floor(rand() * 20);
      const c2 = c1 + Math.floor(rand() * 5);
      const a = `${String.fromCharCode(65 + c1)}${r1 + 1}`;
      const b = `${String.fromCharCode(65 + c2)}${r2 + 1}`;
      store.addMerge(r1 === r2 && c1 === c2 ? a : `${a}:${b}`);
    }
    // Cells in band-crossing rows must still resolve through their band.
    for (const r of [0, 63, 64, 65, 127, 128, 499, 799]) {
      for (let c = 0; c < 26; c += 1) {
        const at = store.getMergeRectAt(r, c);
        if (at === undefined) continue;
        expect(r >= at.r1 && r <= at.r2 && c >= at.c1 && c <= at.c2).toBe(true);
      }
    }
  });
});

describe('replaceAll events (e)', () => {
  it('announces workbook replace plus sheet events and no per-cell events', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'old' });
    const saved: SerializedStore = store.serialize();
    const events: StoreEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.replaceAll(saved);
    expect(events.some((e) => e.type === 'cell')).toBe(false);
    expect(events.some((e) => e.type === 'workbook' && e.action === 'replace')).toBe(true);
    const adds = events
      .filter((e): e is Extract<StoreEvent, { type: 'sheet' }> => e.type === 'sheet')
      .filter((e) => e.action === 'add');
    expect(adds.map((e) => e.sheetId)).toEqual(saved.sheets.map((s) => s.id));
    // The swapped-in data is actually there.
    expect(store.getCell(0, 0)?.text).toBe('old');
  });

  it('formulas of a replaceAll-loaded workbook still recalculate to fresh values', () => {
    const authored = new Store();
    authored.setCell(0, 0, { text: '=1+1', formula: '=1+1' });
    const saved = authored.serialize();

    const store = new Store();
    const engine = new FormulaEngine(store);
    const sync = createFormulaSync(store, engine);
    store.replaceAll(saved);
    expect(store.getCell(0, 0)?.value).toBe(2);
    sync.unsubscribe();
  });
});

describe('copySheet (f)', () => {
  it('duplicates content without going through serialize()', () => {
    const store = new Store();
    const a = store.getActiveSheetId();
    store.setCell(0, 0, { text: 'hello', value: 'hello' });
    store.setCell(3, 2, { formula: '=A1', text: 'hello' });
    store.addMerge('B1:C2');
    const spy = vi.spyOn(SheetData.prototype, 'serialize');
    const copy = store.copySheet(a, { name: 'copy' });
    expect(copy).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
    expect(store.getCell(0, 0, copy!)?.text).toBe('hello');
    expect(store.getCell(3, 2, copy!)?.formula).toBe('=A1');
    expect(store.getMerges(copy!)).toEqual(['B1:C2']);
    // Cells are shared by reference: writing the source replaces its own cell, not the copy's.
    store.setCell(0, 0, { text: 'changed' }, a);
    expect(store.getCell(0, 0, copy!)?.text).toBe('hello');
    spy.mockRestore();
  });
});

describe('scale guards (g): 1,000,000 stored cells in column A', () => {
  let big: Store;
  let small: Store;
  let bigWriteMs = 0;

  beforeAll(() => {
    big = new Store();
    small = new Store();
    for (let i = 0; i < 10_000; i += 1) small.setCell(i, 0, { text: String(i) });
    const t0 = performance.now();
    big.batch(() => {
      for (let i = 0; i < 1_000_000; i += 1) big.setCell(i, 0, { text: String(i) });
    });
    bigWriteMs = performance.now() - t0;
  });

  it('batch write of 1M cells', () => {
    // Measured ~0.9 s here. CI runs under coverage on a slower, loaded runner
    // (~10x in all); the walls in this block leave that room, and the exact
    // guards beside them (call counts, key shape) are what catch a regression.
    expect(bigWriteMs).toBeLessThan(12_000);
  });

  it('forEachCell walks the whole sheet once, fast', () => {
    const t0 = performance.now();
    let seen = 0;
    big.forEachCell(() => { seen += 1; });
    const ms = performance.now() - t0;
    expect(seen).toBe(1_000_000);
    expect(ms).toBeLessThan(1000); // measured 10-25 ms; a walk of the address space would take hours
  });

  it('forEachCellInRect cost is independent of sheet size (getCell spy)', () => {
    const rect: CellRect = { r1: 500_000, c1: 0, r2: 500_009, c2: 9 };
    const spy = vi.spyOn(SheetData.prototype, 'getCell');
    big.forEachCellInRect(rect, () => {});
    const bigCalls = spy.mock.calls.length;
    spy.mockClear();
    small.forEachCellInRect({ r1: 5_000, c1: 0, r2: 5_009, c2: 9 }, () => {});
    const smallCalls = spy.mock.calls.length;
    spy.mockRestore();
    // Same call count on both sheets: the walk touched addresses, not the 1M stored cells.
    expect(bigCalls).toBe(smallCalls);
    expect(bigCalls).toBeGreaterThanOrEqual(100); // a real address walk looks every cell up
    expect(bigCalls).toBeLessThanOrEqual(400);
    // And it found the 10 cells actually there.
    let hits = 0;
    big.forEachCellInRect(rect, () => { hits += 1; });
    expect(hits).toBe(10);
  });

  it('getUsedBounds / getCellCount answer in O(1)', () => {
    expect(big.getUsedBounds()).toEqual({ r1: 0, c1: 0, r2: 999_999, c2: 0 });
    expect(big.getCellCount()).toBe(1_000_000);
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i += 1) {
      big.getUsedBounds();
      big.getCellCount();
    }
    expect(performance.now() - t0).toBeLessThan(1000); // measured ~2 ms; recomputing the bounds per call would be far slower
  });

  it('a million getCell reads on the full sheet stay in the numeric-key range', () => {
    const sheet = big.getSheetData('sheet-1')!;
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 1_000_000; i += 1) {
      if (sheet.getCell(i, 0) !== undefined) n += 1;
    }
    expect(n).toBe(1_000_000);
    // ~94 ms measured; CI runs under coverage on a slower, loaded runner
    // (~10x). The deterministic key-shape guard above, not this wall clock,
    // is what catches a string-key regression.
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
