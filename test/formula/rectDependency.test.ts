import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';
import type { DependencyGraph } from '../../src/formula/dependency';

type GraphInternals = { reverse: Map<string, Set<string>> };

function setup(): { store: Store; engine: FormulaEngine; put: (r: number, c: number, text: string) => void; value: (r: number, c: number) => unknown } {
  const store = new Store();
  const engine = new FormulaEngine(store);
  createFormulaSync(store, engine);
  const put = (r: number, c: number, text: string): void => {
    store.setCell(r, c, text.startsWith('=') ? { text, formula: text } : { text, value: Number(text) });
  };
  return { store, engine, put, value: (r, c) => store.getCell(r, c)?.value };
}

const graphOf = (engine: FormulaEngine): DependencyGraph => (engine as unknown as { graph: DependencyGraph }).graph;
/** Per-cell precedents registered for one formula (rectangle-derived edges included). */
const reverseDepCount = (engine: FormulaEngine, scopedId: string): number =>
  (graphOf(engine) as unknown as GraphInternals).reverse.get(scopedId)?.size ?? 0;
/** Registered readers of the rectangle covering (r, c) — behavioral probe for the index. */
const rectDependentsOf = (engine: FormulaEngine, sheetId: string, r: number, c: number): readonly string[] =>
  graphOf(engine).rectDependents(sheetId, r, c);

/**
 * Ranges above RANGE_DEP_CELLS (256) register one rectangle dependency
 * instead of one edge per cell; a change inside the rectangle wakes the
 * owner through the rectangle index.
 */
