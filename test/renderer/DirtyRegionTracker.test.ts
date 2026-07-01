import { describe, expect, it } from 'vitest';
import { DirtyRegionTracker } from '../../src/renderer/DirtyRegionTracker';

describe('DirtyRegionTracker', () => {
  it('tracks a single rect', () => {
    const dirty = new DirtyRegionTracker();

    dirty.invalidate({ x: 0, y: 0, w: 10, h: 10 });

    expect(dirty.drain()).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
  });

  it('merges overlapping rects', () => {
    const dirty = new DirtyRegionTracker();

    dirty.invalidate({ x: 0, y: 0, w: 10, h: 10 });
    dirty.invalidate({ x: 5, y: 5, w: 10, h: 10 });

    expect(dirty.drain()).toEqual([{ x: 0, y: 0, w: 15, h: 15 }]);
  });

  it('drain clears tracked regions', () => {
    const dirty = new DirtyRegionTracker();

    dirty.invalidate({ x: 0, y: 0, w: 10, h: 10 });
    const out = dirty.drain();

    expect(out).toHaveLength(1);
    expect(dirty.isEmpty()).toBe(true);
  });
});
