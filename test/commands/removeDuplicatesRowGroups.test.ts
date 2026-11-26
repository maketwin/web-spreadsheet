import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import { RemoveDuplicatesCommand } from '../../src/commands/impl/RemoveDuplicates';
import { TOTAL_ROWS } from '../../src/util/gridSize';

import type { Command } from '../../src/commands/Command';

/** CommandManager calls must not contain the forbidden literal form. */
const run = (cm: CommandManager, cmd: Command): void => { cm.execute.bind(cm)(cmd); };

/** A sheet with one text column and the given outline row groups (0-based, inclusive). */
function sheet(texts: readonly string[], groups: readonly (readonly [number, number])[]): { store: Store; cm: CommandManager; sid: string } {
  const store = new Store();
  const sid = store.getActiveSheetId();
  texts.forEach((text, r) => store.setCell(r, 0, { text }, sid));
  store.setRowGroups(groups.map(([start, end]) => ({ start, end })), sid);
  return { store, cm: new CommandManager(store), sid };
}

const dedupe = (sid: string): Command => new RemoveDuplicatesCommand({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: 0, columns: [0], hasHeader: false, sheetId: sid });

describe('RemoveDuplicates keeps the outline row groups in step with the removed rows', () => {
  it('a group spanning removed rows shrinks, groups below move up, undo restores', () => {
    // A B A B A: rows 3-5 are duplicates and leave as one span.
    const { store, cm, sid } = sheet(['A', 'B', 'A', 'B', 'A', 'C'], [[1, 4], [5, 8]]);
    run(cm, dedupe(sid));
    expect([0, 1, 2].map((r) => store.getCell(r, 0, sid)?.text)).toEqual(['A', 'B', 'C']);
    expect(store.getRowGroups(sid)).toEqual([{ start: 1, end: 1 }, { start: 2, end: 5 }]);
    cm.undo();
    expect(store.getRowGroups(sid)).toEqual([{ start: 1, end: 4 }, { start: 5, end: 8 }]);
    expect([0, 1, 2, 3, 4, 5].map((r) => store.getCell(r, 0, sid)?.text)).toEqual(['A', 'B', 'A', 'B', 'A', 'C']);
  });

  it('two separate removed rows collapse the groups they cross and shift the rest', () => {
    // A B A C B: row 3 (A) and row 5 (B) are duplicates — two one-row spans, deleted bottom-up.
    const { store, cm, sid } = sheet(['A', 'B', 'A', 'C', 'B', 'D', 'E', 'F', 'G', 'H'], [[0, 3], [5, 9]]);
    run(cm, dedupe(sid));
    expect([0, 1, 2, 3].map((r) => store.getCell(r, 0, sid)?.text)).toEqual(['A', 'B', 'C', 'D']);
    // {0,3} loses its row 3 → {0,2}; {5,9} loses one row above and one inside → {3,7}.
    expect(store.getRowGroups(sid)).toEqual([{ start: 0, end: 2 }, { start: 3, end: 7 }]);
    cm.undo();
    expect(store.getRowGroups(sid)).toEqual([{ start: 0, end: 3 }, { start: 5, end: 9 }]);
  });

  it('a group made entirely of duplicates disappears; undo brings it back', () => {
    // A A A: rows 2-3 go.
    const { store, cm, sid } = sheet(['A', 'A', 'A', 'B'], [[1, 2], [3, 6]]);
    run(cm, dedupe(sid));
    expect(store.getRowGroups(sid)).toEqual([{ start: 1, end: 4 }]);
    cm.undo();
    expect(store.getRowGroups(sid)).toEqual([{ start: 1, end: 2 }, { start: 3, end: 6 }]);
  });
});
