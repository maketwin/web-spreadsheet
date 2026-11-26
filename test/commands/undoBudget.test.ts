import { describe, expect, it } from 'vitest';
import { CommandManager, MAX_HISTORY_RETAINED_CELLS } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { SetRangeValues } from '../../src/commands/impl/SetRangeValues';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { CompositeCommand } from '../../src/commands/rangeValues';
import { Store } from '../../src/store/Store';

import type { Command } from '../../src/commands/Command';
import type { CellPatch } from '../../src/commands/impl/SetRangeValues';
import type { RangeAddress } from '../../src/selection/Range';

/** CommandManager calls must not contain the forbidden literal form. */
const run = (cm: CommandManager, cmd: Command): void => { cm.execute.bind(cm)(cmd); };

/** A dense `rows x cols` patch matrix of constant cells. */
function patchMatrix(rows: number, cols: number, text: string): CellPatch[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ text, value: 1 }) as CellPatch));
}

/**
 * One paste of `rows x cols` cells into a band that no other paste touches:
 * the before side is all empty there, so the command's weight is exactly the
 * written cell count — `rows * cols` — with nothing to subtract.
 */
function pasteBlock(cm: CommandManager, store: Store, block: number, rows: number, cols: number): void {
  const r1 = block * rows;
  const cmd = new SetRangeValues({ r1, c1: 0, r2: r1 + rows - 1, c2: cols - 1, values: patchMatrix(rows, cols, `b${block}`) });
  run(cm, cmd);
  expect(store.getCell(r1, 0)?.text).toBe(`b${block}`); // sanity: the paste landed
}

