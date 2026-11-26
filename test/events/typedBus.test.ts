import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Command } from '../../src/commands/Command';
import { EventBus } from '../../src/events/EventBus';
import type { SpreadsheetEvents } from '../../src/events/events';

/** Minimal concrete command so the bus payload can be exercised at runtime. */
class TickCommand extends Command {
  public constructor() {
    super(undefined);
  }

  public execute(): void { /* not executed here */ }
  public getUndo(): Command { return this; }
  public override describe(): string { return 'tick'; }
}

describe('typed EventBus', () => {
  it('a known event name gets its exact payload type (compile-time guard)', () => {
    const bus = new EventBus();
    const descriptions: string[] = [];

    bus.on('command:executing', (p) => {
      expectTypeOf(p).toEqualTypeOf<{ readonly cmd: Command }>();
      descriptions.push(p.cmd.describe());
    });
    const cmd = new TickCommand();
    bus.emit('command:executing', { cmd });

    expect(descriptions).toEqual(['tick']);
  });

  it('a custom event name keeps the payload unknown (compile-time guard)', () => {
    const bus = new EventBus();
    const seen: unknown[] = [];

    bus.on('anything-custom', (p) => {
      const asUnknown: unknown = p;
      expectTypeOf(p).toEqualTypeOf<unknown>();
      seen.push(asUnknown);
    });
    bus.emit('anything-custom', { n: 1 });

    expect(seen).toEqual([{ n: 1 }]);
  });

  it('known and custom events each deliver their payload verbatim, exactly once', () => {
    const bus = new EventBus();
    const known = vi.fn();
    const custom = vi.fn();
    bus.on('command:rejected', known);
    bus.on('my-plugin:event', custom);

    bus.emit('command:rejected', { reason: 'protected' });
    bus.emit('my-plugin:event', 'hello');

    expect(known).toHaveBeenCalledTimes(1);
    expect(known).toHaveBeenCalledWith({ reason: 'protected' });
    expect(custom).toHaveBeenCalledTimes(1);
    expect(custom).toHaveBeenCalledWith('hello');
  });

  it('wildcard listeners still receive { event, payload }', () => {
    const bus = new EventBus();
    const wildcard = vi.fn();
    bus.on('*', wildcard);

    bus.emit('csv:import', 'a,b\n1,2');

    expect(wildcard).toHaveBeenCalledWith({ event: 'csv:import', payload: 'a,b\n1,2' });
  });

  it('the default event table is the built-in one: command:failed exposes phase', () => {
    const bus: EventBus<SpreadsheetEvents> = new EventBus();
    const phases: string[] = [];

    bus.on('command:failed', (p) => {
      expectTypeOf(p.phase).toEqualTypeOf<'execute' | 'undo' | 'redo'>();
      phases.push(p.phase);
    });
    bus.emit('command:failed', { cmd: new TickCommand(), phase: 'undo', error: new Error('boom') });

    expect(phases).toEqual(['undo']);
  });

  it('runtime parity: the same function subscribed twice keeps two independent subscriptions', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off1 = bus.on('command:redone', fn);
    const off2 = bus.on('command:redone', fn);

    off1();
    bus.emit('command:redone', { cmd: new TickCommand() });
    expect(fn).toHaveBeenCalledTimes(1);

    off2();
    bus.emit('command:redone', { cmd: new TickCommand() });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('csv:import payloads are typed as the raw CSV string', () => {
    const bus = new EventBus();
    const texts: string[] = [];

    bus.on('csv:import', (csv) => {
      expectTypeOf(csv).toEqualTypeOf<string>();
      texts.push(csv.toUpperCase());
    });
    bus.emit('csv:import', 'a,b');

    expect(texts).toEqual(['A,B']);
  });
});
