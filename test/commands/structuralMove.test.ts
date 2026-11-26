import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

import type { Cell, StoreEvent } from '../../src/types';
import type { Command } from '../../src/commands/Command';

/** Full cell-content equality without building million-entry string-key
 * arrays (serialize() at this size OOMs the worker): sweep both stores,
 * compare text/formula/value per key. */
function sameCells(a: Store, b: Store, sid: string): string | null {
  if (a.getCellCount(sid) !== b.getCellCount(sid)) {
    return `count mismatch: ${a.getCellCount(sid)} vs ${b.getCellCount(sid)}`;
  }
  const signature = (cell: Cell): string => `${cell.text}\u0000${cell.formula ?? ''}\u0000${String(cell.value)}`;
  const seen = new Map<number, string>();
  a.forEachCell((r, c, cell) => {
    seen.set(r * TOTAL_COLS + c, signature(cell));
  }, sid);
  let firstDiff = '';
  b.forEachCell((r, c, cell) => {
    const key = r * TOTAL_COLS + c;
    if (firstDiff === '' && seen.get(key) !== signature(cell)) {
      firstDiff = `first diff at ${r},${c}: a=${seen.get(key) ?? '<absent>'} b=${signature(cell)}`;
      writeFileSync('/tmp/structural-move-diff.txt', `${firstDiff}\n`);
    }
    seen.delete(key);
  }, sid);
  if (firstDiff !== '') return firstDiff;
  if (seen.size > 0) return `unmatched in a at: ${[...seen.keys()].slice(0, 3).map((k) => `${Math.floor(k / TOTAL_COLS)},${k % TOTAL_COLS}`).join(' ')}`;
  return null;
}

/**
 * The pre-change reference: collect the moving half-plane, then per-cell
 * delete-and-write through store.setCell (drop spill shadows; cells pushed
 * off the grid are dropped) — exactly what the structural commands did
 * before the bulk primitives existed.
 */
function referenceMove(store: Store, sheetId: string, axis: 'row' | 'col', kind: 'insert' | 'delete', start: number, count: number): void {
  const limit = axis === 'row' ? TOTAL_ROWS : TOTAL_COLS;
  const delta = kind === 'delete' ? -count : count; // delete moves the half-plane up/left
  const moving: Array<[number, number, Cell]> = [];
  const band: Array<[number, number]> = [];
  store.forEachCell((r, c, cell) => {
    const at = axis === 'row' ? r : c;
    if (kind === 'delete' && at >= start && at < start + count) {
      band.push([r, c]);
      return;
    }
    if (at >= start) moving.push([r, c, cell]);
  }, sheetId);
  const receives = new Set<number>();
  for (const [r, c, cell] of moving) {
    const at = axis === 'row' ? r : c;
    const nextAt = at + delta;
    if (nextAt >= limit || nextAt < 0 || cell.spillOf !== undefined) continue;
    receives.add(axis === 'row' ? nextAt * TOTAL_COLS + c : r * TOTAL_COLS + nextAt);
  }
  // Order matters: the deleted band clears FIRST, then movers clear their
  // non-receiving origins and write their targets (order-independent — a
  // target may be a cleared band row).
  for (const [r, c] of band) store.setCell(r, c, undefined, sheetId);
  for (const [r, c, cell] of moving) {
    const key = r * TOTAL_COLS + c;
    if (!receives.has(key)) store.setCell(r, c, undefined, sheetId);
    const at = axis === 'row' ? r : c;
    const nextAt = at + delta;
    if (nextAt >= limit || nextAt < 0 || cell.spillOf !== undefined) continue;
    if (axis === 'row') store.setCell(nextAt, c, cell, sheetId);
    else store.setCell(r, nextAt, cell, sheetId);
  }
}

function fixture(shape: 'column' | 'grid'): { store: Store; sid: string } {
  const store = new Store();
  const sid = store.getActiveSheetId();
  if (shape === 'column') {
    for (let r = 0; r < 1_000_000; r += 1) store.setCell(r, 0, { text: String(r), value: r }, sid);
  } else {
    for (let r = 0; r < 100_000; r += 1) {
      for (let c = 0; c < 10; c += 1) store.setCell(r, c, { text: `${r}:${c}`, value: r * 10 + c }, sid);
    }
  }
  return { store, sid };
}

