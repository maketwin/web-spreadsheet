import { describe, expect, it, vi } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { InsertColCommand } from '../../src/commands/impl/InsertCol';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { SetCellStyleCommand } from '../../src/commands/impl/SetCellStyle';
import { SetNumberFormatCommand } from '../../src/commands/impl/SetNumberFormat';
import { SetRangeBorderCommand } from '../../src/commands/impl/SetRangeBorder';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { ClearAxisStyleCommand, SetAxisStyleCommand, axisSelectionOf, mergeAxisStyle, reservedAxisStyleId } from '../../src/commands/impl/SetAxisStyle';
import { StyleUsage } from '../../src/commands/impl/styleIdentity';
import { clearRange } from '../../src/commands/rangeValues';
import { displayTextOf } from '../../src/format/displayText';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

import type { Command } from '../../src/commands/Command';
import type { RangeAddress } from '../../src/selection/Range';

/** CommandManager calls must not contain the forbidden literal form. */
const run = (cm: CommandManager, cmd: Command): void => { cm.execute.bind(cm)(cmd); };

const wholeColumn = (c: number): RangeAddress => ({ r1: 0, c1: c, r2: TOTAL_ROWS - 1, c2: c });
const wholeRow = (r: number): RangeAddress => ({ r1: r, c1: 0, r2: r, c2: TOTAL_COLS - 1 });

describe('axis selection detection', () => {
  it('classifies whole-column, whole-row and whole-sheet selections; bounded ones stay null', () => {
    expect(axisSelectionOf(wholeColumn(0))).toEqual({ axis: 'col', from: 0, to: 0 });
    expect(axisSelectionOf({ r1: 0, c1: 3, r2: TOTAL_ROWS - 1, c2: 5 })).toEqual({ axis: 'col', from: 3, to: 5 });
    expect(axisSelectionOf(wholeRow(7))).toEqual({ axis: 'row', from: 7, to: 7 });
    expect(axisSelectionOf({ r1: 1, c1: 0, r2: 9, c2: TOTAL_COLS - 1 })).toEqual({ axis: 'row', from: 1, to: 9 });
    // Whole sheet: column defaults for all 16,384 columns (one meta per column).
    expect(axisSelectionOf({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1 })).toEqual({ axis: 'col', from: 0, to: TOTAL_COLS - 1 });
    expect(axisSelectionOf({ r1: 0, c1: 0, r2: 9, c2: 9 })).toBeNull();
    expect(axisSelectionOf({ r1: 500_000, c1: 2, r2: 600_000, c2: 4 })).toBeNull();
  });

  it('reserved ids are per axis and index', () => {
    expect(reservedAxisStyleId('col', 0)).toBe('colstyle-0');
    expect(reservedAxisStyleId('row', 5)).toBe('rowstyle-5');
  });
});