describe('rectangle dependencies', () => {
  it('d. a change inside a big range recalculates its owner through one rectangle, not 1000 edges', () => {
    const { engine, put, value } = setup();
    for (let r = 0; r < 1000; r += 1) put(r, 0, String(r + 1));
    put(0, 2, '=SUM(A1:A1000)');
    expect(value(0, 2)).toBe(500500);
    // The range registered as a rectangle: the owner's per-cell edges stay
    // near zero instead of one per cell of the range.
    expect(reverseDepCount(engine, 'sheet-1:0,2')).toBeLessThanOrEqual(5);
    put(499, 0, '10000');
    expect(value(0, 2)).toBe(500500 - 500 + 10000);
    put(999, 0, '1');
    expect(value(0, 2)).toBe(500500 - 500 + 10000 - 1000 + 1);
  });

  it('d2. small ranges keep their exact per-cell edges', () => {
    const { engine, put } = setup();
    for (let r = 0; r < 100; r += 1) put(r, 0, '1');
    put(0, 2, '=SUM(A1:A100)');
    expect(reverseDepCount(engine, 'sheet-1:0,2')).toBe(100);
  });

  it('e. a formula that sits inside its own big range is circular and shows 0', () => {
    const { put, value } = setup();
    for (let r = 0; r < 1000; r += 1) if (r !== 4) put(r, 0, '1');
    put(4, 0, '=SUM(A1:A1000)');
    expect(value(4, 0)).toBe(0); // ring (iteration off), not 999 or a hang
  });

  it('e2. a small mutual ring through a range stays detected', () => {
    const { put, value } = setup();
    put(0, 1, '=SUM(A1:A3)');
    put(0, 0, '=B1');
    expect(value(0, 0)).toBe(0);
    expect(value(0, 1)).toBe(0);
  });

  it('e3. a later formula inside someone else’s rectangle closes a ring (owner edge)', () => {
    const { put, value } = setup();
    for (let r = 0; r < 1000; r += 1) if (r !== 4) put(r, 0, '1');
    put(0, 2, '=SUM(A1:A1000)');
    expect(value(0, 2)).toBe(999);
    // A5 reads C1; C1's rectangle covers A5 — that is a ring the moment A5 registers.
    put(4, 0, '=C1');
    expect(value(4, 0)).toBe(0);
    expect(value(0, 2)).toBe(0);
  });

  it('d3. the owner keeps following the rectangle after formulas register inside it', () => {
    // Regression: adding the owner→formula edge used to rebuild the owner's
    // dependency set, which dropped its rectangle registration — after the
    // first formula inside, the total stopped tracking the range.
    const { engine, put, value } = setup();
    put(0, 1, '=SUM(B2:B1000000)');
    put(1, 0, '1'); put(1, 1, '=A2*2');
    expect(value(0, 1)).toBe(2);
    put(2, 0, '1'); put(2, 1, '=A3*2');
    expect(value(0, 1)).toBe(4);
    // A plain value inside the rectangle changes.
    put(9, 1, '5');
    expect(value(0, 1)).toBe(9);
    // The source of an inside formula changes.
    put(2, 0, '10');
    expect(value(0, 1)).toBe(27);
    // An inside cell is cleared.
    put(9, 1, '');
    expect(value(0, 1)).toBe(22);
    // The rectangle registration survived it all: the owner is still the
    // registered reader of cells inside the range (behavioral probe).
    expect(rectDependentsOf(engine, 'sheet-1', 500, 1)).toContain('sheet-1:0,1');
  });

  it('d4. a cross-sheet owner follows formulas entered on the data sheet', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    createFormulaSync(store, engine);
    const summary = store.addSheet('Summary');
    const data = store.getSheets().find((s) => s.name === 'Sheet1')!.id;
    const putOn = (sheetId: string, r: number, c: number, text: string): void => {
      store.setCell(r, c, text.startsWith('=') ? { text, formula: text } : { text, value: Number(text) }, sheetId);
    };
    putOn(summary, 0, 0, '=SUM(Sheet1!B2:B1000000)');
    putOn(data, 1, 0, '1'); putOn(data, 1, 1, '=A2*2');
    expect(store.getCell(0, 0, summary)?.value).toBe(2);
    putOn(data, 2, 0, '1'); putOn(data, 2, 1, '=A3*2');
    expect(store.getCell(0, 0, summary)?.value).toBe(4);
    putOn(data, 9, 1, '5');
    expect(store.getCell(0, 0, summary)?.value).toBe(9);
    putOn(data, 2, 0, '10');
    expect(store.getCell(0, 0, summary)?.value).toBe(27);
    putOn(data, 9, 1, '');
    expect(store.getCell(0, 0, summary)?.value).toBe(22);
    // The rectangle on the data sheet still names the cross-sheet owner.
    expect(rectDependentsOf(engine, data, 500, 1)).toContain(`${summary}:0,0`);
  });

  it('d5. entering many formulas inside the rectangle stays linear and exact', () => {
    const { store, engine, put, value } = setup();
    put(0, 1, '=SUM(B2:B1048576)');
    for (let r = 1; r <= 5_000; r += 1) put(r, 0, String(r));
    const started = performance.now();
    store.batch(() => {
      for (let r = 1; r <= 5_000; r += 1) store.setCell(r, 1, { text: `=A${r + 1}*2`, formula: `=A${r + 1}*2` });
    });
    const elapsed = performance.now() - started;
    expect(value(0, 1)).toBe(25_005_000);
    // Development machine: ~70 ms for the batch; the cap leaves room for CI
    // (coverage instrumentation on a slower, loaded runner, ~10x). A
    // regression to per-entry rectangle rebuilds goes quadratic.
    expect(elapsed).toBeLessThan(3000);
    expect(rectDependentsOf(engine, 'sheet-1', 3_000, 1)).toContain('sheet-1:0,1');
  });

  it('e4. the owner registering after a formula landed inside its rectangle closes a ring', () => {
    const { put, value } = setup();
    for (let r = 0; r < 1000; r += 1) if (r !== 499) put(r, 0, '1');
    put(498, 0, '=C1'); // A499 reads C1 before C1 exists
    put(0, 2, '=SUM(A1:A1000)'); // C1's rectangle covers A499: ring at registration
    expect(value(0, 2)).toBe(0);
    expect(value(498, 0)).toBe(0);
  });
});
