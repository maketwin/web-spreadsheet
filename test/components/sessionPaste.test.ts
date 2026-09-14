import { describe, expect, it } from 'vitest';
import { buildSessionPasteValues, combineMultiRanges, snapshotCells, type ClipboardSessionState } from '../../src/components/Spreadsheet';
import { Store } from '../../src/store/Store';
import { SetRangeValues } from '../../src/commands/impl/SetRangeValues';

function makeSession(store: Store, type: 'cut' | 'copy'): ClipboardSessionState {
  const range = { r1: 0, c1: 0, r2: 1, c2: 0 };
  return { type, range, text: '', cells: snapshotCells(store, range) };
}

describe('in-app clipboard session paste (Excel parity)', () => {
  it('copy paste shifts relative formula references and keeps styles', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '=C1+1', formula: '=C1+1' });
    store.setCell(1, 0, { text: '7', value: 7, styleId: 's1' });
    const session = makeSession(store, 'copy');

    const values = buildSessionPasteValues(session, 4, 2); // paste at C5

    expect(values[0]?.[0]).toMatchObject({ formula: '=E5+1' });
    expect(values[1]?.[0]).toMatchObject({ text: '7', value: 7, styleId: 's1' });
  });

  it('cut paste keeps formulas verbatim (Excel move semantics)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '=C1+1', formula: '=C1+1' });
    const session = makeSession(store, 'cut');

    const values = buildSessionPasteValues(session, 4, 2);

    expect(values[0]?.[0]).toMatchObject({ formula: '=C1+1' });
  });

  it('paste fully replaces the target cell (no stale formula/value/style)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'plain' });
    store.setCell(1, 0, { text: 'x' });
    store.setCell(5, 5, { text: '=A1', formula: '=A1', value: 1, styleId: 'old' });
    const session = makeSession(store, 'copy');

    new SetRangeValues({ r1: 5, c1: 5, r2: 6, c2: 5, values: buildSessionPasteValues(session, 5, 5) }).execute(store);

    expect(store.getCell(5, 5)).toMatchObject({ text: 'plain' });
    expect(store.getCell(5, 5)?.formula).toBeUndefined();
    expect(store.getCell(5, 5)?.value).toBeUndefined();
    expect(store.getCell(5, 5)?.styleId).toBeUndefined();
  });
});

describe('paste tiling (Excel)', () => {
  it('tiles the copied block into an exact-multiple target with per-tile formula shifts', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '=C1+1', formula: '=C1+1' });
    store.setCell(1, 0, { text: '7', value: 7 });
    const session = makeSession(store, 'copy');
    const target = { r1: 4, c1: 2, r2: 7, c2: 3 }; // 4x2 = 2x2 tiles of the 2x1 block

    const values = buildSessionPasteValues(session, 4, 2, target);

    expect(values.length).toBe(4);
    expect(values[0]?.length).toBe(2);
    expect(values[0]?.[0]).toMatchObject({ formula: '=E5+1' });
    expect(values[0]?.[1]).toMatchObject({ formula: '=F5+1' });
    expect(values[2]?.[0]).toMatchObject({ formula: '=E7+1' });
    expect(values[1]?.[0]).toMatchObject({ text: '7', value: 7 });
  });

  it('pastes a single copy when the target is not an exact multiple', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    store.setCell(0, 1, { text: 'b' });
    const range = { r1: 0, c1: 0, r2: 0, c2: 1 }; // 1x2 source
    const session: ClipboardSessionState = { type: 'copy', range, text: '', cells: snapshotCells(store, range) };
    const target = { r1: 4, c1: 2, r2: 6, c2: 4 }; // 3 rows and 3 cols: cols not a multiple of 2

    const values = buildSessionPasteValues(session, 4, 2, target);

    expect(values.length).toBe(1);
    expect(values[0]?.length).toBe(2);
  });
});

describe('multi-range copy (Excel)', () => {
  it('combines row-aligned ranges column-wise', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    store.setCell(0, 3, { text: 'd' });
    const combined = combineMultiRanges(store, [
      { r1: 0, c1: 0, r2: 1, c2: 0 },
      { r1: 0, c1: 3, r2: 1, c2: 3 },
    ]);

    expect(combined).not.toBeNull();
    expect(combined?.cells[0]?.map((c) => c?.text ?? '')).toEqual(['a', 'd']);
    expect(combined?.text.split('\n')[0]).toBe('a\td');
  });

  it('rejects ranges that share neither rows nor columns', () => {
    const store = new Store();
    const combined = combineMultiRanges(store, [
      { r1: 0, c1: 0, r2: 1, c2: 0 },
      { r1: 3, c1: 3, r2: 4, c2: 3 },
    ]);

    expect(combined).toBeNull();
  });
});
