import { describe, expect, it, vi } from 'vitest';
import { Spreadsheet, type Plugin } from '../src/index';

describe('public facade', () => {
  it('new Spreadsheet + use plugin calls install', () => {
    const root = document.createElement('div');
    const install = vi.fn();
    const plugin: Plugin = { name: 'facade-test', install };

    const spreadsheet = new Spreadsheet(root, { theme: false });
    const result = spreadsheet.use(plugin);

    expect(result).toBe(spreadsheet);
    expect(install).toHaveBeenCalledOnce();
  });
});
