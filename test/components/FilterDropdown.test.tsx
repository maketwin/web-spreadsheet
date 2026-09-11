import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterDropdown } from '../../src/components/FilterDropdown';
import type { SetAutoFilterCriteriaCommand } from '../../src/commands/impl/SetAutoFilterCriteria';
import { FilterService } from '../../src/filter/FilterService';
import { Store } from '../../src/store/Store';

describe('FilterDropdown', () => {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));

  function setupStore(): Store {
    const store = new Store();
    store.setCell(0, 0, { text: 'Name' });
    store.setCell(0, 1, { text: 'Score' });
    store.setCell(1, 0, { text: 'Alice' });
    store.setCell(1, 1, { text: '85', value: 85 });
    store.setCell(2, 0, { text: 'Bob' });
    store.setCell(2, 1, { text: '92', value: 92 });
    store.setCell(3, 0, { text: 'Charlie' });
    store.setCell(3, 1, { text: '78', value: 78 });
    store.setCell(4, 0, { text: 'Alice' });
    store.setCell(4, 1, { text: '95', value: 95 });
    const service = new FilterService(store);
    service.setAutoFilter({ r1: 0, c1: 0, r2: 4, c2: 1 });
    return store;
  }

  function setup(store: Store) {
    const executed: SetAutoFilterCriteriaCommand[] = [];
    const onClose = vi.fn();
    render(
      <FilterDropdown
        store={store}
        r={0}
        c={0}
        x={100}
        y={100}
        cmdManagerExecutor={(command) => {
          executed.push(command as SetAutoFilterCriteriaCommand);
          command.execute(store);
        }}
        onClose={onClose}
      />,
    );
    return { executed, onClose };
  }

  it('shows item counts and keeps edits as a draft until 确定', () => {
    const store = setupStore();
    const { executed, onClose } = setup(store);

    // Duplicate value shows its count.
    expect(screen.getByText('2')).toBeTruthy();

    // Unchecking Bob is a draft: nothing executed, store untouched.
    fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));
    expect(executed).toHaveLength(0);
    expect(store.getAutoFilter()?.criteria[0]).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(onClose).toHaveBeenCalled();
    const command = executed.at(-1);
    expect(command?.args.mode).toBe('set');
    expect(command?.args.criteria).toEqual({ selected: ['Alice', 'Charlie'], includeBlanks: true });
    expect(store.getRow(2)?.hide).toBe(true);
  });

  it('discards draft edits on 取消', () => {
    const store = setupStore();
    const { executed, onClose } = setup(store);

    fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(executed).toHaveLength(0);
    expect(onClose).toHaveBeenCalled();
    expect(store.getAutoFilter()?.criteria[0]).toBeUndefined();
  });

  it('clears only the current column when using the dropdown action', () => {
    const store = setupStore();
    store.setAutoFilter({
      range: { r1: 0, c1: 0, r2: 4, c2: 1 },
      criteria: {
        0: { selected: ['Alice'], includeBlanks: true },
        1: { selected: ['85'], includeBlanks: true },
      },
    });
    const { executed, onClose } = setup(store);

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(executed.at(-1)?.args.mode).toBe('clearColumn');
    expect(store.getAutoFilter()?.criteria[0]).toBeUndefined();
    expect(store.getAutoFilter()?.criteria[1]).toEqual({ selected: ['85'], includeBlanks: true });
    expect(onClose).toHaveBeenCalled();
  });

  it('removes the current criterion when 确定 is pressed with everything selected', () => {
    const store = setupStore();
    const service = new FilterService(store);
    service.setColumnFilter(0, { selected: ['Alice'], includeBlanks: true });
    const { executed } = setup(store);

    // Draft starts from existing criteria; re-check everything then confirm.
    fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Charlie/ }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));
    expect(executed.at(-1)?.args.mode).toBe('clearColumn');
    expect(store.getAutoFilter()?.criteria[0]).toBeUndefined();
  });

  it('全选 applies to the searched subset only', () => {
    const store = setupStore();
    const { executed } = setup(store);

    fireEvent.change(screen.getByPlaceholderText('搜索'), { target: { value: 'ali' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

    // Unchecking the visible "Alice" while Bob/Charlie stay checked.
    expect(executed.at(-1)?.args.criteria).toEqual({ selected: ['Bob', 'Charlie'], includeBlanks: true });
  });

  it('applies a custom condition and closes', async () => {
    const store = setupStore();
    const { executed, onClose } = setup(store);

    fireEvent.click(screen.getByRole('button', { name: '条件筛选' }));
    // Pick 包含 first: antd Input change before opening leaves the Select closed in jsdom.
    fireEvent.mouseDown(document.querySelector('.ss-filter-dropdown__cond .ant-select-selector') as Element);
    fireEvent.click(await screen.findByText('包含', { selector: '.ant-select-item-option-content' }));
    fireEvent.change(screen.getByPlaceholderText('值'), { target: { value: 'ali' } });
    const buttons = screen.getAllByRole('button', { name: /确\s*定/ });
    fireEvent.click(buttons[0]); // the condition editor's 确定

    expect(onClose).toHaveBeenCalled();
    expect(executed.at(-1)?.args.criteria).toEqual({
      selected: [],
      includeBlanks: false,
      conditions: [{ operator: 'contains', value: 'ali' }],
      conditionsOp: 'and',
    });
    expect(store.getRow(1)?.hide).toBe(false);
    expect(store.getRow(2)?.hide).toBe(true);
    expect(store.getRow(3)?.hide).toBe(true);
  });

  it('shows the active condition summary on the toggle button', () => {
    const store = setupStore();
    const service = new FilterService(store);
    service.setColumnFilter(0, {
      selected: [],
      includeBlanks: false,
      conditions: [{ operator: 'gt', value: '80' }],
    });
    setup(store);
    expect(screen.getByRole('button', { name: /条件：大于 80/ })).toBeTruthy();
  });

  it('reopens and re-applies the filter after a previous confirm', () => {
    const store = setupStore();
    // First open: narrow to Alice only.
    const first = render(
      <FilterDropdown store={store} r={0} c={0} x={100} y={100}
        cmdManagerExecutor={(command) => command.execute(store)} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Charlie/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /确\s*定/ }).at(-1) as HTMLElement);
    expect(store.getRow(2)?.hide).toBe(true);
    first.unmount();

    // Second open: re-check Bob and confirm — the filter must update.
    render(
      <FilterDropdown store={store} r={0} c={0} x={100} y={100}
        cmdManagerExecutor={(command) => command.execute(store)} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /确\s*定/ }).at(-1) as HTMLElement);
    expect(store.getRow(2)?.hide).toBe(false);
    expect(store.getRow(3)?.hide).toBe(true);
  });
});
