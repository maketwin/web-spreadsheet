import { describe, expect, it } from 'vitest';
import { buildPasteSpecialMatrix, DEFAULT_PASTE_SPECIAL, type PasteSpecialOptions, type PasteSpecialSource } from '../../src/clipboard/pasteSpecial';
import { SetRangeValues } from '../../src/commands/impl/SetRangeValues';
import { Store } from '../../src/store/Store';
import type { Cell } from '../../src/types';

function makeSource(type: 'cut' | 'copy', cells: Cell[][]): PasteSpecialSource {
  return { type, range: { r1: 0, c1: 0, r2: cells.length - 1, c2: (cells[0]?.length ?? 1) - 1 }, cells };
}
const opts = (over: Partial<PasteSpecialOptions>): PasteSpecialOptions => ({ ...DEFAULT_PASTE_SPECIAL, ...over });

describe('paste special (Excel parity)', () => {
  it('values mode pastes static values and keeps the target style', () => {
    const store = new Store();
    store.setCell(5, 0, { text: 'old', styleId: 'keep' });
    const m = buildPasteSpecialMatrix(store, makeSource('copy', [[{ text: '42', value: 42, formula: '=A1*2', styleId: 'src' }]]), 5, 0, undefined, opts({ mode: 'values' }));
    expect(m[0]?.[0]).toEqual({ text: '42', value: 42, formula: undefined, type: undefined });
    const r2 = 5; const c2 = 0;
    new SetRangeValues({ r1: 5, c1: 0, r2, c2, values: m }).execute(store);
    expect(store.getCell(5, 0)).toMatchObject({ text: '42', value: 42, styleId: 'keep' });
    expect(store.getCell(5, 0)?.formula).toBeUndefined();
  });

  it('formulas mode shifts relative refs but leaves target style alone', () => {
    const store = new Store();
    const m = buildPasteSpecialMatrix(store, makeSource('copy', [[{ text: '3', formula: '=B1+1', styleId: 'src' }]]), 4, 2, undefined, opts({ mode: 'formulas' }));
    expect(m[0]?.[0]).toMatchObject({ formula: '=D5+1' });
    expect(m[0]?.[0]).not.toHaveProperty('styleId');
  });

  it('formats mode only touches styleId', () => {
    const store = new Store();
    store.setCell(3, 3, { text: 'keep me', value: 9 });
    const m = buildPasteSpecialMatrix(store, makeSource('copy', [[{ text: 'x', styleId: 'fancy' }]]), 3, 3, undefined, opts({ mode: 'formats' }));
    new SetRangeValues({ r1: 3, c1: 3, r2: 3, c2: 3, values: m }).execute(store);
    expect(store.getCell(3, 3)).toMatchObject({ text: 'keep me', value: 9, styleId: 'fancy' });
  });

  it('all mode replaces the whole cell including style', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a', value: 1, styleId: 's1', type: 'number' });
    const m = buildPasteSpecialMatrix(store, makeSource('copy', [[store.getCell(0, 0)!]]), 2, 2, undefined, opts({}));
    expect(m[0]?.[0]).toEqual({ text: 'a', value: 1, formula: undefined, styleId: 's1', type: 'number' });
  });

  it('add operation computes target + source as a static value', () => {
    const store = new Store();
    store.setCell(6, 1, { text: '10', value: 10 });
    const m = buildPasteSpecialMatrix(store, makeSource('copy', [[{ text: '5', value: 5 }]]), 6, 1, undefined, opts({ operation: 'add' }));
    new SetRangeValues({ r1: 6, c1: 1, r2: 6, c2: 1, values: m }).execute(store);
    expect(store.getCell(6, 1)).toMatchObject({ text: '15', value: 15, type: 'number' });
    expect(store.getCell(6, 1)?.formula).toBeUndefined();
  });

  it('multiply onto a blank target treats it as 0 (Excel)', () => {
    const store = new Store();
    const m = buildPasteSpecialMatrix(store, makeSource('copy', [[{ text: '4', value: 4 }]]), 8, 8, undefined, opts({ operation: 'multiply' }));
    expect(m[0]?.[0]).toMatchObject({ text: '0', value: 0 });
  });

  it('divide by zero yields #DIV/0!', () => {
    const store = new Store();
    store.setCell(1, 1, { text: '10', value: 10 });
    const m = buildPasteSpecialMatrix(store, makeSource('copy', [[{ text: '0', value: 0 }]]), 1, 1, undefined, opts({ operation: 'divide' }));
    expect(m[0]?.[0]).toMatchObject({ text: '#DIV/0!' });
  });

  it('transpose swaps rows and columns', () => {
    const store = new Store();
    const src = makeSource('copy', [
      [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
    ]);
    const m = buildPasteSpecialMatrix(store, src, 4, 0, undefined, opts({ transpose: true }));
    expect(m.length).toBe(3);
    expect(m[0]?.[0]).toMatchObject({ text: 'a' });
    expect(m[1]?.[0]).toMatchObject({ text: 'b' });
    expect(m[2]?.[0]).toMatchObject({ text: 'c' });
  });

  it('skipBlanks leaves target cells under blank sources untouched', () => {
    const store = new Store();
    store.setCell(2, 1, { text: 'survive' });
    const m = buildPasteSpecialMatrix(store, makeSource('copy', [[{ text: 'x' }, undefined as unknown as Cell]]), 2, 0, undefined, opts({ skipBlanks: true }));
    expect(m[0]?.[0]).toMatchObject({ text: 'x' });
    expect(m[0]?.[1]).toBeUndefined();
  });

  it('cut sources keep formulas verbatim', () => {
    const store = new Store();
    const m = buildPasteSpecialMatrix(store, makeSource('cut', [[{ text: '1', formula: '=A1' }]]), 9, 9, undefined, opts({ mode: 'formulas' }));
    expect(m[0]?.[0]).toMatchObject({ formula: '=A1' });
  });

  it('tiles into an exact-multiple target selection', () => {
    const store = new Store();
    const m = buildPasteSpecialMatrix(store, makeSource('copy', [[{ text: 'v', value: 2 }]]), 0, 0, { r1: 0, c1: 0, r2: 1, c2: 2 }, opts({ mode: 'values' }));
    expect(m.length).toBe(2);
    expect(m[0]?.length).toBe(3);
    expect(m[1]?.[2]).toMatchObject({ text: 'v' });
  });
});
