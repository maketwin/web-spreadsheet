import { describe, expect, it, vi, afterEach } from 'vitest';
import { Store } from '../../src/store/Store';
import { ConditionalService } from '../../src/conditional/ConditionalService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('icon-set range stats invalidation', () => {
  it('never subscribes to the store — staleness is detected via store.revision', () => {
    const store = new Store();
    const subscribeSpy = vi.spyOn(store, 'subscribe');
    store.setCell(0, 1, { text: '10', value: 10 });
    store.setConditionalRule('0,1:2,1', [{ type: 'iconSet', icons: 'arrows3' }]);

    const svc = new ConditionalService();
    svc.computeOverlay(store, 0, 1); // fills the stats cache

    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it('recomputes stale stats after the store changes', () => {
    const store = new Store();
    // B1:B3 = 10,20,30 — span 10..30, hi = 23.4: B2 (20) lands in the middle.
    store.setCell(0, 1, { text: '10', value: 10 });
    store.setCell(1, 1, { text: '20', value: 20 });
    store.setCell(2, 1, { text: '30', value: 30 });
    store.setConditionalRule('0,1:2,1', [{ type: 'iconSet', icons: 'arrows3' }]);

    const svc = new ConditionalService();
    expect(svc.computeOverlay(store, 1, 1).icon?.level).toBe(1);

    // B3 drops to 20 — span 10..20, hi = 16.7: B2 (20) now lands on top.
    store.setCell(2, 1, { text: '20', value: 20 });
    expect(svc.computeOverlay(store, 1, 1).icon?.level).toBe(0);
  });

  it('does not leak stats across different stores', () => {
    const storeA = new Store();
    storeA.setCell(0, 1, { text: '10', value: 10 });
    storeA.setCell(1, 1, { text: '20', value: 20 });
    storeA.setCell(2, 1, { text: '30', value: 30 });
    storeA.setConditionalRule('0,1:2,1', [{ type: 'iconSet', icons: 'arrows3' }]);
    const storeB = new Store();
    storeB.setCell(0, 1, { text: '100', value: 100 });
    storeB.setCell(1, 1, { text: '150', value: 150 });
    storeB.setCell(2, 1, { text: '300', value: 300 });
    storeB.setConditionalRule('0,1:2,1', [{ type: 'iconSet', icons: 'arrows3' }]);

    const svc = new ConditionalService();
    expect(svc.computeOverlay(storeA, 1, 1).icon?.level).toBe(1); // 20 of 10..30

    // storeB's span is 100..300 (lo = 166): B2 = 150 lands at the bottom there.
    expect(svc.computeOverlay(storeB, 1, 1).icon?.level).toBe(2);
    // And back on storeA the cache must have been dropped, not reused.
    expect(svc.computeOverlay(storeA, 1, 1).icon?.level).toBe(1);
  });
});
