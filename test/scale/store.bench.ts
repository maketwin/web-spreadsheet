import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { InsertColCommand } from '../../src/commands/impl/InsertCol';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { SetNumberFormatCommand } from '../../src/commands/impl/SetNumberFormat';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { clearRange } from '../../src/commands/rangeValues';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';
import { recorder, report, rng, type Recorder } from './harness';

/**
 * Experiment 1 — one sheet with a million cells, in two shapes: one long
 * column (1,000,000 × 1) and one wide block (100,000 × 10). Everything is
 * driven through the public Store / CommandManager exactly as the UI drives it.
 *
 * The numbers are the point of this file: run `pnpm bench:scale` and read the
 * table. The assertions only fail on a catastrophic regression (ten times the
 * target), so a slow machine does not turn the experiment red.
 */
const SHAPES = [
  { name: 'single column 1,000,000 x 1', rows: 1_000_000, cols: 1, sort: false },
  { name: 'wide block 100,000 x 10', rows: 100_000, cols: 10, sort: true },
] as const;

const WHOLE_COLUMN = { r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: 0 };
const WHOLE_SHEET = { r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1 };

/** Target is what we aim for; the test fails only beyond ten times it. */
function within(sample: { label: string; ms: number }, targetMs: number): void {
  if (sample.ms <= targetMs * 10) return;
  throw new Error(`${sample.label}: ${sample.ms.toFixed(0)} ms is more than 10x the ${targetMs} ms target`);
}

function fill(store: Store, rows: number, cols: number): void {
  const random = rng(20261125);
  store.batch(() => {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const v = Math.floor(random() * 1_000_000);
        store.setCell(r, c, { text: String(v), value: v });
      }
    }
  });
}

