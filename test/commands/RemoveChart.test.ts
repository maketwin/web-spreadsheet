import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { CreateChartCommand } from '../../src/commands/impl/CreateChart';
import { RemoveChartCommand } from '../../src/commands/impl/RemoveChart';
import { Range } from '../../src/selection/Range';
import { Store } from '../../src/store/Store';

describe('RemoveChartCommand', () => {
  it('removes the chart and undo restores it', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    manager.execute(new CreateChartCommand({ ...Range.single(0, 0).toAddress(), type: 'bar' }));
    const id = store.getCharts()[0]!.id;
    expect(store.getCharts()).toHaveLength(1);

    manager.execute(new RemoveChartCommand({ id }));
    expect(store.getCharts()).toHaveLength(0);

    manager.undo();
    expect(store.getCharts()).toHaveLength(1);
    expect(store.getCharts()[0]!.type).toBe('bar');
  });

  it('redo removes it again', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    manager.execute(new CreateChartCommand({ ...Range.single(0, 0).toAddress(), type: 'line' }));
    const id = store.getCharts()[0]!.id;
    manager.execute(new RemoveChartCommand({ id }));
    manager.undo();
    manager.redo();
    expect(store.getCharts()).toHaveLength(0);
  });

  it('removing an unknown chart id is a no-op kept out of history', () => {
    const store = new Store();
    const manager = new CommandManager(store);
    manager.execute(new RemoveChartCommand({ id: 'missing' }));
    expect(manager.canUndo()).toBe(false);
  });
});