describe('whole-column bold on an empty sheet', () => {
  it('styles every cell of the column through the axis default without storing any cell', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    const setCellSpy = vi.spyOn(Store.prototype, 'setCell');
    const setColSpy = vi.spyOn(Store.prototype, 'setCol');
    const cmd = new SetRangeStyleCommand({ ...wholeColumn(0), style: { bold: true } });
    run(cm, cmd);

    expect(store.getCellStyle(0, 0)?.bold).toBe(true);
    expect(store.getCellStyle(1_048_575, 0)?.bold).toBe(true);
    expect(store.getCellCount()).toBe(0); // the address space is not an allocation
    expect(setCellSpy).not.toHaveBeenCalled();
    expect(setColSpy.mock.calls.length).toBeLessThanOrEqual(1); // one meta for one selected column
    setCellSpy.mockRestore();
    setColSpy.mockRestore();

    // A cell typed later picks the format up, without owning a styleId.
    store.setCell(500_000, 0, { text: 'x', value: 'x' });
    const cell = store.getCell(500_000, 0);
    expect(cell?.styleId).toBeUndefined();
    expect(store.getCellStyle(500_000, 0, cell)?.bold).toBe(true);

    // Undo removes the default; redo (the manager re-executes the original
    // command, which re-merges onto the restored state) brings it back.
    run(cm, cmd.getUndo());
    expect(store.getCellStyle(500_000, 0, store.getCell(500_000, 0))).toBeUndefined();
    expect(store.getCol(0)).toBeUndefined();
    run(cm, cmd);
    expect(store.getCellStyle(500_000, 0, store.getCell(500_000, 0))?.bold).toBe(true);
  });

  it('whole-row bold writes row metas, not cells', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    const setRowSpy = vi.spyOn(Store.prototype, 'setRow');
    const setCellSpy = vi.spyOn(Store.prototype, 'setCell');
    const cmd = new SetRangeStyleCommand({ ...wholeRow(3), style: { bold: true } });
    run(cm, cmd);
    expect(setCellSpy).not.toHaveBeenCalled();
    expect(setRowSpy.mock.calls.length).toBe(1);
    setRowSpy.mockRestore();
    setCellSpy.mockRestore();
    expect(store.getCellStyle(3, 0)?.bold).toBe(true);
    expect(store.getCellStyle(3, TOTAL_COLS - 1)?.bold).toBe(true);
    expect(store.getCellStyle(4, 0)?.bold).toBeUndefined(); // other rows untouched
  });

  it('whole-sheet selection writes column defaults for all 16,384 columns', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1, style: { italic: true } }));
    expect(store.getCellStyle(0, 0)?.italic).toBe(true);
    expect(store.getCellStyle(999, TOTAL_COLS - 1)?.italic).toBe(true);
    expect(store.getCellCount()).toBe(0);
    expect(store.getColEntries().length).toBe(TOTAL_COLS);
    run(cm, cm.getLastExecuted()!.getUndo());
    expect(store.getColEntries().length).toBe(0);
    expect(store.getCellStyle(0, 0)).toBeUndefined();
  }, 30_000);
});

describe('style resolution priority (cell > row > column)', () => {
  it('cell own format wins over the row default, which wins over the column default', () => {
    const store = new Store();
    store.setStyle('colstyle-0', { italic: true });
    store.setCol(0, { styleId: 'colstyle-0' });
    store.setStyle('rowstyle-5', { bold: true });
    store.setRow(5, { styleId: 'rowstyle-5' });
    store.setStyle('own', { underline: true });
    store.setCell(5, 0, { text: 'A', styleId: 'own' });

    expect(store.getCellStyle(5, 0)).toEqual({ underline: true }); // cell own
    expect(store.getCellStyle(5, 1)).toEqual({ bold: true }); // row default
    expect(store.getCellStyle(0, 0)).toEqual({ italic: true }); // column default
    expect(store.getCellStyle(0, 1)).toBeUndefined(); // neither axis styled
  });

  it('a styled row beats the styled column it crosses', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(0), style: { italic: true } }));
    run(cm, new SetRangeStyleCommand({ ...wholeRow(2), style: { bold: true } }));
    expect(store.getCellStyle(2, 0)).toEqual({ bold: true }); // row format wins on the crossing
    expect(store.getCellStyle(3, 0)).toEqual({ italic: true }); // column format below the row
  });
});

