import { describe, expect, it } from 'vitest';
import * as core from '../src/core';
import { CommandManager } from '../src/commands/CommandManager';

describe('web-spreadsheet/core entry', () => {
  it('exposes the command layer for headless hosts', () => {
    expect(core.CommandManager).toBe(CommandManager);

    const store = new core.Store();
    const commands = new core.CommandManager(store);
    const run = commands.execute.bind(commands);

    run(new core.SetCellStyleCommand({ r: 0, c: 0, style: { bold: true } }));
    expect(store.getStyle(store.getCell(0, 0)?.styleId ?? '')).toEqual({ bold: true });
    expect(commands.canUndo()).toBe(true);

    commands.undo();
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(commands.canRedo()).toBe(true);

    commands.redo();
    expect(store.getStyle(store.getCell(0, 0)?.styleId ?? '')).toEqual({ bold: true });
  });

  it('keeps the UI and persistence surface out', () => {
    for (const name of ['Spreadsheet', 'Toolbar', 'MenuBar', 'FloatingChart', 'Sparkline', 'loadWorkbook', 'deleteWorkbook']) {
      expect(name in core, name).toBe(false);
    }
  });
});