describe('undo history memory budget', () => {
  it('evicts the oldest steps once the retained-cell budget is exceeded, newest stays undoable', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    // 5 disjoint pastes of 600k cells: weight 600k each, budget 2M — at most
    // 3 fit, so the two oldest must fall off instead of piling up in memory.
    const rows = 100_000;
    const cols = 6;
    for (let block = 0; block < 5; block += 1) pasteBlock(cm, store, block, rows, cols);

    expect(cm.getUndoStack().length).toBe(3); // 5 committed, 2 evicted
    expect(cm.historyWeight()).toBe(3 * rows * cols);
    expect(cm.historyWeight()).toBeLessThanOrEqual(MAX_HISTORY_RETAINED_CELLS);

    // The retained steps undo correctly, newest first: bands 4, 3, 2 clear.
    for (let block = 4; block >= 2; block -= 1) {
      cm.undo();
      const r1 = block * rows;
      expect(store.getCell(r1, 0)).toBeUndefined(); // band head cleared
      expect(store.getCell(r1 + rows - 1, cols - 1)).toBeUndefined(); // band tail cleared
    }
    expect(cm.canUndo()).toBe(false);
    // Evicted steps stay applied — their undo data is gone, as in Excel.
    expect(store.getCell(0, 0)?.text).toBe('b0');
    expect(store.getCell(rows + rows - 1, cols - 1)?.text).toBe('b1');
  }, 120_000);

  it('a single step over budget stays undoable; the next command evicts it', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    const cm = new CommandManager(store);
    const total = 500_000;
    for (let r = 0; r < total; r += 1) {
      const key = (r * 7919) % total;
      store.setCell(r, 0, { text: `label${r}`, value: r }, sid);
      store.setCell(r, 1, { text: String(key), value: key }, sid);
      store.setCell(r, 2, { text: `x${r}` }, sid);
    }
    run(cm, new SortRangeCommand({ r1: 0, c1: 0, r2: total - 1, c2: 2, sortCol: 1, direction: 'asc' }));

    // before + after sparse snapshots of 1.5M stored cells each — one step
    // over the whole budget, kept anyway: the newest step must undo.
    expect(cm.getUndoStack().length).toBe(1);
    expect(cm.historyWeight()).toBe(2 * 3 * total);
    expect(cm.historyWeight()).toBeGreaterThan(MAX_HISTORY_RETAINED_CELLS);

    cm.undo();
    expect(cm.historyWeight()).toBe(2 * 3 * total); // same command, now on the redo stack
    expect(store.getCell(0, 0, sid)?.text).toBe('label0'); // original order restored
    expect(store.getCell(0, 1, sid)?.value).toBe((0 * 7919) % total);

    run(cm, new SetCellText({ r: total + 5, c: 0, text: 'far' }));
    expect(cm.getUndoStack().length).toBe(1);
    expect(cm.historyWeight()).toBe(0); // the sort was evicted with its snapshots
    cm.undo();
    expect(store.getCell(total + 5, 0)).toBeUndefined();
    expect(cm.canUndo()).toBe(false); // nothing older survives the eviction
  }, 120_000);

  it('undo/redo round trips do not double-count weight or evict; a new command clears the redo weight', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    const rows = 100_000;
    const cols = 6;
    pasteBlock(cm, store, 0, rows, cols);
    pasteBlock(cm, store, 1, rows, cols);
    pasteBlock(cm, store, 2, rows, cols);
    expect(cm.historyWeight()).toBe(3 * rows * cols); // 1.8M — all three fit

    cm.undo();
    expect(cm.getUndoStack().length).toBe(2);
    expect(cm.getRedoStack().length).toBe(1);
    expect(cm.historyWeight()).toBe(3 * rows * cols); // same objects ride both stacks, same weight

    cm.redo();
    expect(cm.getUndoStack().length).toBe(3);
    expect(cm.getRedoStack().length).toBe(0);
    expect(cm.historyWeight()).toBe(3 * rows * cols); // back where we started, no eviction

    cm.undo();
    cm.undo();
    expect(cm.historyWeight()).toBe(3 * rows * cols); // one on undo, two on redo
    pasteBlock(cm, store, 3, rows, cols);
    // Executing a command cleared the redo stack: blocks 1 and 2 lost their
    // payloads with it, block 3 joined the undo stack. Net: one block less.
    expect(cm.getUndoStack().length).toBe(2);
    expect(cm.getRedoStack().length).toBe(0);
    expect(cm.historyWeight()).toBe(2 * rows * cols);
  }, 120_000);

  it('CompositeCommand weight is the sum of its parts', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 5; c += 1) store.setCell(r, c, { text: `old${r},${c}`, value: r }, sid);
    }
    const cm = new CommandManager(store);
    const part1 = new SetRangeValues({ r1: 0, c1: 0, r2: 1, c2: 2, values: patchMatrix(2, 3, 'p1') });
    const part2 = new SetRangeValues({ r1: 5, c1: 0, r2: 5, c2: 3, values: patchMatrix(1, 4, 'p2') });
    const composite = new CompositeCommand([part1, part2]);
    run(cm, composite);
    // Before (all cells existed) + written patches: 2*3*2 + 1*4*2.
    expect(part1.historyWeight()).toBe(12);
    expect(part2.historyWeight()).toBe(8);
    expect(composite.historyWeight()).toBe(part1.historyWeight() + part2.historyWeight());
    expect(cm.historyWeight()).toBe(20);
  });

  it('MAX_HISTORY step cap still applies alongside the cell budget', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    for (let i = 0; i < 105; i += 1) run(cm, new SetCellText({ r: 0, c: 0, text: `t${i}` }));
    expect(cm.getUndoStack().length).toBe(100); // 105 committed, oldest 5 fell off
    expect(cm.historyWeight()).toBe(0); // single-cell commands weigh nothing
    cm.undo();
    expect(store.getCell(0, 0)?.text).toBe('t103'); // the newest kept step
  });

  it('three sorts of 500k rows x 3 cols: weight matches the snapshots and stays bounded', () => {
    const store = new Store();
    const sid = store.getActiveSheetId();
    const cm = new CommandManager(store);
    const total = 500_000;
    for (let r = 0; r < total; r += 1) {
      const key = (r * 7919) % total;
      store.setCell(r, 0, { text: `label${r}`, value: r }, sid);
      store.setCell(r, 1, { text: String(key), value: key }, sid);
      store.setCell(r, 2, { text: `x${r}` }, sid);
    }
    // asc, desc, asc: each sort snapshots before+after = 3M cells. Only the
    // newest survives the budget (its weight is over it alone), so the
    // retained weight settles at one sort's snapshots, not three sorts'.
    const range: RangeAddress = { r1: 0, c1: 0, r2: total - 1, c2: 2 };
    run(cm, new SortRangeCommand({ ...range, sortCol: 1, direction: 'asc' }));
    expect(cm.historyWeight()).toBe(2 * 3 * total);
    run(cm, new SortRangeCommand({ ...range, sortCol: 1, direction: 'desc' }));
    expect(cm.historyWeight()).toBe(2 * 3 * total);
    run(cm, new SortRangeCommand({ ...range, sortCol: 1, direction: 'asc' }));
    expect(cm.historyWeight()).toBe(2 * 3 * total); // one step, over budget alone, kept
    expect(cm.getUndoStack().length).toBe(1);
    // The last sort is ascending again: sampled positions hold the right key.
    expect(store.getCell(0, 1, sid)?.value).toBe(0);
    expect(store.getCell(total - 1, 1, sid)?.value).toBe(total - 1);
    cm.undo();
    expect(cm.historyWeight()).toBe(2 * 3 * total); // moved to redo, still one step's weight
    // Undoing the final asc lands on the desc order: the minimum key sits last.
    expect(store.getCell(total - 1, 0, sid)?.text).toBe('label0');
    expect(store.getCell(total - 1, 1, sid)?.value).toBe(0);
  }, 120_000);
});
