import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { MoveRange } from '../../src/commands/impl/MoveRange';
import { RemoveDuplicatesCommand } from '../../src/commands/impl/RemoveDuplicates';
import { SetMerge } from '../../src/commands/impl/SetMerge';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { FillRangeCommand } from '../../src/commands/impl/FillRange';
import { parseKey } from '../../src/commands/impl/sheetSnapshot';
import { sortRowsInPlace } from '../../src/filter/sortRows';
import { Store } from '../../src/store/Store';
import { mergeToString, parseMerge, rangesIntersect } from '../../src/util/merge';
import { shiftFormula } from '../../src/formula/refRewrite';

import type { Command } from '../../src/commands/Command';
import type { RangeAddress } from '../../src/selection/Range';
import type { Cell } from '../../src/types';

const run = (cm: CommandManager, cmd: Command): void => { cm.execute.bind(cm)(cmd); };

/** Deterministic PRNG. */
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** serialize() with pair arrays in canonical order (Map insertion order is not semantic). */
function canonical(store: Store): unknown {
  const snap = store.serialize();
  return {
    ...snap,
    sheets: snap.sheets.map((sheet) => ({
      ...sheet,
      data: {
        ...sheet.data,
        cells: [...sheet.data.cells].sort((a, b) => {
          const [ra, ca] = a[0].split(',').map(Number) as [number, number];
          const [rb, cb] = b[0].split(',').map(Number) as [number, number];
          return ra - rb || ca - cb;
        }),
        rows: [...sheet.data.rows].sort((a, b) => a[0] - b[0]),
        cols: [...sheet.data.cols].sort((a, b) => a[0] - b[0]),
        merges: [...sheet.data.merges].sort(),
      },
    })),
  };
}

/** Random small table: ~28 rows x ~5 cols; empty cells, empty rows, numbers,
 * text and the occasional formula. Written in ascending order so both stores
 * serialize identically apart from command effects. */
function randomTable(rand: () => number, rows: number, cols: number, formulaChance = 0.1): Array<{ r: number; c: number; cell: Cell }> {
  const out: Array<{ r: number; c: number; cell: Cell }> = [];
  for (let r = 0; r < rows; r += 1) {
    // ~1 in 6 rows is entirely empty
    if (rand() < 0.16) continue;
    for (let c = 0; c < cols; c += 1) {
      const roll = rand();
      if (roll < 0.3) continue; // empty cell
      if (roll < 0.3 + formulaChance) {
        out.push({ r, c, cell: { text: '', formula: `=B${Math.max(1, r)}*2` } });
        continue;
      }
      if (roll < 0.7) out.push({ r, c, cell: { text: String(Math.floor(rand() * 100)), value: Math.floor(rand() * 100) } });
      else out.push({ r, c, cell: { text: `t${Math.floor(rand() * 30)}` } });
    }
  }
  return out;
}

function storeFrom(specs: Array<{ r: number; c: number; cell: Cell }>): Store {
  const store = new Store();
  for (const { r, c, cell } of specs) store.setCell(r, c, cell);
  return store;
}

function storeFromCopy(specs: Array<{ r: number; c: number; cell: Cell }>): Store {
  // Deep-ish copy so the two stores share no Cell objects.
  return storeFrom(specs.map(({ r, c, cell }) => ({ r, c, cell: { ...cell } })));
}

/* ------------------------------------------------------------------ */
/* Dense reference implementations — the pre-change algorithms, kept  */
/* here verbatim as the behavioral oracle for the sparse rewrites.    */
/* ------------------------------------------------------------------ */

type CellMatrix = readonly (readonly (Cell | undefined)[])[];

function denseSnapshotRange(store: Store, range: RangeAddress): CellMatrix {
  const rows: (Cell | undefined)[][] = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    const row: (Cell | undefined)[] = [];
    for (let c = range.c1; c <= range.c2; c += 1) row.push(store.getCell(r, c));
    rows.push(row);
  }
  return rows;
}

