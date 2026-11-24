import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import type { Command } from '../../src/commands/Command';
import { Command as CommandBase } from '../../src/commands/Command';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { SetRangeBorderCommand } from '../../src/commands/impl/SetRangeBorder';
import { SetNumberFormatCommand } from '../../src/commands/impl/SetNumberFormat';
import { ApplyTableStyleCommand } from '../../src/commands/impl/ApplyTableStyle';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { EventBus } from '../../src/events/EventBus';

const run = (cm: CommandManager, cmd: Command): void => { cm.execute.bind(cm)(cmd); };

describe('restyling a range', () => {
  it('is one sweep of the sheet, not one per cell', () => {
    const store = new Store();
    for (let r = 0; r < 150; r += 1) for (let c = 0; c < 20; c += 1) store.setCell(r, c, { text: String(r + c), value: r + c });
    const cm = new CommandManager(store);
    const started = performance.now();
    run(cm, new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 999, c2: 25, style: { bold: true } }));
    // Took about six seconds when every cell rescanned the sheet; generous for CI.
    expect(performance.now() - started).toBeLessThan(1500);
    expect(store.getStyle(store.getCell(999, 25)!.styleId!)?.bold).toBe(true);
    expect(store.getStyle(store.getCell(3, 4)!.styleId!)?.bold).toBe(true);
  });

  it('still never patches a style id another cell holds', () => {
    const store = new Store();
    // Two cells deliberately share one style id (as imports and pastes do).
    store.setStyle('shared', { color: '#ff0000' });
    store.setCell(0, 0, { text: 'a', styleId: 'shared' });
    store.setCell(0, 1, { text: 'b', styleId: 'shared' });
    const cm = new CommandManager(store);
    run(cm, new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 0, c2: 1, style: { bold: true } }));
    // A1 moves off the shared id (B1 still holds it); B1 is then the only
    // user left, so it may keep the id — which is no longer shared.
    expect(store.getStyle(store.getCell(0, 0)!.styleId!)).toEqual({ color: '#ff0000', bold: true });
    expect(store.getStyle(store.getCell(0, 1)!.styleId!)).toEqual({ color: '#ff0000', bold: true });
    expect(store.getCell(0, 0)!.styleId).toBe('cell-0-0');
    expect(store.getCell(0, 1)!.styleId).toBe('shared');
    // A cell whose id nobody else holds keeps it.
    store.setStyle('own', { color: '#00ff00' });
    store.setCell(2, 0, { text: 'c', styleId: 'own' });
    run(cm, new SetRangeStyleCommand({ r1: 2, c1: 0, r2: 2, c2: 0, style: { italic: true } }));
    expect(store.getCell(2, 0)!.styleId).toBe('own');
    expect(store.getStyle('own')).toEqual({ color: '#00ff00', italic: true });
  });

  it('keeps the same rule for borders, number formats and table styles', () => {
    const store = new Store();
    store.setStyle('shared', {});
    store.setCell(0, 0, { text: '1', value: 1, styleId: 'shared' });
    store.setCell(0, 1, { text: '2', value: 2, styleId: 'shared' });
    const cm = new CommandManager(store);
    run(cm, new SetRangeBorderCommand({ preset: 'all', line: 'solid', r1: 0, c1: 0, r2: 0, c2: 1 }));
    expect(store.getStyle(store.getCell(0, 0)!.styleId!)?.border).toEqual({ top: 'solid', bottom: 'solid', left: 'solid', right: 'solid' });
    expect(store.getStyle(store.getCell(0, 1)!.styleId!)?.border).toEqual({ top: 'solid', bottom: 'solid', left: 'solid', right: 'solid' });
    expect(store.getCell(0, 0)!.styleId).toBe('cell-0-0');
  });

  it('assigns number formats and table styles without mixing up ids', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    for (let r = 0; r < 4; r += 1) for (let c = 0; c < 2; c += 1) store.setCell(r, c, { text: String(r), value: r });
    run(cm, new SetNumberFormatCommand({ r1: 0, c1: 0, r2: 3, c2: 1, numberFormat: '0.00' }));
    for (let r = 0; r < 4; r += 1) expect(store.getStyle(store.getCell(r, 0)!.styleId!)?.numberFormat).toBe('0.00');
    run(cm, new ApplyTableStyleCommand({ preset: 'blue', r1: 0, c1: 0, r2: 3, c2: 1 }));
    expect(store.getStyle(store.getCell(0, 0)!.styleId!)?.bold).toBe(true);
    expect(store.getStyle(store.getCell(0, 0)!.styleId!)?.numberFormat).toBe('0.00');
    expect(store.getStyle(store.getCell(1, 0)!.styleId!)?.bold).toBeUndefined();
  });
});

describe('command history robustness', () => {
  class Boom extends (CommandBase as unknown as new (args: unknown) => Command<unknown>) {
    public execute(): void { throw new Error('boom'); }
    public getUndo(): Command { return this; }
  }
  const silence = <T>(fn: () => T): T => { const error = console.error; console.error = () => { /* expected */ }; try { return fn(); } finally { console.error = error; } };

  it('does not let a throwing command into the history', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    silence(() => run(cm, new Boom({})));
    expect(cm.canUndo()).toBe(false);
  });

  it('drops an undo that cannot run and goes on with the next one', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    run(cm, new SetCellText({ r: 0, c: 0, text: 'first' }));
    const sheet = store.addSheet('Temp');
    run(cm, new SetCellText({ r: 0, c: 0, text: 'second', sheetId: sheet }));
    store.deleteSheet(sheet);
    // "second" cannot be undone (its sheet is gone); "first" still is.
    silence(() => cm.undo());
    // A1 was empty before "first"; undoing it makes the cell empty again.
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(cm.canUndo()).toBe(false);
    expect(cm.canRedo()).toBe(true);
    silence(() => cm.redo());
    expect(store.getCell(0, 0)?.text).toBe('first');
  });

  it('reports a failed phase to the event bus', () => {
    const store = new Store();
    const events = new EventBus();
    const cm = new CommandManager(store, events);
    const seen: string[] = [];
    events.on('command:executing', () => { seen.push('executing'); });
    events.on('command:executed', () => { seen.push('executed'); });
    events.on('command:failed', () => { seen.push('failed'); });
    silence(() => run(cm, new Boom({})));
    expect(seen).toEqual(['executing', 'failed']);
  });

  it('delivers a command as one batch', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    let flushes = 0;
    let endBatches = 0;
    store.onBatchEnd(() => { endBatches += 1; });
    store.subscribe((event) => { if (event.type === 'cell' && store.isFlushing()) flushes += 1; });
    run(cm, new SetRangeStyleCommand({ r1: 0, c1: 0, r2: 9, c2: 9, style: { bold: true } }));
    expect(flushes).toBe(100);
    expect(endBatches).toBe(1);
  });
});