describe.each(SHAPES)('scale: $name', (shape) => {
  const rec = recorder();
  const store = new Store();
  const cm = new CommandManager(store);
  const run = cm.execute.bind(cm);
  let cellsPerShape = 0;

  it('holds the data', () => {
    rec.time('fill one million cells (store.batch)', () => fill(store, shape.rows, shape.cols));
    cellsPerShape = store.getCellCount();
    expect(cellsPerShape).toBe(shape.rows * shape.cols);
    expect(store.getUsedBounds()).toEqual({ r1: 0, c1: 0, r2: shape.rows - 1, c2: shape.cols - 1 });
    within(rec.samples[0]!, 1_500);
  });

  it('walks only what exists', () => {
    const all = rec.time('forEachCell over every cell', () => { let n = 0; store.forEachCell(() => { n += 1; }); return n; });
    expect(all).toBe(cellsPerShape);
    within(rec.samples.at(-1)!, 60);
    const corner = rec.time('forEachCellInRect 10x10 at the last rows', () => {
      let n = 0;
      store.forEachCellInRect({ r1: shape.rows - 10, c1: 0, r2: shape.rows - 1, c2: Math.min(9, shape.cols - 1) }, () => { n += 1; });
      return n;
    });
    expect(corner).toBe(10 * Math.min(10, shape.cols));
    within(rec.samples.at(-1)!, 2);
  });

  it('serializes and reloads', () => {
    const serialized = rec.time('serialize', () => store.serialize());
    within(rec.samples.at(-1)!, 400);
    const reloaded = rec.time('Store.deserialize', () => Store.deserialize(serialized));
    within(rec.samples.at(-1)!, 1_200);
    rec.time('replaceAll on a live store', () => store.replaceAll(reloaded.serialize()));
    within(rec.samples.at(-1)!, 1_500);
    expect(store.getCellCount()).toBe(cellsPerShape);
    rec.time('copySheet', () => {
      const id = store.copySheet('sheet-1', { name: 'copy' });
      if (id !== undefined) store.deleteSheet(id);
    });
    within(rec.samples.at(-1)!, 1_500);
    cm.clear();
  });

  it('inserts and deletes rows', () => {
    let cellEvents = 0;
    let structureEvents = 0;
    const off = store.subscribe((e) => {
      if (e.type === 'cell') cellEvents += 1;
      if (e.type === 'structure') structureEvents += 1;
    });
    rec.time('insert 1 row at the top', () => run(new InsertRowCommand({ r: 0 })));
    within(rec.samples.at(-1)!, 350);
    rec.time('… undo', () => cm.undo());
    within(rec.samples.at(-1)!, 350);
    rec.time('… redo', () => cm.redo());
    within(rec.samples.at(-1)!, 350);
    off();
    // One structure event per move (insert, undo, redo); per-cell events only
    // for rewritten formulas, and this sheet holds none.
    expect(structureEvents).toBe(3);
    expect(cellEvents).toBeLessThanOrEqual(10);
    rec.time('insert 1 row in the middle', () => run(new InsertRowCommand({ r: Math.floor(shape.rows / 2) })));
    within(rec.samples.at(-1)!, 350);
    cm.undo();
    rec.time('delete 1 row at the top', () => run(new DeleteRowCommand({ r: 0 })));
    within(rec.samples.at(-1)!, 350);
    rec.time('… undo', () => cm.undo());
    within(rec.samples.at(-1)!, 350);
    expect(store.getCellCount()).toBe(cellsPerShape);
    cm.clear();
  });

  it('inserts and deletes a column', () => {
    rec.time('insert 1 column at the left', () => run(new InsertColCommand({ c: 0 })));
    within(rec.samples.at(-1)!, 350);
    rec.time('… undo', () => cm.undo());
    within(rec.samples.at(-1)!, 350);
    rec.time('delete the first column', () => run(new DeleteColCommand({ c: 0 })));
    within(rec.samples.at(-1)!, 350);
    rec.time('… undo', () => cm.undo());
    within(rec.samples.at(-1)!, 350);
    expect(store.getCellCount()).toBe(cellsPerShape);
    cm.clear();
  });

  it('formats a whole column without touching the address space', () => {
    rec.time('bold on column A (whole-column selection)', () => run(new SetRangeStyleCommand({ ...WHOLE_COLUMN, style: { bold: true } })));
    within(rec.samples.at(-1)!, 1_500);
    rec.time('… undo', () => cm.undo());
    within(rec.samples.at(-1)!, 1_500);
    rec.time('number format on column A', () => run(new SetNumberFormatCommand({ ...WHOLE_COLUMN, numberFormat: '#,##0' })));
    within(rec.samples.at(-1)!, 1_500);
    rec.time('… undo', () => cm.undo());
    within(rec.samples.at(-1)!, 1_500);
    expect(store.getCellCount()).toBe(cellsPerShape);
    cm.clear();
  });

  it('sorts, clears and restores', () => {
    if (shape.sort) {
      rec.time('sort the whole used block by column A, descending', () => run(new SortRangeCommand({ r1: 0, c1: 0, r2: shape.rows - 1, c2: shape.cols - 1, sortCol: 0, direction: 'desc' })));
      within(rec.samples.at(-1)!, 3_000);
      rec.time('… undo', () => cm.undo());
      within(rec.samples.at(-1)!, 3_000);
      expect(store.getCellCount()).toBe(cellsPerShape);
    }
    rec.time('clear column A (whole-column selection)', () => clearRange(store, cm, WHOLE_COLUMN));
    within(rec.samples.at(-1)!, 1_500);
    rec.time('… undo', () => cm.undo());
    within(rec.samples.at(-1)!, 1_500);
    rec.time('clear everything (select all)', () => clearRange(store, cm, WHOLE_SHEET));
    within(rec.samples.at(-1)!, 4_000);
    expect(store.getCellCount()).toBe(0);
    rec.time('… undo', () => cm.undo());
    within(rec.samples.at(-1)!, 4_000);
    expect(store.getCellCount()).toBe(cellsPerShape);
    cm.clear();
  });

  it('prints the results', () => {
    const samples = report(`experiment 1 · ${shape.name}`, rec as Recorder);
    mkdirSync('coverage/scale-bench', { recursive: true });
    writeFileSync(`coverage/scale-bench/store-${shape.cols === 1 ? 'column' : 'block'}.json`, JSON.stringify(samples, null, 2));
  });
});
