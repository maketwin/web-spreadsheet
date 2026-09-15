import { describe, expect, it } from 'vitest';
import { AutoRowHeightsCommand } from '../../src/util/rowAutofit';
import { ImportCellsCommand } from '../../src/commands/impl/ImportCells';
import { styleWithAutofitCommand } from '../../src/util/styleAutofit';
import { CommandManager } from '../../src/commands/CommandManager';
import { ROW_HEIGHT } from '../../src/renderer/coordinate';
import { Store } from '../../src/store/Store';

const heightOf = (store: Store, r: number): number => store.getRow(r)?.height ?? ROW_HEIGHT;
const fontSizeOf = (store: Store, r: number, c: number): number | undefined => {
  const styleId = store.getCell(r, c)?.styleId;
  return styleId === undefined ? undefined : store.getStyle(styleId)?.fontSize;
};

describe('style + row-height autofit as one undo step (Excel)', () => {
  it('font size change is a single undo entry restoring both style and heights', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    store.setCell(0, 0, { text: 'hello' });
    store.setCell(1, 0, { text: 'world' });

    manager.execute(styleWithAutofitCommand({ r1: 0, c1: 0, r2: 1, c2: 1 }, { fontSize: 24 }));

    expect(manager.getUndoStack()).toHaveLength(1);
    expect(fontSizeOf(store, 0, 0)).toBe(24);
    expect(heightOf(store, 0)).toBeGreaterThan(ROW_HEIGHT);
    expect(heightOf(store, 1)).toBeGreaterThan(ROW_HEIGHT);

    manager.undo();

    expect(fontSizeOf(store, 0, 0)).toBeUndefined();
    expect(heightOf(store, 0)).toBe(ROW_HEIGHT);
    expect(heightOf(store, 1)).toBe(ROW_HEIGHT);
    expect(manager.canUndo()).toBe(false);
  });

  it('redo re-applies style and recomputed heights together', () => {
    const store = new Store();
    const manager = new CommandManager(store);

    manager.execute(styleWithAutofitCommand({ r1: 0, c1: 0, r2: 0, c2: 0 }, { fontSize: 24 }));
    manager.undo();
    manager.redo();

    expect(fontSizeOf(store, 0, 0)).toBe(24);
    expect(heightOf(store, 0)).toBeGreaterThan(ROW_HEIGHT);
  });
});

describe('AutoRowHeightsCommand', () => {
  it('restores prior heights on undo', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    store.setCell(0, 0, { text: 'x' });
    store.setRow(0, { height: 40 });

    manager.execute(new AutoRowHeightsCommand({ r1: 0, c1: 0, r2: 0, c2: 0 }));

    expect(heightOf(store, 0)).toBe(ROW_HEIGHT);
    manager.undo();
    expect(heightOf(store, 0)).toBe(40);
  });
});

describe('ImportCellsCommand (JSON import as one undo step)', () => {
  it('undo restores overwritten and removes created cells', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    store.setCell(0, 0, { text: 'old' });

    manager.execute(new ImportCellsCommand([[0, 0, { text: 'new' }], [2, 3, { text: 'x' }]]));

    expect(store.getCell(0, 0)?.text).toBe('new');
    expect(store.getCell(2, 3)?.text).toBe('x');

    manager.undo();

    expect(store.getCell(0, 0)?.text).toBe('old');
    expect(store.getCell(2, 3)).toBeUndefined();

    manager.redo();

    expect(store.getCell(0, 0)?.text).toBe('new');
    expect(store.getCell(2, 3)?.text).toBe('x');
  });
});