function cloneCell(cell: Cell | undefined): Cell | undefined {
  if (cell === undefined) return undefined;
  return { ...cell };
}

/** Old dense MoveRange semantics. */
function denseMoveRange(store: Store, source: RangeAddress, target: RangeAddress, copy: boolean): void {
  const srcRows = source.r2 - source.r1 + 1;
  const srcCols = source.c2 - source.c1 + 1;
  const sourceSnapshot = denseSnapshotRange(store, source);
  const targetEnd: RangeAddress = { r1: target.r1, c1: target.c1, r2: target.r1 + srcRows - 1, c2: target.c1 + srcCols - 1 };
  for (let r = 0; r < srcRows; r += 1) {
    for (let c = 0; c < srcCols; c += 1) {
      store.setCell(target.r1 + r, target.c1 + c, cloneCell(sourceSnapshot[r]?.[c]));
    }
  }
  if (!copy) {
    for (let r = source.r1; r <= source.r2; r += 1) {
      for (let c = source.c1; c <= source.c2; c += 1) {
        const inTarget = r >= targetEnd.r1 && r <= targetEnd.r2 && c >= targetEnd.c1 && c <= targetEnd.c2;
        if (!inTarget) store.setCell(r, c, undefined);
      }
    }
  }
  const sourceMerges: string[] = [];
  const targetMerges = store.getMerges().filter((m) => rangesIntersect(parseMerge(m), targetEnd));
  const moved: string[] = [];
  for (const m of store.getMerges()) {
    const a = parseMerge(m);
    if (source.r1 <= a.r1 && source.c1 <= a.c1 && source.r2 >= a.r2 && source.c2 >= a.c2) {
      sourceMerges.push(m);
      moved.push(mergeToString({ r1: a.r1 - source.r1 + target.r1, c1: a.c1 - source.c1 + target.c1, r2: a.r2 - source.r1 + target.r1, c2: a.c2 - source.c1 + target.c1 }));
    }
  }
  store.batch(() => {
    targetMerges.forEach((m) => store.removeMerge(m));
    if (!copy) sourceMerges.forEach((m) => store.removeMerge(m));
    moved.forEach((m) => { if (!store.getMerges().includes(m)) store.addMerge(m); });
  });
}

/** Old dense merge: snapshot every cell, clear covered non-anchor cells. */
function denseMerge(store: Store, target: RangeAddress): { readonly cells: Array<readonly [number, number, Cell | undefined]>; readonly merges: readonly string[] } {
  const cells: Array<readonly [number, number, Cell | undefined]> = [];
  for (let r = target.r1; r <= target.r2; r += 1) {
    for (let c = target.c1; c <= target.c2; c += 1) cells.push([r, c, store.getCell(r, c)]);
  }
  const merges = store.getMerges().filter((m) => rangesIntersect(parseMerge(m), target));
  for (const m of store.getMerges()) {
    if (rangesIntersect(parseMerge(m), target)) store.removeMerge(m);
  }
  for (let r = target.r1; r <= target.r2; r += 1) {
    for (let c = target.c1; c <= target.c2; c += 1) {
      if (r === target.r1 && c === target.c1) continue;
      if (store.getCell(r, c) !== undefined) store.setCell(r, c, undefined);
    }
  }
  store.addMerge(mergeToString(target));
  return { cells, merges };
}

/** Old dense merge undo. */
function denseMergeUndo(store: Store, snapshot: { readonly cells: Array<readonly [number, number, Cell | undefined]>; readonly merges: readonly string[] }): void {
  store.batch(() => {
    snapshot.cells.forEach(([r, c]) => {
      const merge = store.getMergeAt(r, c);
      if (merge !== undefined) store.removeMerge(merge);
    });
    snapshot.merges.forEach((m) => { if (!store.getMerges().includes(m)) store.addMerge(m); });
    snapshot.cells.forEach(([r, c, cell]) => store.setCell(r, c, cell));
  });
}

