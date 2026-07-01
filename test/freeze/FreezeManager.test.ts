import { describe, it, expect } from 'vitest';
import { FreezeManager } from '../../src/freeze/FreezeManager';

describe('FreezeManager', () => {
  it('set and get freeze state', () => {
    const mgr = new FreezeManager({ totalRows: 1000, totalCols: 26 });
    expect(mgr.isFrozen()).toBe(false);
    expect(mgr.getFrozenRows()).toBe(0);
    expect(mgr.getFrozenCols()).toBe(0);

    // Cell B2 → freeze row 1 + col A → frozenRows=1, frozenCols=1
    mgr.freezeAt(1, 1);
    expect(mgr.isFrozen()).toBe(true);
    expect(mgr.getFrozenRows()).toBe(1);
    expect(mgr.getFrozenCols()).toBe(1);
    expect(mgr.getState()).toEqual({ frozenRows: 1, frozenCols: 1 });

    mgr.unfreeze();
    expect(mgr.isFrozen()).toBe(false);
    expect(mgr.getFrozenRows()).toBe(0);
    expect(mgr.getFrozenCols()).toBe(0);
  });

  it('adjusts visible range to exclude frozen area', () => {
    const mgr = new FreezeManager({ totalRows: 1000, totalCols: 26 });
    mgr.freezeAt(2, 3);

    const vis = { startRow: 0, endRow: 50, startCol: 0, endCol: 20 };
    const adjusted = mgr.adjustVisibleRange(vis);
    expect(adjusted.startRow).toBe(2);
    expect(adjusted.startCol).toBe(3);
    expect(adjusted.endRow).toBe(50);
    expect(adjusted.endCol).toBe(20);

    // Unfrozen — no adjustment
    mgr.unfreeze();
    const vis2 = { startRow: 0, endRow: 50, startCol: 0, endCol: 20 };
    const adj2 = mgr.adjustVisibleRange(vis2);
    expect(adj2.startRow).toBe(0);
    expect(adj2.startCol).toBe(0);
  });

  it('clamps freeze to total rows/cols', () => {
    const mgr = new FreezeManager({ totalRows: 10, totalCols: 5 });
    mgr.freezeAt(100, 100);
    expect(mgr.getFrozenRows()).toBe(10);
    expect(mgr.getFrozenCols()).toBe(5);
  });
});
