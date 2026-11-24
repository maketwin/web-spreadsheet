import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/events/EventBus';

describe('EventBus unsubscribe precision and error isolation', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterEach(() => consoleError.mockClear());

  it('the unsubscribe returned by on() retires only its own subscription', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off1 = bus.on('e', fn);
    const off2 = bus.on('e', fn);

    off1();
    bus.emit('e', 1);
    expect(fn).toHaveBeenCalledTimes(1);

    off2();
    bus.emit('e', 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('off(event, fn) removes only the earliest matching subscription', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('e', fn);
    bus.on('e', fn);

    bus.off('e', fn);
    bus.emit('e', 1);
    expect(fn).toHaveBeenCalledTimes(1);

    bus.off('e', fn);
    bus.emit('e', 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not stop later listeners', () => {
    const bus = new EventBus();
    const second = vi.fn();
    bus.on('e', () => { throw new Error('boom'); });
    bus.on('e', second);

    expect(() => bus.emit('e', 1)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it('a throwing named listener does not stop wildcard listeners', () => {
    const bus = new EventBus();
    const wildcard = vi.fn();
    bus.on('e', () => { throw new Error('boom'); });
    bus.on('*', wildcard);

    expect(() => bus.emit('e', 1)).not.toThrow();
    expect(wildcard).toHaveBeenCalledWith({ event: 'e', payload: 1 });
  });

  it('a throwing wildcard listener does not stop other wildcard listeners', () => {
    const bus = new EventBus();
    const after = vi.fn();
    bus.on('*', () => { throw new Error('wild'); });
    bus.on('*', after);

    expect(() => bus.emit('e', 1)).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing mid-emit does not confuse later dispatches', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('e', fn);
    bus.emit('e', 1);
    off();
    bus.emit('e', 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
