import { describe, expect, it } from 'vitest';
import { SetSparklineCommand } from '../../src/commands/impl/SetSparkline';
import { Store } from '../../src/store/Store';

describe('SetSparklineCommand undo', () => {
  it('undo removes the created sparkline', () => {
    const store = new Store();
    const cmd = new SetSparklineCommand({ r1: 0, c1: 0, r2: 0, c2: 4, type: 'line', targetRow: 1, targetCol: 0 });

    cmd.execute(store);
    expect(store.getSparklines()).toHaveLength(1);

    cmd.getUndo().execute(store);
    expect(store.getSparklines()).toHaveLength(0);
  });
});
