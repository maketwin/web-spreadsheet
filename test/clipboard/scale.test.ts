import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import type { StoreEvent } from '../../src/types';
import { TOTAL_ROWS } from '../../src/util/gridSize';
import { ClipboardService, copySourceRect } from '../../src/clipboard/ClipboardService';
import { buildSessionPasteValues, combineMultiRanges, snapshotCells, sparseClearCmd, tilePlainCells, type ClipboardSessionState } from '../../src/clipboard/session';
import { planMergePaste } from '../../src/clipboard/session';
import { CompositeCommand } from '../../src/commands/rangeValues';
import { SetRangeValues } from '../../src/commands/impl/SetRangeValues';

/**
 * Scale guards: the address space is Excel-sized (1,048,576 × 16,384), so
 * clipboard operations must cost what is actually stored, never the grid.
 */

const ROWS = 200;
const COLS = 5;

function setupBlock(): Store {
  const store = new Store();
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) store.setCell(r, c, { text: `v${r}_${c}`, value: r * COLS + c, type: 'number' });
  }
  return store;
}

const wholeColumn = (c1: number, c2: number) => ({ r1: 0, c1, r2: TOTAL_ROWS - 1, c2 });

describe('copy at grid scale', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('snapshotCells of an entire column yields only the used rows', () => {
    const store = setupBlock();
    const spy = vi.spyOn(Store.prototype, 'getCell');
    const cells = snapshotCells(store, wholeColumn(2, 2));
    expect(cells.length).toBe(ROWS);
    expect(cells[0]?.[0]?.text).toBe('v0_2');
    expect(cells[ROWS - 1]?.[0]?.text).toBe(`v${ROWS - 1}_2`);
    // Per-cell walking would make this call count grow with TOTAL_ROWS.
    expect(spy.mock.calls.length).toBeLessThan(ROWS * COLS);
  });

  it('payload text of an entire-column copy equals copying just the used rows', () => {
    const store = setupBlock();
    const whole = ClipboardService.createPayload(store, wholeColumn(0, COLS - 1));
    const part = ClipboardService.createPayload(store, { r1: 0, c1: 0, r2: ROWS - 1, c2: COLS - 1 });
    expect(whole?.text).toBe(part?.text);
    expect(whole?.html).toBe(part?.html);
    expect(whole?.text.split('\n')).toHaveLength(ROWS);
  });

  it('copying a fully empty entire column yields a single blank cell', () => {
    const store = setupBlock(); // column 9 untouched
    const cells = snapshotCells(store, wholeColumn(9, 9));
    expect(cells.length).toBe(1);
    expect(cells[0]?.length).toBe(1);
    expect(cells[0]?.[0]).toBeUndefined();
    const payload = ClipboardService.createPayload(store, wholeColumn(9, 9));
    expect(payload?.text).toBe('');
  });

  it('copySourceRect keeps the top-left anchor and trims trailing blanks', () => {
    const store = setupBlock();
    // Selection starts 3 rows above the data: leading blank rows stay (anchor position).
    const rect = copySourceRect(store, { r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: COLS - 1 });
    expect(rect).toEqual({ r1: 0, c1: 0, r2: ROWS - 1, c2: COLS - 1 });
    // A disjoint selection collapses to its first cell.
    const single = copySourceRect(store, wholeColumn(9, 9));
    expect(single).toEqual({ r1: 0, c1: 9, r2: 0, c2: 9 });
  });

  it('a stray far-away cell in another column does not stretch a column copy', () => {
    const store = setupBlock();
    store.setCell(999_998, 4, { text: 'stray' }); // row 999999, column E
    // Copying column A used to read A1:A999999 (the sheet-wide used bounds);
    // it now reads only the block actually stored in column A.
    const rect = copySourceRect(store, wholeColumn(0, 0));
    expect(rect).toEqual({ r1: 0, c1: 0, r2: ROWS - 1, c2: 0 });
    expect(snapshotCells(store, wholeColumn(0, 0)).length).toBe(ROWS);
    expect(ClipboardService.createPayload(store, wholeColumn(0, 0))?.text.split('\n')).toHaveLength(ROWS);
  });

  it('combineMultiRanges keeps line lengths equal for ranges of different heights', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a1' });
    store.setCell(2, 0, { text: 'a3' });
    store.setCell(19, 0, { text: 'a20' });
    store.setCell(24, 1, { text: 'b25' });
    const combined = combineMultiRanges(store, [{ r1: 0, c1: 0, r2: 9, c2: 1 }, { r1: 19, c1: 0, r2: 29, c2: 1 }]);
    expect(combined).not.toBeNull();
    expect(combined!.cells.every((line) => line.length === 2)).toBe(true);
    expect(combined!.text.split('\n').every((line) => line.split('\t').length === 2)).toBe(true);
    // Trailing blank rows of each range are cut; interior positions stay put.
    expect(combined!.cells.length).toBe(3 + 6);
    expect(combined!.cells[0]?.[0]?.text).toBe('a1');
    // A column kept only by the second range rides along (shared column extent).
    expect(combined!.cells[8]?.[1]?.text).toBe('b25');
  });

  it('combineMultiRanges by rows gives every line the same length', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a1' });
    store.setCell(2, 0, { text: 'a3' });
    store.setCell(1, 2, { text: 'c2' });
    store.setCell(4, 2, { text: 'c5' });
    const combined = combineMultiRanges(store, [{ r1: 0, c1: 0, r2: 9, c2: 0 }, { r1: 0, c1: 2, r2: 9, c2: 2 }]);
    expect(combined).not.toBeNull();
    expect(combined!.cells.every((line) => line.length === 2)).toBe(true);
    expect(combined!.cells.length).toBe(5);
    expect(combined!.cells[4]?.[1]?.text).toBe('c5');
  });

  it('paste of one copied cell onto an entire-column selection writes only the anchor', () => {
    const store = setupBlock();
    const source = { r1: 0, c1: 0, r2: 0, c2: 0 };
    const session: ClipboardSessionState = { type: 'copy', range: source, text: 'v0_0', cells: snapshotCells(store, source) };
    const target = wholeColumn(3, 3);
    const values = buildSessionPasteValues(session, target.r1, target.c1, target);
    expect(values.length).toBe(1);
    expect(values[0]?.length).toBe(1);

    const plan = planMergePaste(store, [], session.range, target.r1, target.c1, target);
    expect(plan.ok).toBe(true);
    expect(plan.rect.r2).toBe(plan.rect.r1);
    expect(plan.rect.c2).toBe(plan.rect.c1);
  });

  it('plain-text paste of one cell onto an entire-column target stays at the anchor', () => {
    const cells = [[{ text: 'x', value: 'x' }]];
    const tiled = tilePlainCells(cells, wholeColumn(0, 0));
    expect(tiled.length).toBe(1);
    expect(tiled[0]?.length).toBe(1);
  });

  it('a small exact-multiple target still tiles (existing behavior)', () => {
    const store = setupBlock();
    const source = { r1: 0, c1: 0, r2: 0, c2: 0 };
    const session: ClipboardSessionState = { type: 'copy', range: source, text: 'v0_0', cells: snapshotCells(store, source) };
    const values = buildSessionPasteValues(session, 10, 1, { r1: 10, c1: 1, r2: 19, c2: 1 });
    expect(values.length).toBe(10);
  });
});

