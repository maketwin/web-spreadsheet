import { describe, expect, it, vi } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { EventBus } from '../../src/events/EventBus';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { registry } from '../../src/formula/registry';
import { PluginAPI } from '../../src/plugin/PluginAPI';
import { PluginManager, type Plugin, type PluginHost } from '../../src/plugin/PluginManager';
import { Store } from '../../src/store/Store';

/** Headless host — no React layer involved. */
function createHost(): PluginHost {
  const store = new Store();
  const events = new EventBus();
  return {
    store,
    events,
    cmdManager: new CommandManager(store, events),
    formula: new FormulaEngine(store),
  };
}

describe('Plugin lifecycle (registerFunction / on / dispose)', () => {
  it('registerFunction returns an undo that restores the previous definition', () => {
    const api = new PluginAPI(createHost());
    const original = registry.get('ABS');
    try {
      const undo = api.registerFunction('ABS', { minArgs: 1, maxArgs: 1, evaluate: () => -999 });
      expect(registry.get('ABS')?.evaluate([5])).toBe(-999);
      undo();
      expect(registry.get('ABS')).toBe(original);
    } finally {
      // Restore the builtin even if an assertion above fails.
      registry.register('ABS', original!);
    }
  });

  it('undo removes a function the plugin created from scratch', () => {
    const api = new PluginAPI(createHost());
    const undo = api.registerFunction('LIFECYCLE_NOVEL', { minArgs: 0, maxArgs: 0, evaluate: () => 1 });
    expect(registry.has('LIFECYCLE_NOVEL')).toBe(true);
    undo();
    expect(registry.has('LIFECYCLE_NOVEL')).toBe(false);
    undo(); // idempotent
    expect(registry.has('LIFECYCLE_NOVEL')).toBe(false);
  });

  it('dispose() undoes every function and subscription the API produced', () => {
    const host = createHost();
    const manager = new PluginManager(host);
    const handler = vi.fn();
    const plugin: Plugin = {
      name: 'lifecycle',
      install(api) {
        api.registerFunction('LIFECYCLE_DISPOSE_FN', { minArgs: 0, maxArgs: 0, evaluate: () => 42 });
        api.on('lifecycle:event', handler);
      },
    };
    manager.use(plugin);

    expect(registry.has('LIFECYCLE_DISPOSE_FN')).toBe(true);
    host.events.emit('lifecycle:event', 1);
    expect(handler).toHaveBeenCalledTimes(1);

    manager.clear();

    expect(registry.has('LIFECYCLE_DISPOSE_FN')).toBe(false);
    host.events.emit('lifecycle:event', 2);
    expect(handler).toHaveBeenCalledTimes(1); // subscription was retired
    expect(manager.list()).toEqual([]);
  });

  it('clear() restores an overridden builtin definition', () => {
    const host = createHost();
    const manager = new PluginManager(host);
    const original = registry.get('ABS');
    try {
      manager.use({
        install(api) {
          api.registerFunction('ABS', { minArgs: 1, maxArgs: 1, evaluate: () => -1 });
        },
      });
      expect(registry.get('ABS')?.evaluate([7])).toBe(-1);

      manager.clear();

      expect(registry.get('ABS')).toBe(original);
    } finally {
      registry.register('ABS', original!);
    }
  });

  it('a caller-invoked unsubscribe does not break dispose()', () => {
    const host = createHost();
    const manager = new PluginManager(host);
    const handler = vi.fn();
    manager.use({
      install(api) {
        const off = api.on('lifecycle:once', handler);
        off();
      },
    });
    expect(() => manager.clear()).not.toThrow();
    host.events.emit('lifecycle:once', 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('PluginManager accepts a structural headless host (no React layer)', () => {
    const manager = new PluginManager(createHost());
    const install = vi.fn();
    expect(manager.use({ name: 'headless', install })).toBe(manager);
    expect(install).toHaveBeenCalledOnce();
    expect(manager.list()).toEqual(['headless']);
  });

  it('PluginAPI exposes store / cmdManager / events / formula from the host', () => {
    const host = createHost();
    const api = new PluginAPI(host);
    expect(api.store).toBe(host.store);
    expect(api.cmdManager).toBe(host.cmdManager);
    expect(api.events).toBe(host.events);
    expect(api.formula).toBe(host.formula);
  });

  it('PluginAPI without a host keeps throwing on accessors', () => {
    const api = new PluginAPI(null);
    expect(() => api.store).toThrow();
    expect(() => api.cmdManager).toThrow();
    expect(() => api.events).toThrow();
    expect(() => api.formula).toThrow();
  });

  it('a plugin that throws mid-install leaves no registrations behind', () => {
    const host = createHost();
    const manager = new PluginManager(host);
    const handler = vi.fn();
    const boom = new Error('install exploded');
    const badPlugin: Plugin = {
      name: 'bad',
      install(api) {
        api.registerFunction('LIFECYCLE_BOOM_FN', { minArgs: 0, maxArgs: 0, evaluate: () => 1 });
        api.on('lifecycle:boom', handler);
        throw boom;
      },
    };

    expect(() => manager.use(badPlugin)).toThrow(boom);

    // Not listed, function gone from the registry, listener never fires.
    expect(manager.list()).toEqual([]);
    expect(registry.has('LIFECYCLE_BOOM_FN')).toBe(false);
    host.events.emit('lifecycle:boom', 1);
    expect(handler).not.toHaveBeenCalled();
  });
});
