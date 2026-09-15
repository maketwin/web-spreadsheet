import { describe, expect, it } from 'vitest';
import { Command } from '../../src/commands/Command';
import { repeatOnRange } from '../../src/commands/repeat';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { SetColWidth } from '../../src/commands/impl/SetColWidth';
import { Store } from '../../src/store/Store';

const target = { r1: 5, c1: 2, r2: 6, c2: 3 };

describe('repeatOnRange (Excel F4)', () => {
  it('rebinds range commands to the current selection', () => {
    const store = new Store();
    const mgr = new CommandManager(store);
    mgr.execute(new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 0, c2: 0, style: { bold: true } }));
    const rebound = repeatOnRange(mgr.getLastExecuted()!, target);
    expect(rebound).toBeDefined();
    mgr.execute(rebound!);
    expect(store.getStyle(store.getCell(5, 2)!.styleId!)?.bold).toBe(true);
    expect(store.getStyle(store.getCell(6, 3)!.styleId!)?.bold).toBe(true);
  });

  it('rebinds single-cell commands (typing repeats verbatim)', () => {
    const store = new Store();
    const mgr = new CommandManager(store);
    mgr.execute(new SetCellText({ r: 0, c: 0, text: 'hi' }));
    mgr.execute(repeatOnRange(mgr.getLastExecuted()!, target)!);
    expect(store.getCell(5, 2)?.text).toBe('hi');
  });

  it('rebinds row commands and rescales the count to the selection', () => {
    const rebound = repeatOnRange(new InsertRowCommand({ r: 0, count: 1, position: 'above' }), target)!;
    const store = new Store();
    store.setCell(5, 0, { text: 'x' });
    rebound.execute(store);
    expect(store.getCell(5, 0)).toBeUndefined(); // two rows inserted above old row 5
    expect(store.getCell(7, 0)?.text).toBe('x');
  });

  it('rebinds column commands', () => {
    const rebound = repeatOnRange(new SetColWidth({ c: 0, width: 200 }), target)!;
    const store = new Store();
    rebound.execute(store);
    expect(store.getCol(2)?.width).toBe(200);
  });

  it('returns undefined for commands without an address', () => {
    class NoArgs extends Command<void> {
      public execute(): void {}
      public getUndo(): Command<void> { return this; }
    }
    expect(repeatOnRange(new NoArgs(undefined), target)).toBeUndefined();
  });

  it('undo/redo do not replace the repeat source', () => {
    const store = new Store();
    const mgr = new CommandManager(store);
    mgr.execute(new SetCellText({ r: 0, c: 0, text: 'a' }));
    mgr.undo();
    mgr.redo();
    expect(mgr.getLastExecuted()).toBeDefined();
  });
});
