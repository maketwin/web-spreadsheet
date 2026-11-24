import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { Store } from '../../../src/store/Store';
import type { ViewState } from '../../../src/components/keyboard';
import { useSheetFreeze } from '../../../src/components/hooks/useSheetFreeze';

const initial: ViewState = { zoom: 100, showFormula: false, showGrid: true, frozenRows: 0, frozenCols: 0 };

function setup(store = new Store()) {
  const hook = renderHook(({ sheet }: { sheet: string }) => {
    const [view, setView] = useState<ViewState>(initial);
    useSheetFreeze(store, sheet, view, setView);
    return { view, setView };
  }, { initialProps: { sheet: store.getActiveSheetId() } });
  return hook;
}

// Frozen rows/columns live in each sheet's data; the view shows the active
// sheet's and a freeze toggled in the view is written back.
describe('useSheetFreeze', () => {
  it('shows the sheet own freeze on mount without clearing it', () => {
    const store = new Store();
    store.setFreeze({ rows: 2, cols: 1 });
    const hook = setup(store);
    expect(hook.result.current.view.frozenRows).toBe(2);
    expect(hook.result.current.view.frozenCols).toBe(1);
    expect(store.getFreeze()).toEqual({ rows: 2, cols: 1 });
  });

  it('writes a freeze toggled in the view to the active sheet', () => {
    const store = new Store();
    const hook = setup(store);
    act(() => { hook.result.current.setView((current) => ({ ...current, frozenRows: 3 })); });
    expect(store.getFreeze()).toEqual({ rows: 3, cols: 0 });
    act(() => { hook.result.current.setView((current) => ({ ...current, frozenRows: 0 })); });
    expect(store.getFreeze()).toBeUndefined();
  });

  it('follows the active sheet, each sheet keeping its own freeze', () => {
    const store = new Store();
    const first = store.getActiveSheetId();
    const second = store.addSheet('Second');
    store.setFreeze({ rows: 1, cols: 2 }, second);
    store.activateSheet(first); // addSheet activates the new sheet
    const hook = setup(store);
    act(() => { hook.result.current.setView((current) => ({ ...current, frozenRows: 4 })); });
    expect(store.getFreeze(first)).toEqual({ rows: 4, cols: 0 });

    act(() => { hook.rerender({ sheet: second }); });
    expect(hook.result.current.view.frozenRows).toBe(1);
    expect(hook.result.current.view.frozenCols).toBe(2);
    // The sheet just left keeps its freeze; the one just entered is not overwritten with it.
    expect(store.getFreeze(first)).toEqual({ rows: 4, cols: 0 });
    expect(store.getFreeze(second)).toEqual({ rows: 1, cols: 2 });

    act(() => { hook.rerender({ sheet: first }); });
    expect(hook.result.current.view.frozenRows).toBe(4);
    expect(store.getFreeze(second)).toEqual({ rows: 1, cols: 2 });
  });

  it('follows a replaced workbook even when the active sheet id stays the same', () => {
    const store = new Store();
    store.setFreeze({ rows: 5, cols: 0 });
    const hook = setup(store);
    const replacement = new Store();
    replacement.setFreeze({ rows: 0, cols: 3 });
    act(() => { store.replaceAll(replacement.serialize()); });
    expect(hook.result.current.view.frozenCols).toBe(3);
    expect(hook.result.current.view.frozenRows).toBe(0);
    expect(store.getFreeze()).toEqual({ rows: 0, cols: 3 });
  });
});
