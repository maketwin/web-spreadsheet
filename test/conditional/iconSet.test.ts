import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { ConditionalService } from '../../src/conditional/ConditionalService';

function setup(): { store: Store; svc: ConditionalService } {
  const store = new Store();
  // B2:B5 = 10, 40, 30, 100
  store.setCell(1, 1, { text: '10', value: 10 });
  store.setCell(2, 1, { text: '40', value: 40 });
  store.setCell(3, 1, { text: '30', value: 30 });
  store.setCell(4, 1, { text: '100', value: 100 });
  return { store, svc: new ConditionalService() };
}

describe('icon set rules', () => {
  it('percent basis buckets by range min..max (Excel 67/33 default)', () => {
    const { store, svc } = setup();
    store.setConditionalRule('1,1:4,1', [{ type: 'iconSet', icons: 'arrows3' }]);
    // span = 10..100 → hi = 10+0.67*90 = 70.3, lo = 10+0.33*90 = 39.7
    expect(svc.computeOverlay(store, 4, 1).icon).toEqual({ icons: 'arrows3', level: 0 }); // 100 → top
    expect(svc.computeOverlay(store, 2, 1).icon).toEqual({ icons: 'arrows3', level: 1 }); // 40 ≥ 39.7 → mid
    expect(svc.computeOverlay(store, 3, 1).icon).toEqual({ icons: 'arrows3', level: 2 }); // 30 < 39.7 → bottom
    expect(svc.computeOverlay(store, 1, 1).icon).toEqual({ icons: 'arrows3', level: 2 }); // 10 → bottom
  });

  it('num basis uses literal thresholds', () => {
    const { store, svc } = setup();
    store.setConditionalRule('1,1:4,1', [{ type: 'iconSet', icons: 'lights3', thresholds: [50, 15], basis: 'num' }]);
    expect(svc.computeOverlay(store, 4, 1).icon?.level).toBe(0); // 100 ≥ 50
    expect(svc.computeOverlay(store, 2, 1).icon?.level).toBe(1); // 40 ≥ 15
    expect(svc.computeOverlay(store, 1, 1).icon?.level).toBe(2); // 10 < 15
  });

  it('non-numeric cells get no icon; cells outside the range are untouched', () => {
    const { store, svc } = setup();
    store.setCell(3, 1, { text: 'abc' });
    store.setConditionalRule('1,1:4,1', [{ type: 'iconSet', icons: 'arrows3' }]);
    expect(svc.computeOverlay(store, 3, 1).icon).toBeUndefined();
    expect(svc.computeOverlay(store, 0, 1).icon).toBeUndefined();
  });

  it('disabled rules do not paint', () => {
    const { store, svc } = setup();
    store.setConditionalRule('1,1:4,1', [{ type: 'iconSet', icons: 'arrows3', disabled: true }]);
    expect(svc.computeOverlay(store, 4, 1).icon).toBeUndefined();
  });
});
