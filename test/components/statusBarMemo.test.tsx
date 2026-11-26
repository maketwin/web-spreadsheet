import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from '../../src/components/StatusBar';
import { Store } from '../../src/store/Store';
import { SheetData } from '../../src/store/SheetData';

/**
 * The filled-cell count must be memoized per (store, active sheet, revision):
 * selection-driven re-renders (the hot path — every click re-renders the
 * status bar) must not rescan the sheet's cells, while real content changes
 * and sheet switches must still update the count.
 */
describe('StatusBar filled-cell count memoization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Filled-cell sweeps only: the whole-sheet walk (no rectangle) made with the
   * status bar's own `countFilled` callback. The selection stats walk through
   * the same method — rectangles, or a filtered whole-sheet sweep on tiny
   * sheets — so the rectangle alone does not tell the two apart.
   */
  function spyFullScans(): () => number {
    const spy = vi.spyOn(SheetData.prototype, 'forEachCell');
    return () => spy.mock.calls.filter(([fn, rect]) => rect === undefined && fn.name === 'countFilled').length;
  }

  it('scans cells at most once while only the selection prop changes', () => {
    const fullScans = spyFullScans();
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello', value: 'Hello' });
    store.setCell(1, 0, { text: '42', value: 42 });
    vi.mocked(SheetData.prototype.forEachCell).mockClear();

    const view = render(<StatusBar store={store} selected={null} zoom={100} />);
    expect(screen.getByText(/单元格: 2/)).toBeTruthy();
    const afterFirstRender = fullScans();
    expect(afterFirstRender).toBe(1);

    // Five different selections: exactly what a click stream produces.
    const selections = [
      { r1: 0, c1: 0, r2: 0, c2: 1 },
      { r1: 2, c1: 1, r2: 4, c2: 3 },
      { r1: 5, c1: 0, r2: 5, c2: 0 },
      { r1: 0, c1: 0, r2: 9, c2: 9 },
      { r1: 1, c1: 1, r2: 1, c2: 2 },
    ];
    for (const selected of selections) {
      view.rerender(<StatusBar store={store} selected={selected} zoom={100} />);
    }
    expect(fullScans()).toBe(afterFirstRender);
    // Selection stats keep working across those re-renders.
    view.rerender(<StatusBar store={store} selected={{ r1: 0, c1: 0, r2: 1, c2: 0 }} zoom={100} />);
    expect(screen.getByText(/求和: 42/)).toBeTruthy();
    view.unmount();
  });

  it('recounts exactly once after a cell edit advances the store revision', () => {
    const fullScans = spyFullScans();
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello', value: 'Hello' });
    const view = render(<StatusBar store={store} selected={null} zoom={100} />);
    expect(screen.getByText(/单元格: 1/)).toBeTruthy();
    const base = fullScans();

    store.setCell(1, 0, { text: '42', value: 42 });
    view.rerender(<StatusBar store={store} selected={null} zoom={100} />);
    view.rerender(<StatusBar store={store} selected={{ r1: 0, c1: 0, r2: 1, c2: 0 }} zoom={100} />);

    expect(screen.getByText(/单元格: 2/)).toBeTruthy();
    expect(fullScans()).toBe(base + 1);
    view.unmount();
  });

  it('recounts for the newly active sheet after a sheet switch', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'A', value: 'A' });
    store.setCell(1, 0, { text: 'B', value: 'B' });
    const view = render(<StatusBar store={store} selected={null} zoom={100} />);
    expect(screen.getByText(/单元格: 2/)).toBeTruthy();

    // addSheet activates the new (empty) sheet; fill one cell there.
    const newId = store.addSheet();
    store.setCell(0, 0, { text: 'C', value: 'C' });
    view.rerender(<StatusBar store={store} selected={null} zoom={100} />);

    expect(store.getActiveSheetId()).toBe(newId);
    expect(screen.getByText(/单元格: 1/)).toBeTruthy();
    expect(screen.queryByText(/单元格: 2/)).toBeNull();
    view.unmount();
  });

  it('keeps the AutoFilter record count working (memoization must not hide it)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Name', value: 'Name' });
    store.setCell(1, 0, { text: 'a', value: 'a' });
    store.setCell(2, 0, { text: 'b', value: 'b' });
    store.setCell(3, 0, { text: 'c', value: 'c' });
    store.setCell(4, 0, { text: 'd', value: 'd' });
    store.setRow(2, { hide: true }); // one record hidden by the filter's row hide
    store.setAutoFilter({
      range: { r1: 0, c1: 0, r2: 4, c2: 0 },
      criteria: { 0: { selected: ['a'], includeBlanks: true } },
    });

    render(<StatusBar store={store} selected={null} zoom={100} />);
    expect(screen.getByText(/找到 3 条记录（共 4 条）/)).toBeTruthy();
  });
});
