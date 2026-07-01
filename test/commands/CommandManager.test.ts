import { describe, expect, it, vi } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { EventBus } from '../../src/events/EventBus';
import { Store } from '../../src/store/Store';

describe('CommandManager', () => {
  it('undo + redo', () => {
    const store = new Store();
    const manager = new CommandManager(store);

    manager.execute(new SetCellText({ r: 0, c: 0, text: 'a' }));
    manager.execute(new SetCellText({ r: 0, c: 0, text: 'b' }));

    expect(store.getCell(0, 0)?.text).toBe('b');

    manager.undo();
    expect(store.getCell(0, 0)?.text).toBe('a');

    manager.undo();
    expect(store.getCell(0, 0)).toBeUndefined();

    manager.redo();
    expect(store.getCell(0, 0)?.text).toBe('a');
  });

  it('canUndo/canRedo', () => {
    const store = new Store();
    const manager = new CommandManager(store);

    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);

    manager.execute(new SetCellText({ r: 0, c: 0, text: 'a' }));
    expect(manager.canUndo()).toBe(true);
    expect(manager.canRedo()).toBe(false);

    manager.undo();
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(true);
  });

  it('new command clears redo and emits events', () => {
    const store = new Store();
    const events = new EventBus();
    const fn = vi.fn();
    const manager = new CommandManager(store, events);
    events.on('*', fn);

    manager.execute(new SetCellText({ r: 0, c: 0, text: 'a' }));
    manager.undo();
    expect(manager.canRedo()).toBe(true);

    manager.execute(new SetCellText({ r: 0, c: 0, text: 'b' }));

    const firstCall = fn.mock.calls[0];
    const secondCall = fn.mock.calls[1];

    expect(manager.canRedo()).toBe(false);
    expect(firstCall?.[0]).toMatchObject({ event: 'command:executed' });
    expect(firstCall?.[0].payload.cmd).toBeInstanceOf(SetCellText);
    expect(secondCall?.[0]).toMatchObject({ event: 'command:undone' });
    expect(secondCall?.[0].payload.cmd).toBeInstanceOf(SetCellText);
  });
});
