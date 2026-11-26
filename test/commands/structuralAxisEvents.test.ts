import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { InsertColCommand } from '../../src/commands/impl/InsertCol';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { RemoveDuplicatesCommand } from '../../src/commands/impl/RemoveDuplicates';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

import type { Command } from '../../src/commands/Command';
import type { ColMeta, RowMeta, StoreEvent } from '../../src/types';

/** Deterministic PRNG so the seeded stores are reproducible. */
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

function countTyped(events: readonly StoreEvent[], type: StoreEvent['type']): number {
  return events.filter((e) => e.type === type).length;
}

/**
 * Reference final state per the structural semantics: entries before `start`
 * stay, entries at/after `start` shift by ±count (insert: past the grid edge
 * means dropped; delete: entries inside [start, start+count) are removed).
 */
function referenceShift(pre: ReadonlyMap<number, RowMeta | ColMeta>, start: number, count: number, limit: number, dir: 'insert' | 'delete'): Map<number, RowMeta | ColMeta> {
  const next = new Map<number, RowMeta | ColMeta>();
  for (const [idx, meta] of pre) {
    if (idx < start) next.set(idx, meta);
    else if (dir === 'insert') {
      if (idx + count < limit) next.set(idx + count, meta);
    } else if (idx >= start + count) {
      next.set(idx - count, meta);
    }
  }
  return next;
}

/** Row/col axis of the whole store must equal the expected maps, index by index.
 * Entry-set equality is exactly "every index maps to the same meta (or none)":
 * an index with no metadata is absent from the entries, never mapped to undefined. */
function expectAxisEquals(store: Store, sid: string, rows: ReadonlyMap<number, RowMeta | ColMeta>, cols: ReadonlyMap<number, RowMeta | ColMeta>): void {
  expect(new Map(store.getRowEntries(sid))).toEqual(rows);
  expect(new Map(store.getColEntries(sid))).toEqual(cols);
}

/** A store with metadata on ~40 random rows and 10 random cols plus plain
 * cells. Cells/rows/cols are inserted in ascending index order so that a
 * structural command's undo can restore the exact serialize() output
 * (Map insertion order is part of serialization). */
