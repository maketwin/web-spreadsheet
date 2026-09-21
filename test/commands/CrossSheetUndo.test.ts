import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { SetColWidth } from '../../src/commands/impl/SetColWidth';

/** Commands must undo/redo on the sheet they executed on — even after the
 * user switched sheets (previously undo wrote into the now-active sheet). */
describe('cross-sheet undo/redo isolation', () => {
  it('undoes a cell edit on its origin sheet, leaving the active sheet alone', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    const sheet1 = store.getActiveSheetId();
    store.setCell(1, 1, { text: 'important' }, sheet1);

    const sheet2 = store.addSheet('Sheet2');
    cm.execute(new SetCellText({ r: 1, c: 1, text: 'hello' }));
    expect(store.getCell(1, 1, sheet2)?.text).toBe('hello');

    store.activateSheet(sheet1);
    cm.undo();
    // Sheet1 data survives; Sheet2's edit is undone.
    expect(store.getCell(1, 1, sheet1)?.text).toBe('important');
    expect(store.getCell(1, 1, sheet2)).toBeUndefined();

    // Redo also re-targets the origin sheet.
    cm.redo();
    expect(store.getCell(1, 1, sheet1)?.text).toBe('important');
    expect(store.getCell(1, 1, sheet2)?.text).toBe('hello');
  });

  it('undoes a style command on its origin sheet', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    const sheet1 = store.getActiveSheetId();
    store.setCell(0, 0, { text: 'keep' }, sheet1);

    const sheet2 = store.addSheet('Sheet2');
    cm.execute(new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 1, c2: 1, style: { bold: true } }));
    const styled = store.getCell(0, 0, sheet2);
    expect(styled?.styleId).toBeDefined();

    store.activateSheet(sheet1);
    cm.undo();
    expect(store.getCell(0, 0, sheet1)?.text).toBe('keep');
    expect(store.getCell(0, 0, sheet2)?.styleId).toBeUndefined();
  });

  it('undoes a structural insert on its origin sheet', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    const sheet1 = store.getActiveSheetId();
    store.setCell(0, 0, { text: 'anchor' }, sheet1);

    const sheet2 = store.addSheet('Sheet2');
    store.setCell(0, 0, { text: 's2' }, sheet2);
    cm.execute(new InsertRowCommand({ r: 0 }));
    expect(store.getCell(0, 0, sheet2)?.text).toBeUndefined(); // shifted down
    expect(store.getCell(1, 0, sheet2)?.text).toBe('s2');

    store.activateSheet(sheet1);
    cm.undo();
    // Sheet2 is restored; Sheet1 never saw the insert.
    expect(store.getCell(0, 0, sheet2)?.text).toBe('s2');
    expect(store.getCell(0, 0, sheet1)?.text).toBe('anchor');
    expect(store.getCell(1, 0, sheet1)).toBeUndefined();
  });

  it('undoes a column-width change on its origin sheet', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    const sheet1 = store.getActiveSheetId();

    const sheet2 = store.addSheet('Sheet2');
    cm.execute(new SetColWidth({ c: 2, width: 200 }));
    expect(store.getCol(2, sheet2)?.width).toBe(200);

    store.activateSheet(sheet1);
    cm.undo();
    expect(store.getCol(2, sheet2)?.width).toBeUndefined();
    expect(store.getCol(2, sheet1)?.width).toBeUndefined();
  });
});
