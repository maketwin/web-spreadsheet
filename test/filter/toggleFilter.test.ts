import { describe, expect, it } from 'vitest';
import { FilterService } from '../../src/filter/FilterService';
import { toggleAutoFilterCommand } from '../../src/filter/toggleFilter';
import { Store } from '../../src/store/Store';

function seedGrid(store: Store): void {
  store.setCell(0, 0, { text: 'Name', value: 'Name' });
  store.setCell(0, 1, { text: 'Qty', value: 'Qty' });
  for (let r = 1; r <= 3; r += 1) {
    store.setCell(r, 0, { text: `item${r}`, value: `item${r}` });
    store.setCell(r, 1, { text: String(r), value: r });
  }
}

describe('toggleAutoFilterCommand', () => {
  it('creates a filter over the selection data region when none exists', () => {
    const store = new Store();
    seedGrid(store);
    const cmd = toggleAutoFilterCommand(store, { r1: 0, c1: 0, r2: 0, c2: 0 });
    expect(cmd).not.toBeNull();
    cmd?.execute(store);
    const filter = new FilterService(store).getAutoFilter();
    expect(filter?.range).toMatchObject({ r1: 0, c1: 0, r2: 3, c2: 1 });
  });

  it('removes the existing filter on the second toggle', () => {
    const store = new Store();
    seedGrid(store);
    toggleAutoFilterCommand(store, { r1: 0, c1: 0, r2: 0, c2: 0 })?.execute(store);
    expect(new FilterService(store).getAutoFilter()).toBeDefined();

    const off = toggleAutoFilterCommand(store, { r1: 0, c1: 0, r2: 0, c2: 0 });
    off?.execute(store);
    expect(new FilterService(store).getAutoFilter()).toBeUndefined();
  });
});
