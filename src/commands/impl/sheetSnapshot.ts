import { TOTAL_COLS, TOTAL_ROWS } from '../../renderer/CanvasRenderer';

import type { Store } from '../../store/Store';
import type { Cell, ColMeta, RowMeta } from '../../types';

export interface SheetSnapshot {
  readonly cells: ReadonlyArray<readonly [number, number, Cell]>;
  readonly rows: ReadonlyArray<readonly [number, RowMeta]>;
  readonly cols: ReadonlyArray<readonly [number, ColMeta]>;
  readonly merges: readonly string[];
}

export function captureSheet(store: Store): SheetSnapshot {
  return {
    cells: store.getCells().map(([key, cell]) => [...parseKey(key), cell] as const),
    rows: collectRows(store),
    cols: collectCols(store),
    merges: store.getMerges(),
  };
}

export function restoreSheet(store: Store, snapshot: SheetSnapshot): void {
  store.getCells().forEach(([key]) => {
    const [r, c] = parseKey(key);
    store.setCell(r, c, undefined);
  });
  for (let r = 0; r < TOTAL_ROWS; r += 1) store.setRow(r, undefined);
  for (let c = 0; c < TOTAL_COLS; c += 1) store.setCol(c, undefined);
  store.getMerges().forEach((range) => store.removeMerge(range));
  snapshot.cells.forEach(([r, c, cell]) => store.setCell(r, c, cell));
  snapshot.rows.forEach(([r, meta]) => store.setRow(r, meta));
  snapshot.cols.forEach(([c, meta]) => store.setCol(c, meta));
  snapshot.merges.forEach((range) => store.addMerge(range));
}

export function parseKey(key: string): readonly [number, number] {
  const [row, col] = key.split(',');
  if (row === undefined || col === undefined) throw new Error(`Invalid cell key: ${key}`);
  return [Number.parseInt(row, 10), Number.parseInt(col, 10)];
}

function collectRows(store: Store): ReadonlyArray<readonly [number, RowMeta]> {
  const rows: Array<readonly [number, RowMeta]> = [];
  for (let r = 0; r < TOTAL_ROWS; r += 1) {
    const meta = store.getRow(r);
    if (meta !== undefined) rows.push([r, meta]);
  }
  return rows;
}

function collectCols(store: Store): ReadonlyArray<readonly [number, ColMeta]> {
  const cols: Array<readonly [number, ColMeta]> = [];
  for (let c = 0; c < TOTAL_COLS; c += 1) {
    const meta = store.getCol(c);
    if (meta !== undefined) cols.push([c, meta]);
  }
  return cols;
}
