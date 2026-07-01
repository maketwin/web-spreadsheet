import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/events/EventBus';

describe('EventBus', () => {
  it('on + emit', () => {
    const bus = new EventBus();
    const fn = vi.fn();

    bus.on('test', fn);
    bus.emit('test', 1);

    expect(fn).toHaveBeenCalledWith(1);
  });

  it('off removes', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('test', fn);

    off();
    bus.emit('test', 1);

    expect(fn).not.toHaveBeenCalled();
  });

  it('wildcard *', () => {
    const bus = new EventBus();
    const fn = vi.fn();

    bus.on('*', fn);
    bus.emit('foo', 1);

    expect(fn).toHaveBeenCalledWith({ event: 'foo', payload: 1 });
  });
});
