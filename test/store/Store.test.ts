import { describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';

import type { StoreEvent } from '../../src/types';

describe('Store', () => {
  it('setCell + getCell', () => {
    const store = new Store();

    store.setCell(0, 0, { text: 'hi' });

    expect(store.getCell(0, 0)).toEqual({ text: 'hi' });
  });

  it('setCell null deletes', () => {
    const store = new Store();

    store.setCell(0, 0, { text: 'hi' });
    store.setCell(0, 0, undefined);

    expect(store.getCell(0, 0)).toBeUndefined();
  });

  it('subscribe receives event', () => {
    const store = new Store();
    const events: StoreEvent[] = [];

    store.subscribe((event) => events.push(event));
    store.setCell(0, 0, { text: 'x' });

    expect(events).toEqual([{ type: 'cell', r: 0, c: 0, cell: { text: 'x' } }]);
  });

  it('unsubscribe', () => {
    const store = new Store();
    const fn = vi.fn();
    const off = store.subscribe(fn);

    off();
    store.setCell(0, 0, { text: 'x' });

    expect(fn).not.toHaveBeenCalled();
  });

  it('serialize/deserialize round trip', () => {
    const store = new Store();

    store.setCell(0, 0, { text: 'a' });
    store.setRow(0, { height: 30 });
    store.setCol(1, { width: 120 });
    store.setStyle('s1', { bold: true });
    store.addMerge('A1:B2');

    const restored = Store.deserialize(store.serialize());

    expect(restored.getCell(0, 0)).toEqual({ text: 'a' });
    expect(restored.getRow(0)).toEqual({ height: 30 });
    expect(restored.getCol(1)).toEqual({ width: 120 });
    expect(restored.getStyle('s1')).toEqual({ bold: true });
    expect(restored.getMerges()).toEqual(['A1:B2']);
  });
});