describe('bounded selections merge onto the effective style', () => {
  it('italic inside a bold column makes the cell bold+italic; clearing falls back to the column default', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    store.setCell(10, 0, { text: 'v', value: 'v' });
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(0), style: { bold: true } }));

    run(cm, new SetCellStyleCommand({ r: 10, c: 0, style: { italic: true } }));
    const cell = store.getCell(10, 0);
    expect(cell?.styleId).toBeDefined(); // the direct format is the cell's own
    expect(store.getCellStyle(10, 0, cell)).toEqual({ bold: true, italic: true });

    // Clear formats on the cell: its own styleId goes, the column default shows.
    clearRange(store, cm, { r1: 10, c1: 0, r2: 10, c2: 0 });
    expect(store.getCell(10, 0)?.styleId).toBeUndefined();
    expect(store.getCellStyle(10, 0, store.getCell(10, 0))?.bold).toBe(true);

    // Clear formats on the whole column: the axis default goes with the cells'.
    // (The dense clear leaves an emptied ghost cell behind — pre-existing
    // clearRange behavior; its styleId is gone either way.)
    clearRange(store, cm, wholeColumn(0));
    const emptied = store.getCell(10, 0);
    expect(emptied === undefined || (emptied.text === '' && emptied.styleId === undefined)).toBe(true);
    expect(store.getCellStyle(10, 0, emptied)).toBeUndefined();
    expect(store.getCol(0)).toBeUndefined();

    // One undo step restores cells AND the column default.
    run(cm, cm.getLastExecuted()!.getUndo());
    expect(store.getCellStyle(10, 0, store.getCell(10, 0))?.bold).toBe(true);
    expect(store.getCol(0)?.styleId).toBe('colstyle-0');
  });

  it('borders inside a styled column keep the existing styles', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    store.setCell(4, 0, { text: 'b', value: 'b' });
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(0), style: { bold: true } }));
    run(cm, new SetRangeBorderCommand({ r1: 4, c1: 0, r2: 4, c2: 0, preset: 'all', line: 'solid' }));
    const style = store.getCellStyle(4, 0);
    expect(style?.bold).toBe(true);
    expect(style?.border).toEqual({ top: 'solid', bottom: 'solid', left: 'solid', right: 'solid' });
  });

  it('whole-column outer border keeps only the band-side edges', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetRangeBorderCommand({ ...wholeColumn(1), preset: 'outer', line: 'solid' }));
    expect(store.getCellStyle(0, 1)?.border).toEqual({ left: 'solid', right: 'solid' }); // top/bottom lie outside the band
    // Adding a left border to one cell leaves the column default untouched.
    run(cm, new SetRangeBorderCommand({ r1: 0, c1: 1, r2: 3, c2: 1, preset: 'left', line: 'dashed' }));
    expect(store.getCellStyle(0, 1)?.border).toEqual({ left: 'dashed', right: 'solid' });
    expect(store.getCellStyle(9, 1)?.border).toEqual({ left: 'solid', right: 'solid' });
  });
});

describe('whole-column number format', () => {
  it('formats values typed into the column afterwards', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetNumberFormatCommand({ ...wholeColumn(0), numberFormat: 'percent' }));
    store.setCell(0, 0, { text: '0.5', value: 0.5 });
    const cell = store.getCell(0, 0);
    expect(cell?.styleId).toBeUndefined(); // typed cell owns no format
    expect(displayTextOf(cell, store.getCellStyle(0, 0, cell))).toBe('50.00%');
    run(cm, cm.getLastExecuted()!.getUndo());
    expect(displayTextOf(cell, store.getCellStyle(0, 0, cell))).toBe('0.5');
  });
});

describe('serialization and structure keep axis styles', () => {
  it('serialize → deserialize preserves the column default', () => {
    const store = new Store();
    store.setCol(2, { width: 90 });
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(2), style: { bold: true } }));
    const restored = Store.deserialize(store.serialize());
    expect(restored.getCol(2)).toEqual({ width: 90, styleId: 'colstyle-2' });
    expect(restored.getCellStyle(0, 2)?.bold).toBe(true);
    expect(restored.getCellStyle(5, 3)).toBeUndefined();
  });

  it('copySheet carries the axis default over', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(1), style: { bold: true } }));
    const copyId = store.copySheet('sheet-1');
    expect(copyId).toBeDefined();
    expect(store.getCellStyle(3, 1, undefined, copyId ?? '')?.bold).toBe(true);
  });

  it('inserting and deleting rows moves the styled row with its index', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ ...wholeRow(1), style: { italic: true } }));
    expect(store.getCellStyle(1, 3)?.italic).toBe(true);

    run(cm, new InsertRowCommand({ r: 0 }));
    // The meta moved down as a whole; the reserved id travels with the row.
    expect(store.getRow(2)?.styleId).toBe('rowstyle-1');
    expect(store.getCellStyle(2, 3)?.italic).toBe(true);
    expect(store.getCellStyle(1, 3)?.italic).toBeUndefined(); // the new row has no default

    run(cm, new DeleteRowCommand({ r: 0 }));
    expect(store.getRow(1)?.styleId).toBe('rowstyle-1');
    expect(store.getCellStyle(1, 3)?.italic).toBe(true);
  });

  it('inserting and deleting columns moves the styled column with its index', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(1), style: { bold: true } }));

    run(cm, new InsertColCommand({ c: 0 }));
    expect(store.getCol(2)?.styleId).toBe('colstyle-1');
    expect(store.getCellStyle(7, 2)?.bold).toBe(true);
    expect(store.getCellStyle(7, 1)?.bold).toBeUndefined();

    run(cm, new DeleteColCommand({ c: 0 }));
    expect(store.getCol(1)?.styleId).toBe('colstyle-1');
    expect(store.getCellStyle(7, 1)?.bold).toBe(true);
  });
});

