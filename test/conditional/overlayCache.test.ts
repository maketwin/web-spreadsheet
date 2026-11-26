import { describe, expect, it, vi, afterEach } from 'vitest';
import { Store } from '../../src/store/Store';
import { ConditionalService, MAX_CACHED_OVERLAYS, MAX_CACHED_RULE_FORMULAS } from '../../src/conditional/ConditionalService';
import type { ConditionalOverlay } from '../../src/conditional/ConditionalRule';

afterEach(() => {
  vi.restoreAllMocks();
});

const RED = { type: 'cellValue', operator: 'gt', value: 10, style: { bgcolor: '#FF0000' } } as const;
const GREEN = { type: 'cellValue', operator: 'gt', value: 10, style: { bgcolor: '#00FF00' } } as const;

/** The per-cell overlay cache is private; the test below observes its size. */
const overlayCacheOf = (service: ConditionalService): Map<string, Map<number, ConditionalOverlay>> =>
  (service as unknown as { overlays: Map<string, Map<number, ConditionalOverlay>> }).overlays;

const totalEntries = (cache: Map<string, Map<number, ConditionalOverlay>>): number => {
  let n = 0;
  for (const perSheet of cache.values()) n += perSheet.size;
  return n;
};

describe('per-cell overlay cache', () => {
  it('serves repeated reads of one cell from the cache within a revision', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '50', value: 50 });
    store.setConditionalRule('0,0:0,0', [RED]);

    const getCellSpy = vi.spyOn(store, 'getCell');
    const svc = new ConditionalService();
    const first = svc.computeOverlay(store, 0, 0);
    const callsAfterFirst = getCellSpy.mock.calls.length;
    expect(first.style?.bgcolor).toBe('#FF0000');

    const second = svc.computeOverlay(store, 0, 0);
    const third = svc.computeOverlay(store, 0, 0);
    // Rule evaluation happened once — the repeats never touch the store.
    expect(getCellSpy.mock.calls.length).toBe(callsAfterFirst);
    // Same revision, same cell: literally the same object.
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(third.style?.bgcolor).toBe('#FF0000');
  });

  it('recomputes after a cell value changes', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '5', value: 5 });
    store.setConditionalRule('0,0:0,0', [RED]);

    const getCellSpy = vi.spyOn(store, 'getCell');
    const svc = new ConditionalService();
    expect(svc.computeOverlay(store, 0, 0).style).toBeUndefined();
    const callsBefore = getCellSpy.mock.calls.length;

    store.setCell(0, 0, { text: '50', value: 50 });
    const overlay = svc.computeOverlay(store, 0, 0);
    expect(overlay.style?.bgcolor).toBe('#FF0000');
    // The stale entry was dropped, not served: the cell was read again.
    expect(getCellSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('recomputes after the rules change', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '50', value: 50 });

    const svc = new ConditionalService();
    store.setConditionalRule('0,0:0,0', [RED]);
    expect(svc.computeOverlay(store, 0, 0).style?.bgcolor).toBe('#FF0000');

    store.setConditionalRule('0,0:0,0', [GREEN]);
    expect(svc.computeOverlay(store, 0, 0).style?.bgcolor).toBe('#00FF00');

    store.removeConditionalRule('0,0:0,0');
    expect(svc.computeOverlay(store, 0, 0).style).toBeUndefined();
  });

  it('keeps sheets apart, active and explicit', () => {
    const store = new Store();
    const mainId = store.getActiveSheetId();
    // addSheet activates the new sheet, so every write below passes an id.
    const otherId = store.addSheet('Other');
    store.setCell(0, 0, { text: '50', value: 50 }, mainId);
    store.setCell(0, 0, { text: '50', value: 50 }, otherId);
    store.setConditionalRule('0,0:0,0', [RED], mainId);
    store.setConditionalRule('0,0:0,0', [GREEN], otherId);

    const svc = new ConditionalService();
    store.activateSheet(mainId);
    // Warm both sheets, then read again within the same revision.
    expect(svc.computeOverlay(store, 0, 0).style?.bgcolor).toBe('#FF0000');
    expect(svc.computeOverlay(store, 0, 0, otherId).style?.bgcolor).toBe('#00FF00');
    expect(svc.computeOverlay(store, 0, 0).style?.bgcolor).toBe('#FF0000');
    expect(svc.computeOverlay(store, 0, 0, otherId).style?.bgcolor).toBe('#00FF00');

    // Omitted sheetId follows the active sheet, also from the cache.
    store.activateSheet(otherId);
    expect(svc.computeOverlay(store, 0, 0).style?.bgcolor).toBe('#00FF00');
    expect(svc.computeOverlay(store, 0, 0).style?.bgcolor).toBe('#00FF00');
  });

  it('does not leak overlays across different stores', () => {
    const storeA = new Store();
    storeA.setCell(0, 0, { text: '50', value: 50 });
    storeA.setConditionalRule('0,0:0,0', [RED]);
    const storeB = new Store();
    storeB.setCell(0, 0, { text: '5', value: 5 });
    storeB.setConditionalRule('0,0:0,0', [RED]);

    const svc = new ConditionalService();
    expect(svc.computeOverlay(storeA, 0, 0).style?.bgcolor).toBe('#FF0000');
    // Same revision numbers, different stores — the instance check must drop, not reuse.
    expect(svc.computeOverlay(storeB, 0, 0).style).toBeUndefined();
    expect(svc.computeOverlay(storeA, 0, 0).style?.bgcolor).toBe('#FF0000');
  });

  it('stays correct when the entry cap clears the cache mid-use', () => {
    const store = new Store();
    for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 5; c += 1) store.setCell(r, c, { text: String(r + c), value: r + c });
    }
    store.setConditionalRule('0,0:9,4', [{ type: 'cellValue', operator: 'gt', value: 5, style: { bold: true } }]);

    const svc = new ConditionalService(MAX_CACHED_RULE_FORMULAS, 10); // tiny overlay cap
    for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 5; c += 1) svc.computeOverlay(store, r, c);
    }
    // 50 distinct cells crossed the cap of 10 several times: never above it.
    expect(totalEntries(overlayCacheOf(svc))).toBeLessThanOrEqual(10);
    expect(MAX_CACHED_OVERLAYS).toBeGreaterThan(10);

    // Cleared mid-walk or cached, every cell keeps its own correct result.
    for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const overlay = svc.computeOverlay(store, r, c);
        if (r + c > 5) expect(overlay.style?.bold).toBe(true);
        else expect(overlay.style).toBeUndefined();
      }
    }
  });

  it('never subscribes to the store', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '50', value: 50 });
    store.setConditionalRule('0,0:0,0', [RED]);

    const subscribeSpy = vi.spyOn(store, 'subscribe');
    const svc = new ConditionalService();
    svc.computeOverlay(store, 0, 0);
    svc.computeOverlay(store, 0, 0);

    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it('evaluates a formula rule once per revision, not once per read', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(0, 1, { text: '5', value: 5 });
    store.setConditionalRule('0,0:0,1', [{ type: 'formula', formula: '=A1>5', style: { bgcolor: '#FFFF00' } }]);

    const getCellSpy = vi.spyOn(store, 'getCell');
    const svc = new ConditionalService();
    const first = svc.computeOverlay(store, 0, 0);
    expect(first.style?.bgcolor).toBe('#FFFF00');
    const callsAfterFirst = getCellSpy.mock.calls.length;

    expect(svc.computeOverlay(store, 0, 0)).toBe(first);
    expect(svc.computeOverlay(store, 0, 0)).toBe(first);
    // The shifted-formula evaluate (which reads cells) ran once, not per read.
    expect(getCellSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('does not alias off-grid coordinates onto cached grid entries', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setConditionalRule('-1,25:-1,25', [{ type: 'formula', formula: '=$A$1>5', style: { bold: true } }]);

    const svc = new ConditionalService();
    // (-1, 25) and (0, -1) share the naive r * TOTAL_COLS + c index (-1):
    // each must get its own computed result, never the other's cached one.
    expect(svc.computeOverlay(store, -1, 25).style?.bold).toBe(true);
    expect(svc.computeOverlay(store, 0, -1).style).toBeUndefined();
  });
});
