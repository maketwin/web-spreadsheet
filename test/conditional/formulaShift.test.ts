import { describe, expect, it, vi, afterEach } from 'vitest';
import { Store } from '../../src/store/Store';
import { ConditionalService } from '../../src/conditional/ConditionalService';
import { FormulaParser } from '../../src/formula/parser';
import { TOTAL_ROWS } from '../../src/util/gridSize';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('conditional formula rules shifted per cell', () => {
  it('evaluates the formula relative to each cell (Excel: anchor is the range top-left)', () => {
    const store = new Store();
    // A1:A3 = 100,200,3 and B1:B3 = 10,20,9; rule range B1:B3, formula `=B1>A1`.
    store.setCell(0, 0, { text: '100', value: 100 });
    store.setCell(1, 0, { text: '200', value: 200 });
    store.setCell(2, 0, { text: '3', value: 3 });
    store.setCell(0, 1, { text: '10', value: 10 });
    store.setCell(1, 1, { text: '20', value: 20 });
    store.setCell(2, 1, { text: '9', value: 9 });
    store.setConditionalRule('0,1:2,1', [{ type: 'formula', formula: '=B1>A1', style: { bold: true } }]);

    const svc = new ConditionalService();

    expect(svc.computeOverlay(store, 0, 1).style?.bold).toBeUndefined(); // 10 > 100
    expect(svc.computeOverlay(store, 1, 1).style?.bold).toBeUndefined(); // 20 > 200
    expect(svc.computeOverlay(store, 2, 1).style?.bold).toBe(true); // 9 > 3
  });

  it('keeps $-anchored references fixed while shifting relative ones', () => {
    const store = new Store();
    // A = 12,200,3; B = 10,20,1. Anchored `=$B$1` stays B1 = 10.
    store.setCell(0, 0, { text: '12', value: 12 });
    store.setCell(1, 0, { text: '200', value: 200 });
    store.setCell(2, 0, { text: '3', value: 3 });
    store.setCell(0, 1, { text: '10', value: 10 });
    store.setCell(1, 1, { text: '20', value: 20 });
    store.setCell(2, 1, { text: '1', value: 1 });
    store.setConditionalRule('0,1:2,1', [{ type: 'formula', formula: '=$B$1>A1', style: { bold: true } }]);

    const svc = new ConditionalService();

    expect(svc.computeOverlay(store, 0, 1).style?.bold).toBeUndefined(); // 10 > 12
    expect(svc.computeOverlay(store, 1, 1).style?.bold).toBeUndefined(); // 10 > 200
    expect(svc.computeOverlay(store, 2, 1).style?.bold).toBe(true); // 10 > 3 — B3 would give false
  });

  it('does not shift string literals that look like references', () => {
    const store = new Store();
    store.setCell(0, 1, { text: 'A2', value: 'A2' });
    store.setCell(1, 1, { text: 'A2', value: 'A2' });
    store.setCell(2, 1, { text: 'A2', value: 'A2' });
    // If the literal were shifted it would become "A2" on rows 2..3 and match.
    store.setConditionalRule('0,1:2,1', [{ type: 'formula', formula: '=B1="A1"', style: { bold: true } }]);

    const svc = new ConditionalService();

    expect(svc.computeOverlay(store, 0, 1).style?.bold).toBeUndefined();
    expect(svc.computeOverlay(store, 1, 1).style?.bold).toBeUndefined();
    expect(svc.computeOverlay(store, 2, 1).style?.bold).toBeUndefined();
  });

  it('treats a relative reference pushed off the grid as a miss, the rest of the range still paints', () => {
    const store = new Store();
    // A1000 = 5; formula `=A1000>0` on A999:A1000. The bottom cell shifts the
    // reference past the last row → `#REF!`, never a hit.
    store.setCell(TOTAL_ROWS - 1, 0, { text: '5', value: 5 });
    store.setConditionalRule(`${TOTAL_ROWS - 2},0:${TOTAL_ROWS - 1},0`, [{ type: 'formula', formula: `=A${TOTAL_ROWS}>0`, style: { bold: true } }]);

    const svc = new ConditionalService();

    expect(svc.computeOverlay(store, TOTAL_ROWS - 2, 0).style?.bold).toBe(true); // unshifted: 5 > 0
    expect(svc.computeOverlay(store, TOTAL_ROWS - 1, 0).style?.bold).toBeUndefined(); // #REF! → miss
  });

  it('parses every shifted variant once — repaints reuse the cached ASTs', () => {
    const store = new Store();
    for (let r = 0; r < 1000; r += 1) {
      store.setCell(r, 0, { text: '10', value: 10 });
      store.setCell(r, 1, { text: r === 500 ? '1' : '99', value: r === 500 ? 1 : 99 });
    }
    store.setConditionalRule('0,1:999,1', [{ type: 'formula', formula: '=B1>A1', style: { bold: true } }]);

    const parseSpy = vi.spyOn(FormulaParser.prototype, 'parse');
    const svc = new ConditionalService();

    expect(svc.computeOverlay(store, 0, 1).style?.bold).toBe(true);
    expect(svc.computeOverlay(store, 500, 1).style?.bold).toBeUndefined();

    for (let r = 0; r < 1000; r += 1) svc.computeOverlay(store, r, 1);
    // 1000 cells, 1000 distinct shifted texts — parsed exactly once each.
    expect(parseSpy).toHaveBeenCalledTimes(1000);

    const beforeSecondPass = parseSpy.mock.calls.length;
    for (let r = 0; r < 1000; r += 1) svc.computeOverlay(store, r, 1);
    expect(parseSpy.mock.calls.length).toBe(beforeSecondPass); // repaint: zero re-parses
  });
});
