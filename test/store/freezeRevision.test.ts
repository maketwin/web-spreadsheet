import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { SheetData, type SerializedSheetData } from '../../src/store/SheetData';

// Frozen rows/columns belong to a sheet (persisted, exported with it), and a
// cache can follow the store through its revision without subscribing to it.
describe('sheet freeze', () => {
  it('is stored per sheet, announced, and survives a round trip', () => {
    const store = new Store();
    expect(store.getFreeze()).toBeUndefined();
    const events: string[] = [];
    store.subscribe((event) => { if (event.type === 'freeze') events.push(event.sheetId ?? ''); });
    store.setFreeze({ rows: 2, cols: 1 });
    expect(store.getFreeze()).toEqual({ rows: 2, cols: 1 });
    expect(events).toEqual(['sheet-1']);

    const other = store.addSheet('Other');
    expect(store.getFreeze(other)).toBeUndefined();
    store.setFreeze({ rows: 0, cols: 2 }, other);
    store.activateSheet('sheet-1');

    const restored = Store.deserialize(store.serialize());
    expect(restored.getFreeze('sheet-1')).toEqual({ rows: 2, cols: 1 });
    expect(restored.getFreeze(other)).toEqual({ rows: 0, cols: 2 });

    const copy = store.copySheet('sheet-1', { name: 'Copy' });
    expect(copy).toBeDefined();
    expect(store.getFreeze(copy!)).toEqual({ rows: 2, cols: 1 });

    store.setFreeze(undefined);
    expect(store.getFreeze()).toBeUndefined();
  });

  it('loads a sheet saved before freeze existed', () => {
    const saved: SerializedSheetData = {
      cells: [], rows: [], cols: [], styles: [], merges: [], conditionalRules: [], charts: [], images: [],
      validationRules: [], sparklines: [], namedRanges: [], rowGroups: [],
    };
    expect(SheetData.deserialize(saved).getFreeze()).toBeUndefined();
  });
});

describe('store revision', () => {
  it('counts delivered events, coalesced inside a batch', () => {
    const store = new Store();
    const start = store.revision;
    store.setCell(0, 0, { text: 'a' });
    expect(store.revision).toBe(start + 1);
    // Two writes to one cell in a batch reach a subscriber once.
    store.batch(() => {
      store.setCell(0, 0, { text: 'b' });
      store.setCell(0, 0, { text: 'c' });
    });
    expect(store.revision).toBe(start + 2);
    // A subscriber sees the new number for the event it is being given.
    const seen: number[] = [];
    const off = store.subscribe(() => { seen.push(store.revision); });
    store.setCell(0, 0, { text: 'd' });
    off();
    expect(seen).toEqual([store.revision]);
  });
});
