import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { SetRowHeight } from '../../src/commands/impl/SetRowHeight';
import { SetColWidth } from '../../src/commands/impl/SetColWidth';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { InsertColCommand } from '../../src/commands/impl/InsertCol';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { SetColsHiddenCommand, SetRowsHiddenCommand } from '../../src/commands/impl/SetHidden';
import { sampleOp } from '../../src/platform/opDetail';

// Replay payloads used to be classified from the command's class name
// (`/row/i` + "not insert" ⇒ deleteRow), so resizing a row was replayed as
// deleting it. Dispatch is by command identity now.
describe('sampleOp replay classification', () => {
  const store = new Store();

  it('never makes a resize or hide command replayable', () => {
    expect(sampleOp(new SetRowHeight({ r: 3, height: 30 }), store)).toEqual({ target: '第4行', value: null, replay: null });
    expect(sampleOp(new SetColWidth({ c: 2, width: 120 }), store)).toEqual({ target: '第3列', value: null, replay: null });
    for (const cmd of [new SetRowsHiddenCommand({ r1: 1, r2: 3, hidden: true }), new SetColsHiddenCommand({ c1: 1, c2: 3, hidden: true })]) {
      const sample = sampleOp(cmd, store);
      if (sample !== null) expect(sample.replay).toBeNull();
    }
  });

  it('gives exactly the structural commands a replay payload', () => {
    expect(sampleOp(new InsertRowCommand({ r: 1, count: 2 }), store)?.replay).toEqual({ kind: 'insertRow', r: 1, count: 2 });
    expect(sampleOp(new DeleteRowCommand({ r: 3 }), store)?.replay).toEqual({ kind: 'deleteRow', r: 3, count: 1 });
    expect(sampleOp(new InsertColCommand({ c: 2, count: 3 }), store)?.replay).toEqual({ kind: 'insertCol', c: 2, count: 3 });
    expect(sampleOp(new DeleteColCommand({ c: 0, sheetId: 'sheet-1' }), store)?.replay).toEqual({ kind: 'deleteCol', c: 0, count: 1, sheetId: 'sheet-1' });
  });
});
