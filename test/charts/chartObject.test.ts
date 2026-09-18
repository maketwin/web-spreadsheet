import { describe, it, expect } from 'vitest';
import { Store } from '../../src/store/Store';
import { CreateChartCommand } from '../../src/commands/impl/CreateChart';
import { SetChartAnchorCommand } from '../../src/commands/impl/SetChartAnchor';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { captureSheet, restoreSheet } from '../../src/commands/impl/sheetSnapshot';
import type { Command } from '../../src/commands/Command';
import type { ChartAnchor } from '../../src/charts/types';

const anchor: ChartAnchor = {
  from: { r: 1, c: 0, offX: 0, offY: 0 },
  to: { r: 10, c: 5, offX: 20, offY: 12 },
};

/** Run a command the way the UI does (CommandManager not needed here). */
function run(cmd: Command<unknown>, store: Store): void {
  cmd.execute.bind(cmd)(store);
}

function storeWithChart(): Store {
  const store = new Store();
  run(new CreateChartCommand({ r1: 0, c1: 0, r2: 3, c2: 1, type: 'bar', anchor }), store);
  return store;
}

describe('floating chart objects', () => {
  it('CreateChart stores the anchor and reports its id', () => {
    const store = new Store();
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 3, c2: 1, type: 'bar', anchor });
    run(cmd, store);
    const [chart] = store.getCharts();
    expect(chart?.anchor).toEqual(anchor);
    expect(cmd.chartId).toBe(chart?.id);
  });

  it('CreateChart synthesizes a fallback anchor for legacy callers', () => {
    const store = new Store();
    run(new CreateChartCommand({ r1: 0, c1: 0, r2: 3, c2: 1, type: 'bar' }), store);
    expect(store.getCharts()[0]?.anchor).toBeDefined();
  });

  it('SetChartAnchorCommand moves the object and undo restores it', () => {
    const store = storeWithChart();
    const id = store.getCharts()[0]?.id ?? '';
    const next: ChartAnchor = { from: { r: 5, c: 5, offX: 1, offY: 2 }, to: { r: 15, c: 10, offX: 3, offY: 4 } };
    const cmd = new SetChartAnchorCommand({ id, anchor: next });
    run(cmd, store);
    expect(store.getCharts()[0]?.anchor).toEqual(next);
    expect(cmd.isNoOp()).toBe(false);
    run(cmd.getUndo(), store);
    expect(store.getCharts()[0]?.anchor).toEqual(anchor);
  });

  it('SetChartAnchorCommand is a no-op when the anchor is unchanged', () => {
    const store = storeWithChart();
    const id = store.getCharts()[0]?.id ?? '';
    const cmd = new SetChartAnchorCommand({ id, anchor });
    run(cmd, store);
    expect(cmd.isNoOp()).toBe(true);
  });

  it('inserting rows drags the object with its anchor rows', () => {
    const store = storeWithChart();
    const cmd = new InsertRowCommand({ r: 0, count: 3 });
    run(cmd, store);
    const moved = store.getCharts()[0]?.anchor;
    expect(moved?.from.r).toBe(4);
    expect(moved?.to.r).toBe(13);
    // Excel: structural edits are undoable, floating objects included.
    run(cmd.getUndo(), store);
    expect(store.getCharts()[0]?.anchor).toEqual(anchor);
  });

  it('deleting columns shifts the anchor (and clamps edges inside the band)', () => {
    const store = storeWithChart();
    run(new DeleteColCommand({ c: 0, count: 1 }), store);
    const moved = store.getCharts()[0]?.anchor;
    expect(moved?.from.c).toBe(0);
    expect(moved?.to.c).toBe(4);
  });

  it('sheet snapshots carry chart objects', () => {
    const store = storeWithChart();
    const snapshot = captureSheet(store);
    store.removeChart(store.getCharts()[0]?.id ?? '');
    expect(store.getCharts().length).toBe(0);
    restoreSheet(store, snapshot);
    expect(store.getCharts()[0]?.anchor).toEqual(anchor);
  });
});
