import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import { ConditionalService } from '../../src/conditional/ConditionalService';
import { TOTAL_ROWS } from '../../src/util/gridSize';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('icon-set range stats at full-column scale', () => {
  it('computes min/max from stored cells only, never one getCell per address-space row', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(5, 0, { text: '50', value: 50 });
    store.setCell(TOTAL_ROWS - 1, 0, { text: '20', value: 20 }); // deep inside the address space
    // Rule range spans the whole first column — every grid row is an address.
    store.setConditionalRule(`0,0:${TOTAL_ROWS - 1},0`, [{ type: 'iconSet', icons: 'arrows3' }]);

    const getCell = vi.spyOn(Store.prototype, 'getCell');
    const svc = new ConditionalService();
    const overlay = svc.computeOverlay(store, 5, 0);
    // 50 of 10..50: hi (67%) = 36.8 → top icon.
    expect(overlay.icon?.level).toBe(0);
    // The stored cells of the column — not one getCell per grid row.
    expect(getCell.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('percent levels stay correct when the rule range holds sparse rows', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(TOTAL_ROWS - 1, 0, { text: '30', value: 30 });
    store.setConditionalRule(`0,0:${TOTAL_ROWS - 1},0`, [{ type: 'iconSet', icons: 'arrows3' }]);
    const svc = new ConditionalService();
    store.setCell(5, 0, { text: '20', value: 20 });
    // 10..30: lo 16.7 / hi 23.4 → 20 lands in the middle.
    expect(svc.computeOverlay(store, 5, 0).icon?.level).toBe(1);
    expect(svc.computeOverlay(store, TOTAL_ROWS - 1, 0).icon?.level).toBe(0);
    expect(svc.computeOverlay(store, 0, 0).icon?.level).toBe(2);
  });
});
