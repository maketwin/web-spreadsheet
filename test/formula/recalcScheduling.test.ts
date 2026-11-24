import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { registry } from '../../src/formula/registry';
import { createFormulaSync } from '../../src/formula/formulaSync';
import { CommandManager } from '../../src/commands/CommandManager';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { SetCellStyleCommand } from '../../src/commands/impl/SetCellStyle';

// Recalculation scheduling: every formula is evaluated at most once per
// change, and only a cell whose value really changed wakes its readers.
const TICKS = 'TICKS';
let calls = 0;
registry.register(TICKS, { minArgs: 0, maxArgs: 0, evaluate: () => { calls += 1; return 1; } });

function setup(): { store: Store; engine: FormulaEngine } {
  calls = 0;
  const store = new Store();
  const engine = new FormulaEngine(store);
  createFormulaSync(store, engine);
  return { store, engine };
}

const put = (store: Store, r: number, c: number, text: string): void => {
  store.setCell(r, c, text.startsWith('=') ? { text, formula: text } : { text, value: Number(text) });
};
const value = (store: Store, r: number, c: number, sheetId?: string): unknown => store.getCell(r, c, sheetId)?.value;

/** A(r) = A(r-1) + TICKS() down column A, A1 = 1: a chain where every link counts its evaluations. */
function seedChain(store: Store, size: number): void {
  put(store, 0, 0, '1');
  for (let r = 1; r < size; r += 1) put(store, r, 0, `=A${r}+${TICKS}()`);
}

describe('recalculation scheduling', () => {
  it('evaluates each link of a dependency chain once per edit', () => {
    const { store } = setup();
    seedChain(store, 300);
    calls = 0;
    put(store, 0, 0, '2');
    expect(value(store, 299, 0)).toBe(301);
    expect(calls).toBe(299);
  });

  it('evaluates a chain once in total on recalculateAll', () => {
    const { store, engine } = setup();
    seedChain(store, 200);
    calls = 0;
    engine.recalculateAll();
    expect(calls).toBe(199);
  });

  it('does not wake the readers of a formula whose value did not change', () => {
    const { store } = setup();
    put(store, 0, 0, '1');
    put(store, 0, 1, '=A1*0');
    put(store, 0, 2, `=B1+${TICKS}()`);
    calls = 0;
    put(store, 0, 0, '7');
    // B1 is recomputed (its precedent moved), C1 is not: B1 still reads 0.
    expect(calls).toBe(0);
    expect(value(store, 0, 1)).toBe(0);
    expect(value(store, 0, 2)).toBe(1);
  });

  it('recalculates a row insert as one pass', () => {
    const { store } = setup();
    seedChain(store, 200);
    const cmd = new CommandManager(store);
    calls = 0;
    cmd.execute.bind(cmd)(new InsertRowCommand({ r: 0 }));
    // Every link moved and its text was rewritten, so each one recalculates;
    // a cascade per shifted cell would be quadratic (≈20,000 here).
    expect(calls).toBeLessThan(2000);
    // The chain now runs A2..A201 and still ends at 200.
    expect(value(store, 200, 0)).toBe(200);
  });

  it('shows 0 across a ring, then recovers when the ring opens', () => {
    const { store } = setup();
    put(store, 0, 0, '=B1+1');
    put(store, 0, 1, '=A1+1');
    expect(value(store, 0, 0)).toBe(0);
    expect(value(store, 0, 1)).toBe(0);
    put(store, 0, 1, '5');
    expect(value(store, 0, 0)).toBe(6);
    expect(value(store, 0, 1)).toBe(5);
  });

  it('propagates nothing when a style command rewrites cells in place', () => {
    const { store } = setup();
    put(store, 0, 0, '1');
    put(store, 0, 1, `=A1+${TICKS}()`);
    put(store, 0, 2, `=B1+${TICKS}()`);
    const cmd = new CommandManager(store);
    calls = 0;
    // Restyling the precedent recalculates nothing.
    cmd.execute.bind(cmd)(new SetCellStyleCommand({ r: 0, c: 0, style: { bold: true } }));
    expect(calls).toBe(0);
    // Restyling the formula cell re-registers it, but it still holds the
    // engine's own result: nothing is recalculated, the style still lands.
    cmd.execute.bind(cmd)(new SetCellStyleCommand({ r: 0, c: 1, style: { bold: true } }));
    expect(calls).toBe(0);
    expect(value(store, 0, 1)).toBe(2);
    expect(value(store, 0, 2)).toBe(3);
    expect(store.getCell(0, 1)?.styleId).toBeDefined();
  });

  it('keeps readers current after a registration made outside the sync layer', () => {
    const { store, engine } = setup();
    put(store, 0, 0, '1');
    engine.setFormula('0,1', '=A1*2', ['0,0']);
    expect(value(store, 0, 1)).toBe(2);
    put(store, 0, 0, '3');
    expect(value(store, 0, 1)).toBe(6);
  });

  it('recalculates the formulas a redefined named range touches', () => {
    const { store } = setup();
    put(store, 0, 0, '1');
    put(store, 1, 0, '2');
    put(store, 0, 1, '=A1+A2');
    store.setNamedRange('Nums', { range: '0,0:1,0' });
    put(store, 0, 2, '=SUM(Nums)');
    expect(value(store, 0, 2)).toBe(3);
    store.setNamedRange('Nums', { range: '0,0:0,0' });
    expect(value(store, 0, 2)).toBe(1);
    // A formula that never used the name is not disturbed.
    expect(value(store, 0, 1)).toBe(3);
    store.removeNamedRange('Nums');
    expect(value(store, 0, 2)).toBe('#NAME?');
  });
});

