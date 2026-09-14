import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { sortRowsInPlace } from '../../src/filter/sortRows';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { CommandManager } from '../../src/commands/CommandManager';
import { EventBus } from '../../src/events/EventBus';

describe('workbook-wide reference remap on sort (Excel move semantics)', () => {
  it('rewrites formulas outside the range that reference moved rows', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(1, 0, { text: '1', value: 1 });
    // summary below the table points at row 0 (A1)
    store.setCell(5, 0, { text: '2', formula: '=A1', value: 2 });
    sortRowsInPlace(store, 0, 0, 1, 0, 0, 'asc');
    // rows swapped; the outside formula follows its data to A2
    expect(store.getCell(5, 0)?.formula).toBe('=A2');
  });

  it('leaves outside formulas referencing unmoved columns alone', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(1, 0, { text: '1', value: 1 });
    store.setCell(1, 5, { text: 'x' }); // F2, outside sorted columns A:A
    store.setCell(5, 0, { text: 'x', formula: '=F2' });
    sortRowsInPlace(store, 0, 0, 1, 0, 0, 'asc');
    expect(store.getCell(5, 0)?.formula).toBe('=F2');
  });

  it('rewrites cross-sheet references naming the sorted sheet', () => {
    const store = new Store();
    const sheet1 = store.getActiveSheetId();
    store.renameSheet(sheet1, 'Data');
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(1, 0, { text: '1', value: 1 });
    const sheet2 = store.addSheet('Other');
    store.setCell(0, 0, { text: '2', formula: '=Data!A1', value: 2 }, sheet2);
    // unscoped ref on the other sheet points at its OWN cells: must not move
    store.setCell(1, 0, { text: '9', formula: '=A1', value: 9 }, sheet2);
    store.activateSheet(sheet1);
    sortRowsInPlace(store, 0, 0, 1, 0, 0, 'asc');
    expect(store.getCell(0, 0, sheet2)?.formula).toBe('=Data!A2');
    expect(store.getCell(1, 0, sheet2)?.formula).toBe('=A1');
  });

  it('undo restores outside-range formula rewrites', () => {
    const store = new Store();
    const events = new EventBus();
    const cmd = new CommandManager(store, events);
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(1, 0, { text: '1', value: 1 });
    store.setCell(5, 0, { text: '2', formula: '=A1', value: 2 });
    cmd.execute(new SortRangeCommand({ r1: 0, c1: 0, r2: 1, c2: 0, sortCol: 0, direction: 'asc' }));
    expect(store.getCell(5, 0)?.formula).toBe('=A2');
    cmd.undo();
    expect(store.getCell(5, 0)?.formula).toBe('=A1');
    expect(store.getCell(0, 0)?.text).toBe('2');
    cmd.redo();
    expect(store.getCell(5, 0)?.formula).toBe('=A2');
  });
});