/** Old dense remove-duplicates: keys for every row in [r1..r2], one full shift per deleted row. */
function denseRemoveDuplicates(store: Store, args: { r1: number; c1: number; r2: number; c2: number; columns: readonly number[]; hasHeader: boolean }): number {
  const { r1, c1, r2, c2, columns, hasHeader } = args;
  if (columns.length === 0 || r2 < r1 || c2 < c1) return 0;
  const getText = (r: number, c: number): string => {
    const cell = store.getCell(r, c);
    if (cell?.value !== undefined && cell.value !== null && typeof cell.value !== 'object') return String(cell.value);
    return cell?.text ?? '';
  };
  const keys: string[][] = [];
  for (let r = r1; r <= r2; r += 1) keys.push(columns.map((ci) => getText(r, c1 + ci)));
  const seen = new Set<string>();
  const dupRel: number[] = [];
  for (let i = hasHeader ? 1 : 0; i < keys.length; i += 1) {
    const key = keys[i]!.map((v) => v.toLowerCase()).join('\u0001');
    if (seen.has(key)) dupRel.push(i);
    else seen.add(key);
  }
  const absRows = dupRel.map((i) => r1 + i).sort((a, b) => b - a);
  for (const r of absRows) denseDeleteOneRow(store, r);
  return absRows.length;
}

function denseDeleteOneRow(store: Store, start: number): void {
  store.getCells().forEach(([key]) => {
    const [r, c] = parseKey(key);
    if (r >= start && r < start + 1) store.setCell(r, c, undefined);
  });
  const cells = store.getCells().map(([key, cell]) => [...parseKey(key), cell] as const);
  cells.filter(([r]) => r >= start + 1).sort((a, b) => a[0] - b[0]).forEach(([r, c, cell]) => {
    store.setCell(r, c, undefined);
    store.setCell(r - 1, c, cell);
  });
  const rows = store.getRowEntries().filter(([r]) => r >= start).sort((a, b) => a[0] - b[0]);
  for (const [r, meta] of rows) {
    if (r >= start + 1) store.setRow(r - 1, meta);
    store.setRow(r, undefined);
  }
  // merges shift up by one for rows below `start`
  const shifted = store.getMerges().map((m) => {
    const a = parseMerge(m);
    if (a.r2 < start) return m;
    if (a.r1 > start) return mergeToString({ ...a, r1: a.r1 - 1, r2: a.r2 - 1 });
    const n1 = a.r1 < start ? a.r1 : start;
    const n2 = a.r2 <= start ? start - 1 : a.r2 - 1;
    return n2 < n1 ? null : mergeToString({ ...a, r1: n1, r2: n2 });
  }).filter((m): m is string => m !== null);
  store.batch(() => {
    store.getMerges().forEach((m) => store.removeMerge(m));
    shifted.forEach((m) => store.addMerge(m));
  });
}

/** Old dense copy-fill reference (copy mode: tile the source over the target). */
function denseFillCopy(store: Store, source: RangeAddress, target: RangeAddress): void {
  const srcLen = source.c2 - source.c1 + 1;
  for (let r = target.r1; r <= target.r2; r += 1) {
    for (let c = target.c1; c <= target.c2; c += 1) {
      if (r >= source.r1 && r <= source.r2 && c >= source.c1 && c <= source.c2) continue;
      const off = ((c - source.c1) % srcLen + srcLen) % srcLen;
      const src = store.getCell(source.r1, source.c1 + off); // single-row source tiled right
      if (src === undefined) continue;
      // Straight copy keeps the source look verbatim (rebuildCell semantics).
      store.setCell(r, c, { ...src });
    }
  }
}

/* ------------------------------------------------------------------ */

