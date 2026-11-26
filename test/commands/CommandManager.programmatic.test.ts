import { describe, expect, it, vi } from 'vitest';
import { Command } from '../../src/commands/Command';
import { CommandManager } from '../../src/commands/CommandManager';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { EventBus } from '../../src/events/EventBus';
import { protectSheet } from '../../src/protection/SheetProtection';
import { Store } from '../../src/store/Store';

class ThrowingCommand extends Command<{ readonly note: string }> {
  public execute(): void {
    throw new Error('boom');
  }

  public getUndo(): Command {
    return this;
  }
}

class NoOpCommand extends Command<{ readonly note: string }> {
  public execute(_store: Store): void { /* changes nothing */ }

  public getUndo(): Command {
    return this;
  }

  public override isNoOp(): boolean {
    return true;
  }
}

describe('CommandManager programmatic execution', () => {
  it('record:false applies the effect but keeps it out of history', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    const apply = manager.execute.bind(manager);

    expect(apply(new SetCellText({ r: 0, c: 0, text: 'ghost' }), { record: false })).toBe(true);
    expect(store.getCell(0, 0)?.text).toBe('ghost');
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
    expect(manager.getLastExecuted()).toBeUndefined();

    // A user edit, undone — redo is now available. A programmatic edit must
    // not clear it, and must not move the F4 repeat source.
    apply(new SetCellText({ r: 0, c: 0, text: 'a' }));
    manager.undo();
    expect(manager.canRedo()).toBe(true);
    const repeatSource = manager.getLastExecuted();
    expect(apply(new SetCellText({ r: 0, c: 0, text: 'b' }), { record: false })).toBe(true);
    expect(store.getCell(0, 0)?.text).toBe('b');
    expect(manager.canRedo()).toBe(true);
    expect(manager.getLastExecuted()).toBe(repeatSource);
  });

  it('record:false emits no command:* events (the default path does)', () => {
    const store = new Store();
    const events = new EventBus();
    const manager = new CommandManager(store, events);
    const seen: string[] = [];
    // `*` is not a named event in the table, so its payload stays unknown.
    events.on('*', (entry: unknown) => { seen.push((entry as { event: string }).event); });
    const apply = manager.execute.bind(manager);

    apply(new SetCellText({ r: 0, c: 0, text: 'a' }));
    expect(seen).toEqual(['command:executing', 'command:executed']);

    seen.length = 0;
    apply(new SetCellText({ r: 0, c: 0, text: 'b' }), { record: false });
    expect(seen).toEqual([]);
  });

  it('record:false delivers inside one batch flush (direct Store delivery does not)', () => {
    const store = new Store();
    for (let r = 0; r < 60; r += 1) store.setCell(r, 0, { text: String(r), value: r });
    const flushing: boolean[] = [];
    store.subscribe(() => { flushing.push(store.isFlushing()); });
    const manager = new CommandManager(store);
    const apply = manager.execute.bind(manager);

    apply(new InsertRowCommand({ r: 0 }), { record: false });
    expect(flushing.length).toBeGreaterThan(0);
    expect(flushing.every((inFlush) => inFlush)).toBe(true);

    // Control: the same command straight on the store delivers event by
    // event, none of them inside a flush.
    const direct = new Store();
    for (let r = 0; r < 60; r += 1) direct.setCell(r, 0, { text: String(r), value: r });
    const directFlushing: boolean[] = [];
    direct.subscribe(() => { directFlushing.push(direct.isFlushing()); });
    const cmd = new InsertRowCommand({ r: 0 });
    const run = cmd.execute.bind(cmd);
    run(direct);
    expect(directFlushing.length).toBeGreaterThan(0);
    expect(directFlushing.every((inFlush) => !inFlush)).toBe(true);
  });

  it('record:false skips the protection check (the default path rejects)', () => {
    const store = new Store();
    const events = new EventBus();
    const manager = new CommandManager(store, events);
    const rejections: unknown[] = [];
    events.on('command:rejected', (payload: unknown) => { rejections.push(payload); });
    store.setProtection(protectSheet('pw'));
    const apply = manager.execute.bind(manager);

    expect(apply(new SetCellText({ r: 0, c: 0, text: 'a' }))).toBe(false);
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(rejections).toHaveLength(1);

    expect(apply(new SetCellText({ r: 0, c: 0, text: 'a' }), { record: false })).toBe(true);
    expect(store.getCell(0, 0)?.text).toBe('a');
    expect(rejections).toHaveLength(1);
  });

  it('a throwing command: record:false returns false, logs, emits nothing, keeps history', () => {
    const store = new Store();
    const events = new EventBus();
    const manager = new CommandManager(store, events);
    const seen: string[] = [];
    events.on('*', (entry: unknown) => { seen.push((entry as { event: string }).event); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silenced */ });
    const apply = manager.execute.bind(manager);

    expect(apply(new ThrowingCommand({ note: 'x' }), { record: false })).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    expect(manager.canUndo()).toBe(false);
    errorSpy.mockRestore();
  });

  it('record:false returns true for a successful and a no-op command', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    const apply = manager.execute.bind(manager);
    expect(apply(new SetCellText({ r: 0, c: 0, text: 'a' }), { record: false })).toBe(true);
    expect(apply(new NoOpCommand({ note: 'n' }), { record: false })).toBe(true);
  });

  it('default (record omitted) keeps existing behavior and gains a return value', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    const apply = manager.execute.bind(manager);
    expect(apply(new SetCellText({ r: 0, c: 0, text: 'a' }))).toBe(true);
    expect(apply(new NoOpCommand({ note: 'n' }))).toBe(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silenced */ });
    expect(apply(new ThrowingCommand({ note: 'x' }))).toBe(false);
    errorSpy.mockRestore();
  });
});