describe('workbook replacement', () => {
  it('drops the registrations of cells the new workbook lacks', () => {
    const { store } = setup();
    put(store, 0, 0, '5');
    put(store, 0, 1, '=A1*2');
    expect(value(store, 0, 1)).toBe(10);
    store.replaceAll(new Store().serialize());
    put(store, 0, 0, '5');
    // B1 is empty in the new workbook: a leftover registration would write 10 into it.
    expect(store.getCell(0, 1)).toBeUndefined();
  });

  it('leaves no stale edge to flag a new formula as circular', () => {
    const { store } = setup();
    put(store, 0, 0, '1');
    put(store, 0, 1, '=A1*2');
    store.replaceAll(new Store().serialize());
    put(store, 0, 0, '=B1+1');
    expect(value(store, 0, 0)).toBe(1);
    put(store, 0, 1, '3');
    expect(value(store, 0, 0)).toBe(4);
  });

  it('recalculates the formulas of the workbook it loads', () => {
    const { store } = setup();
    put(store, 0, 0, '2');
    put(store, 0, 1, '=A1*3');
    const saved = store.serialize();
    store.replaceAll(new Store().serialize());
    store.replaceAll(saved);
    put(store, 0, 0, '4');
    expect(value(store, 0, 1)).toBe(12);
  });

  it('announces the replacement before replaying the cells', () => {
    const { store } = setup();
    put(store, 0, 0, '2');
    put(store, 0, 1, '=A1*3');
    const saved = store.serialize();
    const types: string[] = [];
    store.subscribe((event) => { types.push(event.type); });
    store.replaceAll(saved);
    expect(types[0]).toBe('workbook');
    expect(types.slice(1)).toContain('cell');
  });

  it('keeps a spilled formula spilling in a copied sheet', () => {
    const { store } = setup();
    put(store, 0, 0, '=SEQUENCE(3)');
    const copy = store.copySheet('sheet-1', { name: 'copy' });
    expect(copy).toBeDefined();
    expect(value(store, 0, 0, copy)).toBe(1);
    expect(value(store, 1, 0, copy)).toBe(2);
    expect(value(store, 2, 0, copy)).toBe(3);
    expect(store.getCell(1, 0, copy)?.spillOf).toBe(`${copy}:0,0`);
  });
});

afterEach(() => {
  calls = 0;
});
