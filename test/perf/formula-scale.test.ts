import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { createFormulaSync } from '../../src/formula/formulaSync';

/**
 * Wall-clock guards at the Excel grid size. The ceilings sit at several times
 * the development-machine measurements (see the console.log lines), so a
 * regression reports itself long before the cap is hit.
 */
describe('formula engine at scale', () => {
  function setup(): { store: Store; engine: FormulaEngine; put: (r: number, c: number, text: string) => void } {
    const store = new Store();
    const engine = new FormulaEngine(store);
    createFormulaSync(store, engine);
    const put = (r: number, c: number, text: string): void => {
      store.setCell(r, c, text.startsWith('=') ? { text, formula: text } : { text, value: Number(text) });
    };
    return { store, engine, put };
  }

  it('g1. enters 100k formulas and recalculates them well inside the caps', () => {
    const { store, engine, put } = setup();
    for (let r = 0; r < 100_000; r += 1) store.setCell(r, 0, { text: String(r + 1), value: r + 1 });

    const t0 = performance.now();
    for (let r = 0; r < 100_000; r += 1) put(r, 1, `=A${r + 1}*2`);
    const entryMs = performance.now() - t0;
    // Measured 0.7-1.7 s here. CI runs this file under coverage instrumentation
    // on a slower, loaded runner (~10x): the walls leave that much room, and
    // still sit far below the dense-edges behaviour that motivated them.
    expect(entryMs).toBeLessThan(20_000);
    expect(store.getCell(99_999, 1)?.value).toBe(200_000);

    const t1 = performance.now();
    engine.recalculateAll();
    const recalcMs = performance.now() - t1;
    expect(recalcMs).toBeLessThan(15_000); // measured ~0.9 s
    expect(store.getCell(0, 1)?.value).toBe(2);

    console.log(`scale: entry 100k = ${entryMs.toFixed(0)}ms, recalculateAll = ${recalcMs.toFixed(0)}ms`);
  }, 120_000);

  it('g2. SUM over a whole-column-sized range registers and evaluates in milliseconds', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    createFormulaSync(store, engine);
    for (let r = 0; r < 1_000_000; r += 1) store.setCell(r, 0, { text: String(r + 1), value: r + 1 });

    // evaluateNow is engine-private; time it through a wrapper so the
    // registration cost can be read separately from the evaluation cost.
    let evalMs = 0;
    const inner = (engine as unknown as { evaluateNow: (id: string) => void }).evaluateNow.bind(engine);
    (engine as unknown as { evaluateNow: (id: string) => void }).evaluateNow = (id: string): void => {
      const t = performance.now();
      inner(id);
      evalMs += performance.now() - t;
    };

    const t0 = performance.now();
    store.setCell(0, 2, { text: '=SUM(A1:A1048576)', formula: '=SUM(A1:A1048576)' });
    const totalMs = performance.now() - t0;
    const registerMs = totalMs - evalMs;
    expect(store.getCell(0, 2)?.value).toBe(500_000_500_000);
    // Registering the range must stay a constant-time operation: one edge per
    // cell of a million-cell range took ~1,500 ms here. Measured ~0.4 ms; the
    // wall leaves room for coverage instrumentation (~5x on this suite).
    expect(registerMs).toBeLessThan(50);
    // The evaluation floor is set outside the engine: the store walk over one
    // million stored cells is ~70 ms alone, and the forEachStoredCell contract
    // resolves each delivered address through the resolver (a second lookup).
    // The bare walk+read+sum loop measures ~122 ms; the engine adds ~30 ms on
    // top of that (measured ~45-135 ms). The walk is plain interpreted work, so
    // coverage instrumentation multiplies it (~340 ms under `pnpm coverage`,
    // which is what CI runs) and a loaded runner adds more: the wall leaves
    // more than an order of magnitude. The precise regression guards are the
    // exact evaluation count below and the registration wall above.
    expect(evalMs).toBeLessThan(8_000);

    // One changed precedent: exactly the SUM re-evaluates, nothing else.
    let evaluations = 0;
    (engine as unknown as { evaluateNow: (id: string) => void }).evaluateNow = (id: string): void => {
      evaluations += 1;
      inner(id);
    };
    const t1 = performance.now();
    store.setCell(5, 0, { text: '999999', value: 999999 });
    const changeMs = performance.now() - t1;
    expect(store.getCell(0, 2)?.value).toBe(500_000_500_000 - 6 + 999_999);
    expect(evaluations).toBe(1);
    expect(changeMs).toBeLessThan(8_000); // one re-evaluation of the same million-cell sum (same reasoning as the evalMs wall)

    console.log(`scale: SUM(1M) register = ${registerMs.toFixed(1)}ms, evaluate = ${evalMs.toFixed(0)}ms, one-cell change = ${changeMs.toFixed(0)}ms (${evaluations} evaluation)`);
  }, 120_000);
});