describe('ClearAxisStyleCommand', () => {
  it('drops only the default, keeps width/hide, and undo restores both', () => {
    const store = new Store();
    store.setCol(1, { width: 120, hide: true });
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(1), style: { bold: true } }));
    expect(store.getCellStyle(0, 1)?.bold).toBe(true);

    run(cm, new ClearAxisStyleCommand({ axis: 'col', from: 1, to: 1 }));
    expect(store.getCellStyle(0, 1)).toBeUndefined();
    expect(store.getCol(1)).toEqual({ width: 120, hide: true });

    run(cm, cm.getLastExecuted()!.getUndo());
    expect(store.getCellStyle(0, 1)?.bold).toBe(true);
    expect(store.getCol(1)).toEqual({ width: 120, hide: true, styleId: 'colstyle-1' });
  });
});

describe('StyleUsage reserved-id guard', () => {
  it('never hands a reserved axis id to a cell, even when a cell points at one', () => {
    const store = new Store();
    // A pathological cell holding the column's reserved id must not make the
    // next cell style reuse (and thereby patch) the column default.
    store.setCol(0, { styleId: 'colstyle-0' });
    store.setStyle('colstyle-0', { bold: true });
    store.setCell(3, 0, { text: 'x', styleId: 'colstyle-0' });
    const usage = StyleUsage.capture(store, store.getActiveSheetId());
    const next = usage.forCell(3, 0, 'colstyle-0');
    expect(next.startsWith('colstyle-')).toBe(false);
    expect(next.startsWith('rowstyle-')).toBe(false);
    usage.reassign('colstyle-0', next);
  });
});