function seededStore(seed: number): { store: Store; sid: string; rows: Map<number, RowMeta>; cols: Map<number, ColMeta> } {
  const store = new Store();
  const sid = store.getActiveSheetId();
  const rand = mulberry32(seed);
  const rowIdx = new Set<number>();
  while (rowIdx.size < 40) rowIdx.add(Math.floor(rand() * TOTAL_ROWS));
  const colIdx = new Set<number>();
  while (colIdx.size < 10) colIdx.add(Math.floor(rand() * TOTAL_COLS));
  const rows = new Map<number, RowMeta>();
  for (const r of [...rowIdx].sort((a, b) => a - b)) {
    const meta = { height: 20 + (r % 50), hide: r % 7 === 0 };
    store.setRow(r, meta, sid);
    rows.set(r, meta);
  }
  const cols = new Map<number, ColMeta>();
  for (const c of [...colIdx].sort((a, b) => a - b)) {
    const meta = { width: 50 + (c % 40), hide: c % 5 === 0 };
    store.setCol(c, meta, sid);
    cols.set(c, meta);
  }
  const cells: Array<readonly [number, number]> = [];
  while (cells.length < 200) {
    const pair: readonly [number, number] = [Math.floor(rand() * TOTAL_ROWS), Math.floor(rand() * TOTAL_COLS)];
    if (!cells.some(([r, c]) => r === pair[0] && c === pair[1])) cells.push(pair);
  }
  for (const [r, c] of [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    store.setCell(r, c, { text: `t${r}_${c}`, value: r * TOTAL_COLS + c }, sid);
  }
  return { store, sid, rows, cols };
}

/** serialize() with the per-sheet pair arrays in canonical index order.
 * Undo restores the exact cell/row/col CONTENT but not the cell Map's
 * insertion order (restoreSheet re-adds band cells at the map end — true on
 * master too, before the axis-loop change), so undo fidelity is compared on
 * canonicalized content. */
function canonicalSerialize(store: Store): ReturnType<Store['serialize']> {
  const snap = store.serialize();
  return {
    ...snap,
    sheets: snap.sheets.map((sheet) => ({
      ...sheet,
      data: {
        ...sheet.data,
        cells: [...sheet.data.cells].sort((a, b) => Number(a[0].split(',')[0]) - Number(b[0].split(',')[0]) || Number(a[0].split(',')[1]) - Number(b[0].split(',')[1])),
        rows: [...sheet.data.rows].sort((a, b) => a[0] - b[0]),
        cols: [...sheet.data.cols].sort((a, b) => a[0] - b[0]),
      },
    })),
  };
}

/** Run one structural case on a fresh seeded store and check final axis state,
 * undo fidelity and redo fidelity against the reference maps. */
function runStructuralCase(make: (at: number, count: number) => Command, dir: 'insert' | 'delete', axis: 'row' | 'col', at: number, count: number): void {
  const { store, sid, rows, cols } = seededStore(424242);
  const before = canonicalSerialize(store);
  const cm = new CommandManager(store);
  cm.execute(make(at, count));
  const afterExec = canonicalSerialize(store);
  if (axis === 'row') {
    expectAxisEquals(store, sid, referenceShift(rows, at, count, TOTAL_ROWS, dir), cols);
  } else {
    expectAxisEquals(store, sid, rows, referenceShift(cols, at, count, TOTAL_COLS, dir));
  }
  cm.undo();
  expect(canonicalSerialize(store)).toEqual(before);
  cm.redo();
  expect(canonicalSerialize(store)).toEqual(afterExec);
}

describe('structural commands touch only rows/cols with metadata', () => {
  it('inserting a row into a table without row metadata delivers no row events', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < TOTAL_COLS; c += 1) store.setCell(r, c, { text: `v${r},${c}` }, sid);
    }
    const events: StoreEvent[] = [];
    const unsubscribe = store.subscribe((e) => events.push(e));
    new CommandManager(store).execute(new InsertRowCommand({ r: 0 }));
    unsubscribe();
    expect(countTyped(events, 'row')).toBe(0);
  });

  it('inserting a column without column metadata delivers no col events', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < TOTAL_COLS; c += 1) store.setCell(r, c, { text: `v${r},${c}` }, sid);
    }
    const events: StoreEvent[] = [];
    const unsubscribe = store.subscribe((e) => events.push(e));
    new CommandManager(store).execute(new InsertColCommand({ c: 0 }));
    unsubscribe();
    expect(countTyped(events, 'col')).toBe(0);
  });

  it('inserting 2 rows above metadata rows moves heights to 5/9 and delivers exactly 4 row events', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    store.setRow(3, { height: 33 }, sid);
    store.setRow(7, { height: 77 }, sid);
    const events: StoreEvent[] = [];
    const unsubscribe = store.subscribe((e) => events.push(e));
    new CommandManager(store).execute(new InsertRowCommand({ r: 0, count: 2 }));
    unsubscribe();
    expect(countTyped(events, 'row')).toBe(4);
    expect(store.getRow(5, sid)).toEqual({ height: 33 });
    expect(store.getRow(9, sid)).toEqual({ height: 77 });
    for (let r = 0; r < TOTAL_ROWS; r += 1) {
      if (r === 5 || r === 9) continue;
      expect(store.getRow(r, sid)).toBeUndefined();
    }
  });

  it('insert rows: final axis state, undo and redo match the reference', () => {
    const cases: Array<[number, number]> = [[0, 1], [0, 2], [3, 1], [5, 10], [500, 1], [995, 3], [999, 1]];
    for (const [at, count] of cases) runStructuralCase((a, n) => new InsertRowCommand({ r: a, count: n }), 'insert', 'row', at, count);
  });

  it('delete rows: final axis state, undo and redo match the reference', () => {
    const cases: Array<[number, number]> = [[0, 1], [0, 3], [3, 2], [500, 4], [998, 2], [999, 1]];
    for (const [at, count] of cases) runStructuralCase((a, n) => new DeleteRowCommand({ r: a, count: n }), 'delete', 'row', at, count);
  });

  it('insert cols: final axis state, undo and redo match the reference', () => {
    const cases: Array<[number, number]> = [[0, 1], [0, 2], [10, 3], [25, 1]];
    for (const [at, count] of cases) runStructuralCase((a, n) => new InsertColCommand({ c: a, count: n }), 'insert', 'col', at, count);
  });

  it('delete cols: final axis state, undo and redo match the reference', () => {
    const cases: Array<[number, number]> = [[0, 1], [0, 2], [12, 3], [20, 10], [25, 1]];
    for (const [at, count] of cases) runStructuralCase((a, n) => new DeleteColCommand({ c: a, count: n }), 'delete', 'col', at, count);
  });

  it('RemoveDuplicates moves row metadata up like repeated single-row deletes; columns stay put', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    // Column 0 reads A B A B A — first occurrences kept, rows 2, 3, 4 removed.
    const texts = ['A', 'B', 'A', 'B', 'A'];
    for (let r = 0; r < texts.length; r += 1) store.setCell(r, 0, { text: texts[r] ?? '' }, sid);
    const preRows = new Map<number, RowMeta>();
    for (const r of [1, 2, 3, 4, 7, 8]) {
      const meta = { height: 30 + r };
      store.setRow(r, meta, sid);
      preRows.set(r, meta);
    }
    const preCols = new Map<number, ColMeta>();
    for (const c of [2, 5]) {
      const meta = { width: 90 + c };
      store.setCol(c, meta, sid);
      preCols.set(c, meta);
    }
    const cm = new CommandManager(store);
    const cmd = new RemoveDuplicatesCommand({ r1: 0, c1: 0, r2: 4, c2: 0, columns: [0], hasHeader: false });
    cm.execute(cmd);
    expect(cmd.removedCount()).toBe(3);
    // Rows are removed bottom-up, one at a time — fold the reference likewise.
    let expectedRows: ReadonlyMap<number, RowMeta | ColMeta> = preRows;
    for (const r of [4, 3, 2]) expectedRows = referenceShift(expectedRows, r, 1, TOTAL_ROWS, 'delete');
    expectAxisEquals(store, sid, expectedRows, preCols);
  });

  it('undo (restoreSheet) delivers at most 2 row events per metadata row', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    const metaRows = 30;
    for (let i = 0; i < metaRows; i += 1) store.setRow(i * 33, { height: 100 + i }, sid);
    const cm = new CommandManager(store);
    cm.execute(new InsertRowCommand({ r: 0, count: 2 }));
    const events: StoreEvent[] = [];
    const unsubscribe = store.subscribe((e) => events.push(e));
    cm.undo();
    unsubscribe();
    expect(countTyped(events, 'row')).toBeLessThanOrEqual(metaRows * 2);
  });
});