describe('cut at grid scale', () => {
  it('clearing an entire column only touches stored cells', () => {
    const store = setupBlock();
    const events: StoreEvent[] = [];
    store.subscribe((e) => events.push(e));
    const cmd = sparseClearCmd(store, wholeColumn(0, COLS - 1));
    cmd.execute.bind(cmd)(store);
    const cellEvents = events.filter((e) => e.type === 'cell');
    expect(cellEvents.length).toBeLessThanOrEqual(ROWS * COLS);
    expect(store.getCell(0, 0)?.text ?? '').toBe('');
    expect(store.getCell(ROWS - 1, COLS - 1)?.text ?? '').toBe('');
  });

  it('sparse clear of an entire column writes only the stored cells', () => {
    const store = setupBlock();
    store.setCell(999_998, 4, { text: 'stray' });
    const spy = vi.spyOn(Store.prototype, 'setCell');
    const cmd = sparseClearCmd(store, wholeColumn(0, 0));
    cmd.execute.bind(cmd)(store);
    // One write per stored cell of column A: the far-away stray cell in
    // column E and the million blank addresses are never written.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(ROWS + 8);
    expect(store.getCell(999_998, 4)?.text).toBe('stray');
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(store.getCell(ROWS - 1, 0)).toBeUndefined();
    spy.mockRestore();
  });

  it('a cut paste clears the source; one undo restores source and target', () => {
    const store = setupBlock();
    const source = { r1: 0, c1: 0, r2: ROWS - 1, c2: 0 };
    const session: ClipboardSessionState = { type: 'cut', sheetId: store.getActiveSheetId(), range: source, text: '', cells: snapshotCells(store, source) };
    const target = { r1: 10, c1: 7, r2: 10 + ROWS - 1, c2: 7 };
    const values = buildSessionPasteValues(session, target.r1, target.c1, target);
    // The hook's cut paste: write the block and clear the source as one composite command.
    const op = new CompositeCommand([
      new SetRangeValues({ r1: target.r1, c1: target.c1, r2: target.r1 + values.length - 1, c2: target.c1 + (values[0]?.length ?? 1) - 1, values }),
      sparseClearCmd(store, session.range, session.sheetId),
    ]);
    op.execute.bind(op)(store);
    // Source column A is empty; the block landed in column H.
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(store.getCell(ROWS - 1, 0)).toBeUndefined();
    expect(store.getCell(10, 7)?.text).toBe('v0_0');
    op.getUndo().execute.bind(op.getUndo())(store);
    expect(store.getCell(0, 0)?.text).toBe('v0_0');
    expect(store.getCell(ROWS - 1, 0)?.text).toBe(`v${ROWS - 1}_0`);
    expect(store.getCell(10, 7)).toBeUndefined();
  });
});
