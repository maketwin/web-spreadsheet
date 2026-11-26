import { describe, expect, it, vi } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { isReservedAxisStyleId } from '../../src/commands/impl/SetAxisStyle';
import { applyMatrix } from '../../src/commands/rangeValues';
import { buildSessionPasteValues, snapshotCells, type ClipboardSessionState } from '../../src/clipboard/session';
import { ClipboardService } from '../../src/clipboard/ClipboardService';
import { Store } from '../../src/store/Store';
import { TOTAL_ROWS } from '../../src/util/gridSize';

import type { RangeAddress } from '../../src/selection/Range';

const run = (cm: CommandManager, cmd: Parameters<CommandManager['execute']>[0]): void => { cm.execute.bind(cm)(cmd); };

const wholeColumn = (c: number): RangeAddress => ({ r1: 0, c1: c, r2: TOTAL_ROWS - 1, c2: c });

describe('copy materializes inherited axis formats', () => {
  it('a cell styled only through its column default gets a materialized own styleId on copy', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    store.setCell(0, 0, { text: 'A', value: 'A' });
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(0), style: { bold: true } }));

    const source = store.getCell(0, 0);
    expect(source?.styleId).toBeUndefined(); // nothing stored before the copy

    const cells = snapshotCells(store, { r1: 0, c1: 0, r2: 0, c2: 0 });
    const copied = cells[0]?.[0];
    expect(copied?.styleId).toBeDefined();
    expect(isReservedAxisStyleId(copied?.styleId ?? '')).toBe(false); // never hands out axis ids
    expect(store.getStyle(copied?.styleId ?? '')?.bold).toBe(true);
    // The sheet itself is untouched: no styleId was written onto the source cell.
    expect(store.getCell(0, 0)?.styleId).toBeUndefined();
  });

  it('pasting the copied block into a plain column lands bold', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    store.setCell(0, 0, { text: 'A', value: 'A' });
    store.setCell(1, 0, { text: 'B', value: 'B' });
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(0), style: { bold: true } }));

    const session: ClipboardSessionState = {
      type: 'copy',
      sheetId: store.getActiveSheetId(),
      range: { r1: 0, c1: 0, r2: 1, c2: 0 },
      text: 'A\nB',
      cells: snapshotCells(store, { r1: 0, c1: 0, r2: 1, c2: 0 }),
    };
    const patches = buildSessionPasteValues(session, 0, 3);
    applyMatrix(store, cm, 0, 3, patches);

    expect(store.getCellStyle(0, 3)?.bold).toBe(true);
    expect(store.getCellStyle(1, 3)?.bold).toBe(true);
    // The pasted cells own their format (no column default on column D).
    expect(store.getCell(0, 3)?.styleId).toBeDefined();
    // Two source cells sharing one effective style share one materialized id.
    expect(store.getCell(0, 3)?.styleId).toBe(store.getCell(1, 3)?.styleId);
  });

  it('createPayload materializes the same way for the external clipboard path', () => {
    const spy = vi.spyOn(Store.prototype, 'setStyle');
    const store = new Store();
    const cm = new CommandManager(store);
    store.setCell(0, 0, { text: 'A', value: 'A' });
    run(cm, new SetRangeStyleCommand({ ...wholeColumn(0), style: { bold: true } }));
    spy.mockClear();

    const payload = ClipboardService.createPayload(store, { r1: 0, c1: 0, r2: 0, c2: 0 });
    expect(payload?.text).toBe('A');
    expect(spy).toHaveBeenCalled(); // the inherited style was registered under a fresh id
    spy.mockRestore();
  });
});
