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

  // 曾被记成 deleteRow（类名含 Row）的行高命令，现在按稳定身份记为 setRowHeight——
  // 旧的 5 种载荷形状只属于结构命令和编辑命令，绝不会落到行高/列宽/隐藏头上。
  it('resizes and hides replay by identity, never as legacy structural payloads', () => {
    expect(sampleOp(new SetRowHeight({ r: 5, height: 40 }), store)).toEqual({
      target: '第6行',
      value: null,
      replay: { kind: 'command', command: 'setRowHeight', args: { r: 5, height: 40 } },
    });
    expect(sampleOp(new SetColWidth({ c: 2, width: 120 }), store)?.replay).toEqual({ kind: 'command', command: 'setColWidth', args: { c: 2, width: 120 } });
    expect(sampleOp(new SetRowsHiddenCommand({ r1: 1, r2: 3, hidden: true }), store)?.replay).toEqual({ kind: 'command', command: 'setRowsHidden', args: { r1: 1, r2: 3, hidden: true } });
    expect(sampleOp(new SetColsHiddenCommand({ c1: 1, c2: 3, hidden: true }), store)?.replay).toEqual({ kind: 'command', command: 'setColsHidden', args: { c1: 1, c2: 3, hidden: true } });
  });

  it('gives exactly the structural commands the legacy payload shapes', () => {
    expect(sampleOp(new InsertRowCommand({ r: 1, count: 2 }), store)?.replay).toEqual({ kind: 'insertRow', r: 1, count: 2 });
    expect(sampleOp(new DeleteRowCommand({ r: 3 }), store)?.replay).toEqual({ kind: 'deleteRow', r: 3, count: 1 });
    expect(sampleOp(new InsertColCommand({ c: 2, count: 3 }), store)?.replay).toEqual({ kind: 'insertCol', c: 2, count: 3 });
    expect(sampleOp(new DeleteColCommand({ c: 0, sheetId: 'sheet-1' }), store)?.replay).toEqual({ kind: 'deleteCol', c: 0, count: 1, sheetId: 'sheet-1' });
  });
});
