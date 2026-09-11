import { describe, expect, it } from 'vitest';
import { CreateChartCommand } from '../../src/commands/impl/CreateChart';
import { Store } from '../../src/store/Store';

describe('CreateChartCommand undo', () => {
  it('undo removes the created chart', () => {
    const store = new Store();
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 4, c2: 1, type: 'bar', title: 'Sales' });

    cmd.execute(store);
    expect(store.getCharts()).toHaveLength(1);

    cmd.getUndo().execute(store);
    expect(store.getCharts()).toHaveLength(0);
  });
});
