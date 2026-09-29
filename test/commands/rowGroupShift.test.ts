import { describe, expect, it } from 'vitest';
import { DeleteRowCommand, InsertRowCommand } from '../../src/index';
import { shiftRowGroupsForDelete, shiftRowGroupsForInsert } from '../../src/outline/rowGroupShift';
import { Store } from '../../src/store/Store';

describe('shiftRowGroupsForInsert', () => {
  it('grows a group when inserting inside it (Excel)', () => {
    expect(shiftRowGroupsForInsert([{ start: 2, end: 4 }], 3, 1)).toEqual([{ start: 2, end: 5 }]);
    expect(shiftRowGroupsForInsert([{ start: 2, end: 4 }], 4, 2)).toEqual([{ start: 2, end: 6 }]);
  });

  it('pushes a group down when inserting at its top edge', () => {
    expect(shiftRowGroupsForInsert([{ start: 2, end: 4 }], 2, 1)).toEqual([{ start: 3, end: 5 }]);
  });

  it('shifts groups below and leaves groups above untouched', () => {
    expect(shiftRowGroupsForInsert([{ start: 5, end: 8 }], 0, 2)).toEqual([{ start: 7, end: 10 }]);
    expect(shiftRowGroupsForInsert([{ start: 0, end: 1 }], 5, 1)).toEqual([{ start: 0, end: 1 }]);
  });
});

describe('shiftRowGroupsForDelete', () => {
  it('shrinks a group when part of it is deleted (new coordinates)', () => {
    expect(shiftRowGroupsForDelete([{ start: 2, end: 4 }], 3, 3)).toEqual([{ start: 2, end: 3 }]);
    expect(shiftRowGroupsForDelete([{ start: 2, end: 4 }], 2, 2)).toEqual([{ start: 2, end: 3 }]);
  });

  it('drops a fully covered group and shifts groups below up', () => {
    expect(shiftRowGroupsForDelete([{ start: 2, end: 3 }], 2, 3)).toEqual([]);
    expect(shiftRowGroupsForDelete([{ start: 6, end: 8 }], 2, 3)).toEqual([{ start: 4, end: 6 }]);
  });

  it('keeps overlapping groups that shrink to a single row', () => {
    expect(shiftRowGroupsForDelete([{ start: 2, end: 3 }], 3, 4)).toEqual([{ start: 2, end: 2 }]);
  });
});

describe('row groups survive insert/delete row with undo', () => {
  it('inserting inside a group grows it; undo restores the original interval', () => {
    const store = new Store();
    store.setRowGroups([{ start: 2, end: 4 }]);
    const cmd = new InsertRowCommand({ r: 3 });
    cmd.execute(store);
    expect(store.getRowGroups()).toEqual([{ start: 2, end: 5 }]);
    cmd.getUndo().execute(store);
    expect(store.getRowGroups()).toEqual([{ start: 2, end: 4 }]);
  });

  it('deleting a group removes it; undo brings it back', () => {
    const store = new Store();
    store.setRowGroups([{ start: 2, end: 4 }, { start: 8, end: 9 }]);
    const cmd = new DeleteRowCommand({ r: 2, count: 3 });
    cmd.execute(store);
    // [2,4] is fully covered → dropped; [8,9] shifts up to [5,6].
    expect(store.getRowGroups()).toEqual([{ start: 5, end: 6 }]);
    cmd.getUndo().execute(store);
    expect(store.getRowGroups()).toEqual([{ start: 2, end: 4 }, { start: 8, end: 9 }]);
  });

  it('leaves other sheets\' groups untouched (sheet-scoped shift)', () => {
    const store = new Store();
    const sheet1 = store.getActiveSheetId();
    const otherId = store.addSheet('Other');
    store.setRowGroups([{ start: 1, end: 2 }], otherId);
    store.activateSheet(sheet1);
    const cmd = new DeleteRowCommand({ r: 0 });
    cmd.execute(store);
    expect(store.getRowGroups(otherId)).toEqual([{ start: 1, end: 2 }]);
  });
});
