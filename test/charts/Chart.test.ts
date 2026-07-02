import { describe, it, expect } from 'vitest';
import { Store } from '../../src/store/Store';
import { CreateChartCommand } from '../../src/commands/impl/CreateChart';
import type { ChartSpec } from '../../src/charts/types';

describe('Chart', () => {
  function setupStore(): Store {
    const store = new Store();
    store.setCell(0, 0, { text: 'Category' });
    store.setCell(0, 1, { text: 'Value' });
    store.setCell(1, 0, { text: 'A' });
    store.setCell(1, 1, { text: '10', value: 10 });
    store.setCell(2, 0, { text: 'B' });
    store.setCell(2, 1, { text: '20', value: 20 });
    store.setCell(3, 0, { text: 'C' });
    store.setCell(3, 1, { text: '30', value: 30 });
    return store;
  }

  it('creates a bar chart from range', () => {
    const store = setupStore();
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 3, c2: 1, type: 'bar' });
    cmd.execute(store);
    const charts = store.getCharts();
    expect(charts.length).toBe(1);
    expect(charts[0]?.type).toBe('bar');
    expect(charts[0]?.range).toBe('0,0:3,1');
  });

  it('creates a line chart from range', () => {
    const store = setupStore();
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 3, c2: 1, type: 'line' });
    cmd.execute(store);
    const charts = store.getCharts();
    expect(charts.length).toBe(1);
    expect(charts[0]?.type).toBe('line');
  });

  it('creates a pie chart from range', () => {
    const store = setupStore();
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 3, c2: 1, type: 'pie', title: 'Sales' });
    cmd.execute(store);
    const charts = store.getCharts();
    expect(charts.length).toBe(1);
    expect(charts[0]?.type).toBe('pie');
    expect(charts[0]?.title).toBe('Sales');
  });

  it('reads chart data from store', () => {
    const store = setupStore();
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 3, c2: 1, type: 'bar' });
    cmd.execute(store);
    const spec = store.getCharts()[0];
    expect(spec).toBeDefined();
    // Verify data is accessible via store
    expect(store.getCell(1, 1)?.value).toBe(10);
    expect(store.getCell(2, 1)?.value).toBe(20);
    expect(store.getCell(3, 1)?.value).toBe(30);
  });

  it('undo removes the chart', () => {
    const store = setupStore();
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 3, c2: 1, type: 'bar' });
    cmd.execute(store);
    expect(store.getCharts().length).toBe(1);
    cmd.getUndo().execute(store);
    expect(store.getCharts().length).toBe(0);
  });

  it('add and remove chart via store', () => {
    const store = new Store();
    const spec: ChartSpec = { id: 'chart-test', type: 'bar', range: '0,0:3,1' };
    store.addChart(spec);
    expect(store.getCharts().length).toBe(1);
    store.removeChart('chart-test');
    expect(store.getCharts().length).toBe(0);
  });
});