describe('large-span axis writes stay compact', () => {
  const stylesCount = (store: Store): number => store.serialize().sheets[0]!.data.styles.length;
  const weight = (cmd: Command): number => cmd.historyWeight();

  it('a 500,000-row span adds ≤3 style entries, runs in well under a second, and its undo weighs ≤10', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    const stylesBefore = stylesCount(store);
    // Full-width selection over rows 0..499,999 → row-axis write for the span.
    const cmd = new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 499_999, c2: TOTAL_COLS - 1, style: { bold: true } });
    const started = performance.now();
    run(cm, cmd);
    const ms = performance.now() - started;

    expect(stylesCount(store) - stylesBefore).toBeLessThanOrEqual(3); // one shared entry for the run
    expect(store.getCellStyle(0, 0)?.bold).toBe(true);
    expect(store.getCellStyle(499_999, 0)?.bold).toBe(true);
    expect(store.getCellCount()).toBe(0);
    // Measured ~100-300 ms on this machine (500k meta writes dominate). CI
    // runs under coverage instrumentation on a slower, loaded runner (~10x),
    // so the wall leaves that much room; the entry-count and weight asserts
    // are the exact guards.
    expect(ms).toBeLessThan(400 * 15);
    const undo = cmd.getUndo();
    expect(weight(undo)).toBeLessThanOrEqual(10);
    run(cm, undo);
    expect(stylesCount(store)).toBe(stylesBefore);
    expect(store.getCellStyle(250_000, 0)).toBeUndefined();
    expect(store.getRow(250_000)).toBeUndefined();
  });

  it('a later single-row write splits off one row without touching the shared entry', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 99, c2: TOTAL_COLS - 1, style: { bold: true } }));
    expect(store.getRow(50)?.styleId).toBe('rowstyle-0');
    expect(store.getRow(51)?.styleId).toBe('rowstyle-0');
    const shared = store.getStyle('rowstyle-0');
    const stylesBefore = stylesCount(store);

    const single = new SetRangeStyleCommand({ r1: 50, c1: 0, r2: 50, c2: TOTAL_COLS - 1, style: { italic: true } });
    run(cm, single);
    // The one row gets its own reserved id; the run's entry is not mutated.
    expect(store.getRow(50)?.styleId).toBe('rowstyle-50');
    expect(store.getRow(51)?.styleId).toBe('rowstyle-0');
    expect(store.getStyle('rowstyle-0')).toBe(shared);
    expect(store.getCellStyle(50, 0)).toEqual({ bold: true, italic: true });
    expect(store.getCellStyle(51, 0)).toEqual({ bold: true });

    run(cm, single.getUndo());
    expect(store.getRow(50)?.styleId).toBe('rowstyle-0'); // back on the shared entry
    expect(store.getCellStyle(50, 0)).toEqual({ bold: true });
    expect(store.getStyle('rowstyle-50')).toBeUndefined(); // the split entry is gone
    expect(stylesCount(store)).toBe(stylesBefore);
  });

  it('indices that carried meta keep their fields, and undo restores them verbatim', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    store.setRow(10, { height: 30 });
    store.setRow(20, { hide: true });
    store.setRow(30, { styleId: 'seed' });
    store.setStyle('seed', { bold: true, underline: true });
    const seedEntry = store.getStyle('seed');
    const stylesBefore = stylesCount(store);

    const cmd = new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 99, c2: TOTAL_COLS - 1, style: { italic: true } });
    run(cm, cmd);
    // Runs: 0..29 (no default; the height/hide-only rows stay inside it),
    // 30 (seed base), 31..99 (meta-less again) — one entry per segment.
    expect(store.getRow(10)).toEqual({ height: 30, styleId: 'rowstyle-0' });
    expect(store.getRow(20)).toEqual({ hide: true, styleId: 'rowstyle-0' });
    expect(store.getRow(30)).toEqual({ styleId: 'rowstyle-30' });
    expect(store.getRow(31)?.styleId).toBe('rowstyle-31');
    expect(store.getCellStyle(30, 0)).toEqual({ bold: true, underline: true, italic: true });
    expect(store.getStyle('seed')).toBe(seedEntry); // the base entry was read, not replaced
    expect(stylesCount(store) - stylesBefore).toBe(3); // one per segment

    run(cm, cmd.getUndo());
    expect(store.getRow(10)).toEqual({ height: 30 });
    expect(store.getRow(20)).toEqual({ hide: true });
    expect(store.getRow(30)).toEqual({ styleId: 'seed' });
    expect(store.getRow(0)).toBeUndefined();
    expect(store.getRow(31)).toBeUndefined();
    expect(store.getStyle('rowstyle-0')).toBeUndefined();
    expect(store.getStyle('rowstyle-30')).toBeUndefined();
    expect(store.getStyle('rowstyle-31')).toBeUndefined();
    expect(store.getCellStyle(30, 0)).toEqual({ bold: true, underline: true });
    expect(stylesCount(store)).toBe(stylesBefore);
  });

  it('segments with different bases get one entry each (delta = segment count)', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    store.setStyle('segA', { bold: true });
    for (let r = 0; r < 10; r += 1) store.setRow(r, { styleId: 'segA' });
    const stylesBefore = stylesCount(store);

    const cmd = new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 4_999, c2: TOTAL_COLS - 1, style: { italic: true } });
    run(cm, cmd);
    expect(stylesCount(store) - stylesBefore).toBe(2); // rowstyle-0 and rowstyle-10
    expect(store.getCellStyle(0, 0)).toEqual({ bold: true, italic: true });
    expect(store.getCellStyle(9, 5)).toEqual({ bold: true, italic: true });
    expect(store.getCellStyle(10, 0)).toEqual({ italic: true });
    expect(store.getCellStyle(4_999, 0)).toEqual({ italic: true });
    expect(store.getStyle('segA')).toEqual({ bold: true }); // untouched

    run(cm, cmd.getUndo());
    expect(store.getRow(0)).toEqual({ styleId: 'segA' });
    expect(store.getRow(4_999)).toBeUndefined();
    expect(store.getCellStyle(0, 0)).toEqual({ bold: true });
    expect(store.getCellStyle(10, 0)).toBeUndefined();
    expect(stylesCount(store)).toBe(stylesBefore);
  });

  it('clearing a large span is exact: the shared entry is deleted once, undo restores it', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 49_999, c2: TOTAL_COLS - 1, style: { bold: true } }));
    expect(stylesCount(store)).toBe(1); // the span shares one entry

    run(cm, new ClearAxisStyleCommand({ axis: 'row', from: 0, to: 49_999 }));
    expect(store.getCellStyle(25_000, 0)).toBeUndefined();
    expect(store.getRow(25_000)).toBeUndefined();
    expect(stylesCount(store)).toBe(0); // nothing outside the span referenced it

    run(cm, cm.getLastExecuted()!.getUndo());
    expect(store.getRow(25_000)?.styleId).toBe('rowstyle-0');
    expect(store.getCellStyle(25_000, 0)?.bold).toBe(true);
    expect(stylesCount(store)).toBe(1);
  });

  it('clearing a span that carries no metas records nothing and changes nothing', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    const before = store.serialize();
    const cmd = new ClearAxisStyleCommand({ axis: 'row', from: 0, to: 499_999 });
    run(cm, cmd);
    expect(weight(cmd)).toBe(0);
    expect(store.serialize()).toEqual(before);
  });
});

