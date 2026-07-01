import { describe, expect, it, vi } from 'vitest';
import { Spreadsheet } from '../../src/components/Spreadsheet';
import { PluginManager, type Plugin } from '../../src/plugin/PluginManager';
import { registry } from '../../src/formula/registry';

function createSpreadsheet(): Spreadsheet {
  return new Spreadsheet(document.createElement('div'), { theme: false });
}

describe('PluginManager', () => {
  it('use calls install', () => {
    const spreadsheet = createSpreadsheet();
    const manager = new PluginManager(spreadsheet);
    const install = vi.fn();
    const plugin: Plugin = { name: 'test-plugin', install };

    manager.use(plugin);

    expect(install).toHaveBeenCalledOnce();
    expect(manager.list()).toEqual(['test-plugin']);
  });

  it('api.registerFunction works', () => {
    const spreadsheet = createSpreadsheet();
    const manager = new PluginManager(spreadsheet);

    manager.use({
      install(api) {
        api.registerFunction('DOUBLE_TEST', {
          minArgs: 1,
          maxArgs: 1,
          evaluate: ([value]) => Number(value) * 2,
        });
      },
    });

    expect(registry.get('DOUBLE_TEST')?.evaluate([21])).toBe(42);
  });

  it('use returns this for chaining', () => {
    const spreadsheet = createSpreadsheet();
    const manager = new PluginManager(spreadsheet);
    const plugin: Plugin = { install: () => undefined };

    expect(manager.use(plugin)).toBe(manager);
  });
});