describe('differential: sparse commands match the dense reference implementations', () => {
  it('MoveRange (move and copy, overlaps, merges) matches the dense reference', () => {
    const rand = mulberry32(1234);
    for (let trial = 0; trial < 30; trial += 1) {
      const rows = 20 + Math.floor(rand() * 12);
      const cols = 3 + Math.floor(rand() * 4);
      const specs = randomTable(rand, rows, cols);
      const storeA = storeFrom(specs);
      const storeB = storeFromCopy(specs);
      // merges on both
      const m1: RangeAddress = { r1: 1, c1: 0, r2: 2, c2: 1 };
      storeA.addMerge(mergeToString(m1));
      storeB.addMerge(mergeToString(m1));
      const source: RangeAddress = { r1: Math.floor(rand() * 8), c1: 0, r2: Math.floor(rand() * 8) + 8, c2: 1 + Math.floor(rand() * 2) };
      const target: RangeAddress = {
        r1: Math.floor(rand() * 14),
        c1: Math.floor(rand() * 2),
        r2: 0,
        c2: 0,
      };
      const fixedTarget: RangeAddress = {
        r1: target.r1,
        c1: target.c1,
        r2: target.r1 + (source.r2 - source.r1),
        c2: target.c1 + (source.c2 - source.c1),
      };
      const copy = rand() < 0.4;
      const cmA = new CommandManager(storeA);
      const cmdA = new MoveRange({ source, target: fixedTarget, ...(copy ? { copy } : {}) });
      run(cmA, cmdA);
      const preB = canonical(storeB);
      denseMoveRange(storeB, source, fixedTarget, copy);
      expect(canonical(storeA)).toEqual(canonical(storeB));
      run(cmA, cmdA.getUndo());
      expect(canonical(storeA)).toEqual(preB); // undo restores the shared pre-state
    }
  });

  it('SetMerge (plain merge + unmerge) matches the dense reference', () => {
    const rand = mulberry32(777);
    for (let trial = 0; trial < 25; trial += 1) {
      const rows = 16 + Math.floor(rand() * 10);
      const cols = 2 + Math.floor(rand() * 4);
      const specs = randomTable(rand, rows, cols);
      const storeA = storeFrom(specs);
      const storeB = storeFromCopy(specs);
      const tR1 = Math.floor(rand() * 6);
      const tC2 = Math.floor(rand() * (cols - 1));
      const target: RangeAddress = { r1: tR1, c1: 0, r2: tR1 + 2 + Math.floor(rand() * 8), c2: tC2 };
      const cmA = new CommandManager(storeA);
      const cmd = new SetMerge({ range: mergeToString(target), active: true });
      run(cmA, cmd);
      const preB = canonical(storeB);
      const snapshot = denseMerge(storeB, target);
      expect(canonical(storeA)).toEqual(canonical(storeB));
      run(cmA, cmd.getUndo());
      denseMergeUndo(storeB, snapshot);
      expect(canonical(storeA)).toEqual(canonical(storeB));
      expect(canonical(storeA)).toEqual(preB);
    }
  });

  it('SortRange undo/redo round-trips against a dense twin (same sort engine, sparse snapshots)', () => {
    const rand = mulberry32(4242);
    for (let trial = 0; trial < 25; trial += 1) {
      const rows = 18 + Math.floor(rand() * 12);
      const cols = 2 + Math.floor(rand() * 4);
      const specs = randomTable(rand, rows, cols);
      const storeA = storeFrom(specs);
      const storeB = storeFromCopy(specs);
      const direction: 'asc' | 'desc' = rand() < 0.5 ? 'asc' : 'desc';
      const sortCol = Math.floor(rand() * cols);
      const r1 = Math.floor(rand() * 4);
      const r2 = rows - 1 - Math.floor(rand() * 4);
      const args = { r1, c1: 0, r2, c2: cols - 1, sortCol, direction };
      const before = canonical(storeA);
      const cmA = new CommandManager(storeA);
      const cmd = new SortRangeCommand(args);
      run(cmA, cmd);
      // Twin: the sort engine applied directly (dense writes), no snapshot layer.
      sortRowsInPlace(storeB, r1, 0, r2, cols - 1, sortCol, direction);
      expect(canonical(storeA)).toEqual(canonical(storeB));
      run(cmA, cmd.getUndo());
      expect(canonical(storeA)).toEqual(before);
    }
  });

  it('RemoveDuplicates matches the dense reference, including empty-key rows in the span', () => {
    const rand = mulberry32(90210);
    for (let trial = 0; trial < 25; trial += 1) {
      const rows = 14 + Math.floor(rand() * 10);
      const specs = randomTable(rand, rows, 2, 0);
      // Remove Duplicates walks rows that exist: give every row of the span
      // a stored cell (col 1, outside the key column) so the dense and sparse
      // key sequences line up row for row. Fully-empty rows are address
      // space, not data — the sparse command rightly ignores them, and the
      // dense reference here has no opinion on them either.
      const present = new Set(specs.map(({ r }) => r));
      for (let r = 0; r < rows; r += 1) {
        if (!present.has(r)) specs.push({ r, c: 1, cell: { text: 'x' } });
      }
      specs.sort((a, b) => a.r - b.r || a.c - b.c);
      // Force shared texts so duplicates (incl. rows empty in the key column) show up.
      const sparseA = specs.map(({ r, c, cell }) => ({ r, c, cell: { ...cell, text: cell.text.length === 0 ? '' : (r % 4 === 0 ? 'dup' : cell.text) } }));
      const storeA = storeFrom(sparseA);
      const storeB = storeFromCopy(sparseA);
      const r2 = rows - 1;
      const args = { r1: 0, c1: 0, r2, c2: 0, columns: [0], hasHeader: rand() < 0.3 };
      const cmA = new CommandManager(storeA);
      const cmd = new RemoveDuplicatesCommand(args);
      run(cmA, cmd);
      const preB = canonical(storeB);
      denseRemoveDuplicates(storeB, args);
      expect(canonical(storeA)).toEqual(canonical(storeB));
      run(cmA, cmd.getUndo());
      expect(canonical(storeA)).toEqual(preB);
    }
  });

  it('copy fill matches the dense tiling reference and undo restores', () => {
    const rand = mulberry32(31337);
    for (let trial = 0; trial < 20; trial += 1) {
      const rows = 12 + Math.floor(rand() * 8);
      const specs = randomTable(rand, rows, 2, 0);
      const storeA = storeFrom(specs);
      const storeB = storeFromCopy(specs);
      const source: RangeAddress = { r1: 0, c1: 0, r2: 0, c2: 0 };
      const len = 1 + Math.floor(rand() * 3);
      const target: RangeAddress = { r1: 0, c1: 0, r2: 0, c2: source.c2 + len * 2 };
      const cmA = new CommandManager(storeA);
      const cmd = new FillRangeCommand({ source, target, copy: true });
      run(cmA, cmd);
      const preB = canonical(storeB);
      denseFillCopy(storeB, source, target);
      expect(canonical(storeA)).toEqual(canonical(storeB));
      run(cmA, cmd.getUndo());
      expect(canonical(storeA)).toEqual(preB);
    }
  });
});

/* Formula cells survive the sparse paths unchanged (MoveRange never rewrote
 * references — the text travels verbatim, undo restores it). */
describe('formula cells survive the sparse paths', () => {
  it('moving a formula cell travels verbatim and undo restores it', () => {
    const store = new Store();
    store.setCell(0, 1, { text: '7', value: 7 });
    store.setCell(1, 0, { text: '', formula: '=B1*2' });
    const cm = new CommandManager(store);
    const cmd = new MoveRange({ source: { r1: 1, c1: 0, r2: 1, c2: 0 }, target: { r1: 3, c1: 0, r2: 3, c2: 0 } });
    run(cm, cmd);
    expect(store.getCell(3, 0)?.formula).toBe('=B1*2');
    expect(store.getCell(1, 0)).toBeUndefined();
    run(cm, cmd.getUndo());
    expect(store.getCell(1, 0)?.formula).toBe('=B1*2');
    expect(store.getCell(3, 0)).toBeUndefined();
    expect(shiftFormula('=A1', 1, 0)).toBe('=A2');
  });
});
