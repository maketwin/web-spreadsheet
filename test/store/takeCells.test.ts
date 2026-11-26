import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS } from '../../src/util/gridSize';
import type { StoreEvent } from '../../src/types';

/** The bulk clear's store primitive: one sweep, one `cells` event, nothing per cell. */
describe('Store.takeCellsInRect', () => {
  function seeded(rows: number, cols: number): Store {
    const store = new Store();
    store.batch(() => {
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) store.setCell(r, c, { text: `${r},${c}`, value: r * 1000 + c });
      }
    });
    return store;
  }

  it('hands back exactly the stored cells inside the rectangle, keyed r * TOTAL_COLS + c, and removes them', () => {
    const store = seeded(5, 3);
    const taken = store.takeCellsInRect({ r1: 1, c1: 1, r2: 3, c2: 2 });
    expect(new Map(taken)).toEqual(new Map([
      [1 * TOTAL_COLS + 1, { text: '1,1', value: 1001 }],
      [1 * TOTAL_COLS + 2, { text: '1,2', value: 1002 }],
      [2 * TOTAL_COLS + 1, { text: '2,1', value: 2001 }],
      [2 * TOTAL_COLS + 2, { text: '2,2', value: 2002 }],
      [3 * TOTAL_COLS + 1, { text: '3,1', value: 3001 }],
      [3 * TOTAL_COLS + 2, { text: '3,2', value: 3002 }],
    ]));
    expect(store.getCell(1, 1)).toBeUndefined();
    expect(store.getCell(3, 2)).toBeUndefined();
    expect(store.getCell(0, 1)).toBeDefined(); // above the rectangle
    expect(store.getCell(1, 0)).toBeDefined(); // left of it
    expect(store.getCellCount()).toBe(15 - 6);
  });

  it('announces the removal with ONE cells event whose keys are the taken cells', () => {
    const store = seeded(3, 3);
    const events: StoreEvent[] = [];
    const off = store.subscribe((e) => events.push(e));
    const taken = store.takeCellsInRect({ r1: 0, c1: 0, r2: 2, c2: 0 });
    off();
    const [event] = events;
    expect(event?.type).toBe('cells');
    if (event?.type !== 'cells') throw new Error('expected one cells event');
    expect(event.sheetId).toBe(store.getActiveSheetId());
    expect([...event.keys].sort()).toEqual(taken.map(([key]) => key).sort());
  });

  it('an empty rectangle takes nothing and emits nothing', () => {
    const store = new Store();
    const events: StoreEvent[] = [];
    const off = store.subscribe((e) => events.push(e));
    expect(store.takeCellsInRect({ r1: 500_000, c1: 0, r2: 1_048_575, c2: TOTAL_COLS - 1 })).toEqual([]);
    off();
    expect(events).toEqual([]);
  });

  it('gives the same answer through both routes: a rectangle small next to the stored population is read by address, one large next to it by a single sweep', () => {
    // Dense sheet (400 cells): two addresses are far fewer than a quarter of the cells → read by address.
    const byAddress = seeded(400, 1).takeCellsInRect({ r1: 10, c1: 0, r2: 11, c2: 0 });
    // Sparse sheet (6 cells): the same two addresses are more than a quarter of the cells → one sweep.
    const sparse = new Store();
    for (const r of [0, 1, 2, 10, 11, 399]) sparse.setCell(r, 0, { text: `${r},0`, value: r * 1000 });
    const bySweep = sparse.takeCellsInRect({ r1: 10, c1: 0, r2: 11, c2: 0 });
    expect(byAddress).toEqual(bySweep);
    expect(bySweep.map(([, cell]) => cell.value)).toEqual([10_000, 11_000]);
    expect(sparse.getCellCount()).toBe(4);
  });

  it('the used bounds shrink after a boundary removal', () => {
    const store = seeded(4, 2);
    store.takeCellsInRect({ r1: 2, c1: 0, r2: 3, c2: 1 });
    expect(store.getUsedBounds()).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
  });

  it('bulkSetCells puts the taken list back and announces it once', () => {
    const store = seeded(4, 2);
    const before = store.serialize();
    // The trailing rows: re-inserted at the end, the walk order is unchanged.
    const taken = store.takeCellsInRect({ r1: 2, c1: 0, r2: 3, c2: 1 });
    const events: StoreEvent[] = [];
    const off = store.subscribe((e) => events.push(e));
    store.bulkSetCells(taken);
    off();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('cells');
    // Same cells, same order: the round trip is invisible in the serialization.
    expect(store.serialize()).toEqual(before);
  });
});
