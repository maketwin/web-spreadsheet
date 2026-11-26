import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';

// `isFlushing()` must hold for the whole outermost flush. A batchEnd listener
// that opens a nested batch (the formula engine's spill writes do exactly
// this) ends that nested batch while the outer flush is still delivering —
// a plain boolean flag lost that state, so later events of the outer flush
// were delivered as "not flushing".
describe('batch flush nesting', () => {
  it('keeps isFlushing true across a nested batch opened from onBatchEnd', () => {
    const store = new Store();
    const flushingAtDelivery: boolean[] = [];
    const offSubscriber = store.subscribe(() => { flushingAtDelivery.push(store.isFlushing()); });

    let flushingInsideListener: boolean | undefined;
    const offBatchEnd = store.onBatchEnd(() => {
      offBatchEnd(); // run once: the nested batch's own flush re-fires listeners
      store.batch(() => { store.setCell(1, 0, { text: 'nested' }); });
      flushingInsideListener = store.isFlushing();
      // Written outside any batch while the outer flush is still unwinding.
      store.setCell(2, 0, { text: 'after-nested' });
    });

    store.batch(() => { store.setCell(0, 0, { text: 'outer' }); });
    offSubscriber();

    expect(flushingInsideListener).toBe(true);
    // Outer batch, nested batch, and the listener's own write — every event
    // was delivered while the outermost flush was still in progress.
    expect(flushingAtDelivery).toEqual([true, true, true]);
  });

  it('is false in the batch body and once the outermost flush ends', () => {
    const store = new Store();
    expect(store.isFlushing()).toBe(false);
    const seen: boolean[] = [];
    const off = store.subscribe(() => { seen.push(store.isFlushing()); });
    store.batch(() => {
      // Batch body: events are only queued, not being delivered yet.
      expect(store.isFlushing()).toBe(false);
      store.setCell(0, 0, { text: 'a' });
    });
    off();
    expect(seen).toEqual([true]);
    expect(store.isFlushing()).toBe(false);
  });

  it('a throwing onBatchEnd listener leaves the count balanced', () => {
    const store = new Store();
    const offBatchEnd = store.onBatchEnd(() => { throw new Error('listener boom'); });

    expect(() => store.batch(() => { store.setCell(0, 0, { text: 'first' }); })).toThrow('listener boom');
    offBatchEnd();

    expect(store.isFlushing()).toBe(false);
    // The next batch still delivers its events normally.
    const events: string[] = [];
    const off = store.subscribe((event) => { events.push(event.type); });
    store.batch(() => { store.setCell(1, 1, { text: 'second' }); });
    off();
    expect(events).toEqual(['cell']);
    expect(store.isFlushing()).toBe(false);
  });

  it('an empty batch still fires no onBatchEnd', () => {
    const store = new Store();
    let ends = 0;
    const off = store.onBatchEnd(() => { ends += 1; });
    store.batch(() => { store.getCell(0, 0); });
    store.batch(() => { store.batch(() => { /* nested, no writes */ }); });
    off();
    expect(ends).toBe(0);
  });
});
