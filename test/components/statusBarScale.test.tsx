import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from '../../src/components/StatusBar';
import { Store } from '../../src/store/Store';
import { SheetData } from '../../src/store/SheetData';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';

/**
 * Scale guards for the status bar: an entire-column selection (the Excel way
 * to sum a column) must sum only the stored cells, and a re-render with the
 * same selection on an unchanged sheet must not rescan at all.
 */

const DATA_ROWS = 500_000;
const wholeColumn = { r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: 0 };
const wholeSheet = { r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: TOTAL_COLS - 1 };

function setupBigColumn(): Store {
  const store = new Store();
  // 1..500000: sum = 125000250000, avg = 250000.5
  for (let r = 0; r < DATA_ROWS; r += 1) store.setCell(r, 0, { text: String(r + 1), value: r + 1, type: 'number' });
  return store;
}

describe('StatusBar at grid scale', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('sums an entire-column selection of 500k numbers within a loose wall-clock budget', () => {
    const store = setupBigColumn();
    const started = performance.now();
    render(<StatusBar store={store} selected={wholeColumn} zoom={100} />);
    const elapsed = performance.now() - started;

    expect(screen.getByText(/求和: 125000250000/)).toBeTruthy();
    expect(screen.getByText(/平均: 250000.50/)).toBeTruthy();
    expect(screen.getByText(/计数: 500000/)).toBeTruthy();
    // Loose bound: the sparse sweep measures ~13 ms per pass, the worst
    // observed full render ~110 ms cold. CI runs under coverage on a slower,
    // loaded runner (~10x); the dense alternative would never finish.
    expect(elapsed).toBeLessThan(2000);
  });

  it('re-rendering the same selection on an unchanged sheet does not rescan', () => {
    const store = setupBigColumn();
    const spy = vi.spyOn(SheetData.prototype, 'forEachCell');
    const view = render(<StatusBar store={store} selected={wholeColumn} zoom={100} />);
    const afterFirstRender = spy.mock.calls.length;
    expect(afterFirstRender).toBeGreaterThan(0);

    view.rerender(<StatusBar store={store} selected={wholeColumn} zoom={100} />);
    view.rerender(<StatusBar store={store} selected={wholeColumn} zoom={101} />);
    expect(spy.mock.calls.length).toBe(afterFirstRender);
    expect(screen.getByText(/求和: 125000250000/)).toBeTruthy();
  });

  it('recalculates when the sheet content changes under the same selection', () => {
    const store = setupBigColumn();
    const spy = vi.spyOn(SheetData.prototype, 'forEachCell');
    const view = render(<StatusBar store={store} selected={wholeColumn} zoom={100} />);
    const base = spy.mock.calls.length;

    store.setCell(DATA_ROWS, 0, { text: '1', value: 1, type: 'number' });
    view.rerender(<StatusBar store={store} selected={wholeColumn} zoom={100} />);

    expect(screen.getByText(/求和: 125000250001/)).toBeTruthy();
    expect(spy.mock.calls.length).toBeGreaterThan(base);
  });

  it('a whole-sheet selection on an empty sheet shows no stats', () => {
    const store = new Store();
    render(<StatusBar store={store} selected={wholeSheet} zoom={100} />);
    expect(screen.queryByText(/求和/)).toBeNull();
    expect(screen.queryByText(/计数/)).toBeNull();
  });
});