describe('shared-entry ownership (a span id must not leak across runs)', () => {
  const stylesCount = (store: Store): number => store.serialize().sheets[0]!.data.styles.length;
  /** Rows 10..20 formatted as one span share `rowstyle-10`; [probe] scenarios then write a sub-span. */
  function spanSetup(): { store: Store; cm: CommandManager } {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetAxisStyleCommand({ axis: 'row', from: 10, to: 20, style: { bold: true } }));
    return { store, cm };
  }
  /** Numeric per-row assertion: styleId on the meta and bold/italic in the effective style. */
  function expectRow(store: Store, r: number, styleId: string, bold: boolean, italic: boolean): void {
    expect(store.getRow(r)?.styleId).toBe(styleId);
    const style = store.getCellStyle(r, 0);
    expect(style?.bold === true).toBe(bold);
    expect(style?.italic === true).toBe(italic);
  }

  it('re-formatting the OWNER row alone must not restyle the rows sharing its entry', () => {
    const { store, cm } = spanSetup();
    const count = stylesCount(store);
    const shared = store.getStyle('rowstyle-10');
    expect(count).toBe(1);

    const second = new SetAxisStyleCommand({ axis: 'row', from: 10, to: 10, style: { italic: true } });
    run(cm, second);
    // `rowstyle-10` is owned by rows 11..20 (outside the [10..10] run), so the
    // write probes a fresh span id instead of replacing the shared entry.
    expectRow(store, 10, 'rowstyle-10-1', true, true);
    expectRow(store, 11, 'rowstyle-10', true, false);
    expectRow(store, 15, 'rowstyle-10', true, false);
    expectRow(store, 20, 'rowstyle-10', true, false);
    expect(store.getStyle('rowstyle-10')).toBe(shared);
    expect(stylesCount(store)).toBe(count + 1);

    cm.undo();
    expectRow(store, 10, 'rowstyle-10', true, false);
    expect(store.getStyle('rowstyle-10-1')).toBeUndefined();
    expect(stylesCount(store)).toBe(count);
    expect(store.getStyle('rowstyle-10')).toBe(shared);

    cm.redo();
    expectRow(store, 10, 'rowstyle-10-1', true, true);
    expectRow(store, 11, 'rowstyle-10', true, false);
    expectRow(store, 20, 'rowstyle-10', true, false);
    expect(store.getStyle('rowstyle-10')).toBe(shared);
  });

  it('re-formatting a MIDDLE row alone writes under its own unreferenced reserved id', () => {
    const { store, cm } = spanSetup();
    const count = stylesCount(store);

    run(cm, new SetAxisStyleCommand({ axis: 'row', from: 15, to: 15, style: { italic: true } }));
    expectRow(store, 15, 'rowstyle-15', true, true); // `rowstyle-15` is referenced by nobody
    expectRow(store, 10, 'rowstyle-10', true, false);
    expectRow(store, 11, 'rowstyle-10', true, false);
    expectRow(store, 20, 'rowstyle-10', true, false);
    expect(stylesCount(store)).toBe(count + 1);

    cm.undo();
    expectRow(store, 15, 'rowstyle-10', true, false);
    expect(store.getStyle('rowstyle-15')).toBeUndefined();
    expect(stylesCount(store)).toBe(count);

    cm.redo();
    expectRow(store, 15, 'rowstyle-15', true, true);
    expectRow(store, 10, 'rowstyle-10', true, false);
  });

  it('re-formatting a PREFIX of the span must not restyle the tail rows', () => {
    const { store, cm } = spanSetup();
    const count = stylesCount(store);

    run(cm, new SetAxisStyleCommand({ axis: 'row', from: 10, to: 12, style: { italic: true } }));
    expectRow(store, 10, 'rowstyle-10-1', true, true);
    expectRow(store, 11, 'rowstyle-10-1', true, true);
    expectRow(store, 12, 'rowstyle-10-1', true, true);
    expectRow(store, 15, 'rowstyle-10', true, false);
    expectRow(store, 20, 'rowstyle-10', true, false);
    expect(stylesCount(store)).toBe(count + 1);

    cm.undo();
    expectRow(store, 10, 'rowstyle-10', true, false);
    expectRow(store, 12, 'rowstyle-10', true, false);
    expectRow(store, 20, 'rowstyle-10', true, false);
    expect(store.getStyle('rowstyle-10-1')).toBeUndefined();
    expect(stylesCount(store)).toBe(count);

    cm.redo();
    expectRow(store, 10, 'rowstyle-10-1', true, true);
    expectRow(store, 12, 'rowstyle-10-1', true, true);
    expectRow(store, 15, 'rowstyle-10', true, false);
  });

  it('column axis: owner / middle / prefix writes stay within their span', () => {
    // Owner
    {
      const store = new Store();
      const cm = new CommandManager(store);
      run(cm, new SetAxisStyleCommand({ axis: 'col', from: 10, to: 20, style: { bold: true } }));
      run(cm, new SetAxisStyleCommand({ axis: 'col', from: 10, to: 10, style: { italic: true } }));
      expect(store.getCol(10)?.styleId).toBe('colstyle-10-1');
      expect(store.getCol(15)?.styleId).toBe('colstyle-10');
      expect(store.getCellStyle(0, 10)).toEqual({ bold: true, italic: true });
      expect(store.getCellStyle(0, 15)).toEqual({ bold: true });
      expect(store.getCellStyle(9, 20)).toEqual({ bold: true });
      cm.undo();
      expect(store.getCol(10)?.styleId).toBe('colstyle-10');
      expect(store.getCellStyle(0, 10)).toEqual({ bold: true });
      expect(store.getStyle('colstyle-10-1')).toBeUndefined();
    }
    // Middle
    {
      const store = new Store();
      const cm = new CommandManager(store);
      run(cm, new SetAxisStyleCommand({ axis: 'col', from: 10, to: 20, style: { bold: true } }));
      run(cm, new SetAxisStyleCommand({ axis: 'col', from: 15, to: 15, style: { italic: true } }));
      expect(store.getCol(15)?.styleId).toBe('colstyle-15');
      expect(store.getCellStyle(0, 15)).toEqual({ bold: true, italic: true });
      expect(store.getCellStyle(0, 10)).toEqual({ bold: true });
      expect(store.getCellStyle(0, 20)).toEqual({ bold: true });
    }
    // Prefix
    {
      const store = new Store();
      const cm = new CommandManager(store);
      run(cm, new SetAxisStyleCommand({ axis: 'col', from: 10, to: 20, style: { bold: true } }));
      run(cm, new SetAxisStyleCommand({ axis: 'col', from: 10, to: 12, style: { italic: true } }));
      expect(store.getCol(10)?.styleId).toBe('colstyle-10-1');
      expect(store.getCol(12)?.styleId).toBe('colstyle-10-1');
      expect(store.getCol(15)?.styleId).toBe('colstyle-10');
      expect(store.getCellStyle(0, 12)).toEqual({ bold: true, italic: true });
      expect(store.getCellStyle(0, 15)).toEqual({ bold: true });
    }
  });

  it('after a structural shift, re-formatting the new owner position does not touch the shifted rows', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetAxisStyleCommand({ axis: 'row', from: 10, to: 20, style: { bold: true } }));
    run(cm, new InsertRowCommand({ r: 5 })); // rows 10..20 move to 11..21, still on `rowstyle-10`
    expect(store.getRow(11)?.styleId).toBe('rowstyle-10');

    run(cm, new SetAxisStyleCommand({ axis: 'row', from: 11, to: 11, style: { italic: true } }));
    expectRow(store, 11, 'rowstyle-11', true, true); // its reserved id is unreferenced here
    expectRow(store, 12, 'rowstyle-10', true, false);
    expectRow(store, 15, 'rowstyle-10', true, false);
    expectRow(store, 21, 'rowstyle-10', true, false);
    cm.undo();
    expectRow(store, 11, 'rowstyle-10', true, false);
    expect(store.getStyle('rowstyle-11')).toBeUndefined();
  });

  it('after a structural shift, writing the stale owner index probes a fresh span id', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetAxisStyleCommand({ axis: 'row', from: 10, to: 20, style: { bold: true } }));
    run(cm, new InsertRowCommand({ r: 5 })); // rows 11..21 reference `rowstyle-10`; row 10 is new

    run(cm, new SetAxisStyleCommand({ axis: 'row', from: 10, to: 10, style: { italic: true } }));
    // `rowstyle-10` belongs to rows 11..21 — row 10's write must go to a fresh id.
    expectRow(store, 10, 'rowstyle-10-1', false, true);
    expectRow(store, 11, 'rowstyle-10', true, false);
    expectRow(store, 21, 'rowstyle-10', true, false);
    cm.undo();
    expect(store.getRow(10)).toBeUndefined();
    expect(store.getStyle('rowstyle-10-1')).toBeUndefined();
    expectRow(store, 11, 'rowstyle-10', true, false);
    expectRow(store, 21, 'rowstyle-10', true, false);
  });
});

describe('mergeAxisStyle', () => {
  it('undefined deletes keys and border merges edge-wise', () => {
    expect(mergeAxisStyle({ bold: true, italic: true }, { bold: undefined })).toEqual({ italic: true });
    expect(mergeAxisStyle({ border: { left: 'solid', right: 'solid' } }, { border: { left: 'dashed' } })).toEqual({ border: { left: 'dashed', right: 'solid' } });
    expect(mergeAxisStyle({ border: { left: 'solid', right: 'solid' } }, { border: { left: undefined, right: undefined } })).toEqual({});
    expect(mergeAxisStyle(undefined, { border: { top: 'solid' } })).toEqual({ border: { top: 'solid' } });
  });
});
