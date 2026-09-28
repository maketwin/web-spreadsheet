import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConditionalRulesDialog } from '../../../../src/components/menu/dialogs/ConditionalRulesDialog';
import { CommandManager } from '../../../../src/commands/CommandManager';
import { SetConditionalFormatCommand } from '../../../../src/commands/impl/SetConditionalFormat';
import { Store } from '../../../../src/store/Store';

function mockMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('ConditionalRulesDialog', () => {
  beforeEach(() => { mockMatchMedia(); });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function seedRules(store: Store): void {
    // The same path the 数据条 menu item takes — guards the manager against
    // regressing into listing only rules it did not create itself.
    const cmd = new SetConditionalFormatCommand({ r1: 1, c1: 1, r2: 3, c2: 5, rules: [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }] });
    cmd.execute(store);
    const cmd2 = new SetConditionalFormatCommand({ r1: 17, c1: 10, r2: 17, c2: 10, rules: [{ type: 'colorScale', min: 0, max: 100, minColor: '#FFFFFF', maxColor: '#4A90D9' }] });
    cmd2.execute(store);
  }

  it('empty sheet shows the empty-state row', () => {
    const store = new Store();
    render(<ConditionalRulesDialog open store={store} onCancel={() => {}} />);
    expect(screen.getByText('当前工作表没有条件格式规则')).toBeInTheDocument();
  });

  it('lists rules applied through the menu with type and summary', () => {
    const store = new Store();
    seedRules(store);
    render(<ConditionalRulesDialog open store={store} onCancel={() => {}} />);

    expect(screen.getByText('B2:F4')).toBeInTheDocument();
    expect(screen.getAllByText('数据条').length).toBeGreaterThan(0);
    expect(screen.getByText('K18:K18')).toBeInTheDocument();
    expect(screen.getByText(/FFFFFF/)).toBeInTheDocument(); // color scale summary
  });

  it('delete removes the rule through the command manager (undoable)', () => {
    const store = new Store();
    seedRules(store);
    const cmdManager = new CommandManager(store);
    render(<ConditionalRulesDialog open store={store} cmdManager={cmdManager} onCancel={() => {}} />);

    // Two rows → two delete buttons; remove the first (B2:F4 data bar).
    const deletes = screen.getAllByRole('button').filter((b) => b.closest('.ant-table-cell') !== null && b.querySelector('.anticon-delete'));
    expect(deletes.length).toBe(2);
    fireEvent.click(deletes[0]!);

    expect(screen.queryByText('B2:F4')).not.toBeInTheDocument();
    expect(screen.getByText('K18:K18')).toBeInTheDocument();
    // One undo step restores the rule in the store (the open modal does not
    // live-subscribe to the store, so assert on the data, not the table).
    cmdManager.undo();
    expect(store.getConditionalRules().some(([k]) => k === '1,1:3,5')).toBe(true);
  });

  it('启用 checkbox toggles rule.disabled through the command manager', async () => {
    const store = new Store();
    seedRules(store);
    const cmdManager = new CommandManager(store);
    render(<ConditionalRulesDialog open store={store} cmdManager={cmdManager} onCancel={() => {}} />);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);
    fireEvent.click(checkboxes[0]!);

    await waitFor(() => {
      const rules = store.getConditionalRules().find(([k]) => k === '1,1:3,5')?.[1] ?? [];
      expect(rules[0]?.disabled).toBe(true);
    });
    // Undo restores the enabled rule.
    cmdManager.undo();
    const rules = store.getConditionalRules().find(([k]) => k === '1,1:3,5')?.[1] ?? [];
    expect(rules[0]?.disabled).not.toBe(true);
  });
});