describe('structural move primitives match the per-cell reference', () => {
  const shapes: Array<'column' | 'grid'> = ['column', 'grid'];
  for (const shape of shapes) {
    it(`${shape}: insertRows`, () => {
      const a = fixture(shape);
      const b = fixture(shape);
      a.store.insertRows(1000, 3, a.sid);
      referenceMove(b.store, b.sid, 'row', 'insert', 1000, 3);
      expect(sameCells(a.store, b.store, a.sid)).toBeNull();
    }, 120_000);

    it(`${shape}: deleteRows`, () => {
      const a = fixture(shape);
      const b = fixture(shape);
      a.store.deleteRows(1000, 5, a.sid);
      referenceMove(b.store, b.sid, 'row', 'delete', 1000, 5);
      expect(sameCells(a.store, b.store, a.sid)).toBeNull();
    }, 120_000);

    it(`${shape}: insertCols`, () => {
      const a = fixture(shape);
      const b = fixture(shape);
      a.store.insertCols(3, 2, a.sid);
      referenceMove(b.store, b.sid, 'col', 'insert', 3, 2);
      expect(sameCells(a.store, b.store, a.sid)).toBeNull();
    }, 120_000);

    it(`${shape}: deleteCols`, () => {
      const a = fixture(shape);
      const b = fixture(shape);
      a.store.deleteCols(1, 2, a.sid);
      referenceMove(b.store, b.sid, 'col', 'delete', 1, 2);
      expect(sameCells(a.store, b.store, a.sid)).toBeNull();
    }, 120_000);
  }

  it('exactly one structure event and no cell events per move; bulkSetCells emits one cells event', () => {
    const { store, sid } = fixture('column');
    const events: StoreEvent[] = [];
    const off = store.subscribe((e) => events.push(e));
    const dropped = store.insertRows(0, 2, sid);
    store.deleteRows(0, 2, sid);
    store.bulkSetCells(dropped, sid);
    off();
    expect(events.filter((e) => e.type === 'structure')).toHaveLength(2); // insert + delete
    expect(events.filter((e) => e.type === 'cells')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'cell')).toHaveLength(0);
    expect(sameCells(store, fixture('column').store, sid)).toBeNull(); // back to the start
  }, 120_000);

  it('spill shadows are dropped by the move, anchors and plain cells travel', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    store.setCell(0, 0, { text: '1', value: 1, formula: '=A1' }, sid);
    store.setCell(1, 0, { text: 's', value: 's', spillOf: `${sid}:0,0` }, sid);
    store.setCell(2, 0, { text: 's', value: 's', spillOf: `${sid}:0,0` }, sid);
    const dropped = store.insertRows(0, 1, sid);
    expect(dropped).toHaveLength(2); // the two shadows: dropped, not transported
    // Shadows never travel: no spillOf cell anywhere after the move.
    for (const [, cell] of store.getCells(sid)) expect(cell.spillOf).toBeUndefined();
    // The plain cells moved down with their row.
    expect(store.getCell(1, 0, sid)?.value).toBe(1);
  });

  it('cells pushed off the grid come back through bulkSetCells', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    for (let r = 0; r < TOTAL_ROWS; r += 1) store.setCell(r, 0, { text: String(r), value: r }, sid);
    const dropped = store.insertRows(0, 10, sid);
    expect(dropped).toHaveLength(10); // the bottom 10 rows fell off the fixed grid
    expect(store.getCell(1_048_575, 0, sid)?.value).toBe(1_048_565);
    // Undo shape: remove the inserted band, put the dropped cells back.
    store.deleteRows(0, 10, sid);
    store.bulkSetCells(dropped, sid);
    for (let r = 0; r < TOTAL_ROWS; r += 1) expect(store.getCell(r, 0, sid)?.value).toBe(r);
    expect(store.getCellCount(sid)).toBe(TOTAL_ROWS);
  }, 120_000);

  it('an undo command built from a million-cell insert keeps a constant-weight record', async () => {
    const { InsertRowCommand } = await import('../../src/commands/impl/InsertRow');
    const store = fixture('column').store;
    const cmd = new InsertRowCommand({ r: 0 }) as Command & { historyWeight(): number };
    // The engine/sync is not attached here; the command still records only
    // its own light payload.
    cmd.execute.bind(cmd)(store);
    expect(cmd.historyWeight()).toBeLessThan(100); // dropped(1) + features + metadata, independent of 1M moved cells
    cmd.getUndo().execute.bind(cmd.getUndo())(store);
    expect(store.getCellCount()).toBe(1_000_000);
  }, 120_000);
});
