import { describe, expect, it } from 'vitest';
import { shiftSheetSparklines, shiftSparklineSpec } from '../../src/sparkline/shift';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

import type { SparklineSpec } from '../../src/sparkline/types';

const spec = (over: Partial<SparklineSpec> = {}): SparklineSpec => ({
  id: 'spark-1',
  type: 'line',
  range: '2,1:6,3',
  row: 8,
  col: 5,
  ...over,
});

describe('shiftSparklineSpec', () => {
  it('insert: host cell shifts, range grows at shifted endpoints only', () => {
    // Range rows 2..6 with an insert at 4: endpoint 2 stays, endpoint 6 moves by 2.
    expect(shiftSparklineSpec(spec(), 'insert', 'row', 4, 2)).toEqual({ id: 'spark-1', type: 'line', range: '2,1:8,3', row: 10, col: 5 });
    expect(shiftSparklineSpec(spec(), 'insert', 'col', 1, 1)).toEqual({ id: 'spark-1', type: 'line', range: '2,2:6,4', row: 8, col: 6 });
  });

  it('insert: host cell or range above the start stays; no-op returns the same object', () => {
    const s = spec({ row: 1, range: '0,0:3,2' });
    expect(shiftSparklineSpec(s, 'insert', 'row', 900, 1)).toBe(s);
  });

  it('insert: a host pushed past the grid edge is removed', () => {
    expect(shiftSparklineSpec(spec({ row: TOTAL_ROWS - 1 }), 'insert', 'row', TOTAL_ROWS - 1, 1)).toBeNull();
    expect(shiftSparklineSpec(spec({ col: TOTAL_COLS - 1 }), 'insert', 'col', TOTAL_COLS - 1, 1)).toBeNull();
  });

  it('delete: a host inside the deleted band is removed', () => {
    expect(shiftSparklineSpec(spec({ row: 5 }), 'delete', 'row', 4, 3)).toBeNull();
    expect(shiftSparklineSpec(spec({ col: 2 }), 'delete', 'col', 2, 1)).toBeNull();
  });

  it('delete: host below the band slides up and the range shrinks', () => {
    // Range rows 2..6 overlap the deleted rows 4..5: clamped into the zone start.
    expect(shiftSparklineSpec(spec(), 'delete', 'row', 4, 2)).toEqual({ id: 'spark-1', type: 'line', range: '2,1:4,3', row: 6, col: 5 });
  });

  it('delete: a range fully inside the deleted band removes the sparkline', () => {
    expect(shiftSparklineSpec(spec({ row: 0, range: '4,1:6,3' }), 'delete', 'row', 4, 3)).toBeNull();
  });
});

describe('shiftSheetSparklines applies insert/delete to the sheet', () => {
  it('moves, drops, and keeps sparklines per their position', () => {
    const store = new Store();
    store.addSparkline(spec({ id: 'above', row: 1, range: '0,0:3,2' }));
    store.addSparkline(spec({ id: 'host', row: 5 }));
    store.addSparkline(spec({ id: 'below', row: 9 }));
    shiftSheetSparklines(store, 'delete', 'row', 5, 1); // delete row 5
    const byId = new Map(store.getSparklines().map((s) => [s.id, s]));
    expect(byId.has('host')).toBe(false); // host cell deleted
    expect(byId.get('above')?.row).toBe(1);
    expect(byId.get('below')?.row).toBe(8);
    expect(byId.get('below')?.range).toBe('2,1:5,3'); // range endpoint 6 slides up over the deleted row
  });
});

describe('structural commands move sparklines and undo restores them', () => {
  it('InsertRow shifts position and range; undo restores both; redo shifts again', () => {
    const store = new Store();
    store.addSparkline(spec({ id: 'spark-1', row: 8, range: '2,1:6,3' }));
    const original = store.getSparklines()[0];
    const cmd = new InsertRowCommand({ r: 4 });
    cmd.execute(store);
    const moved = store.getSparklines()[0]!;
    expect(moved.row).toBe(9);
    expect(moved.range).toBe('2,1:7,3'); // endpoint 2 stays, endpoint 6 moves
    cmd.getUndo().execute(store);
    expect(store.getSparklines()[0]).toEqual(original);
    cmd.execute(store); // redo
    expect(store.getSparklines()[0]).toEqual(moved);
  });

  it('DeleteRow removes a sparkline sitting in the deleted row; undo brings it back', () => {
    const store = new Store();
    store.addSparkline(spec({ id: 'doomed', row: 6, range: '0,0:2,2' }));
    store.addSparkline(spec({ id: 'survivor', row: 9, range: '0,0:2,2' }));
    const original = store.getSparklines();
    const cmd = new DeleteRowCommand({ r: 6 });
    cmd.execute(store);
    const ids = store.getSparklines().map((s) => s.id);
    expect(ids).toEqual(['survivor']);
    expect(store.getSparklines()[0]?.row).toBe(8);
    cmd.getUndo().execute(store);
    expect(store.getSparklines()).toEqual(original);
  });
});
