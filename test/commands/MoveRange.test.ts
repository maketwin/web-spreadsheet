import { describe, expect, it } from 'vitest';
import { MoveRange } from '../../src/commands/impl/MoveRange';
import { Store } from '../../src/store/Store';
import type { RangeAddress } from '../../src/selection/Range';

describe('MoveRange', () => {
  it('moves cell content to a new empty area and clears source', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'A1' });
    store.setCell(0, 1, { text: 'B1' });
    store.setCell(1, 0, { text: 'A2' });
    store.setCell(1, 1, { text: 'B2' });

    const source: RangeAddress = { r1: 0, c1: 0, r2: 1, c2: 1 };
    const target: RangeAddress = { r1: 3, c1: 3, r2: 3, c2: 3 };
    const cmd = new MoveRange({ source, target });
    cmd.execute(store);

    // Source should be cleared
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(store.getCell(0, 1)).toBeUndefined();
    expect(store.getCell(1, 0)).toBeUndefined();
    expect(store.getCell(1, 1)).toBeUndefined();

    // Target should have moved content
    expect(store.getCell(3, 3)).toMatchObject({ text: 'A1' });
    expect(store.getCell(3, 4)).toMatchObject({ text: 'B1' });
    expect(store.getCell(4, 3)).toMatchObject({ text: 'A2' });
    expect(store.getCell(4, 4)).toMatchObject({ text: 'B2' });
  });

  it('undo restores both source and target', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'hello' });
    store.setCell(2, 2, { text: 'existing' });

    const source: RangeAddress = { r1: 0, c1: 0, r2: 0, c2: 0 };
    const target: RangeAddress = { r1: 2, c1: 2, r2: 2, c2: 2 };
    const cmd = new MoveRange({ source, target });
    cmd.execute(store);

    // Source cleared, target overwritten
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(store.getCell(2, 2)).toMatchObject({ text: 'hello' });

    // Undo
    cmd.getUndo().execute(store);

    // Source restored, target back to original
    expect(store.getCell(0, 0)).toMatchObject({ text: 'hello' });
    expect(store.getCell(2, 2)).toMatchObject({ text: 'existing' });
  });
});
