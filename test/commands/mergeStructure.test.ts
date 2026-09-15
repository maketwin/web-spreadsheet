import { describe, expect, it } from 'vitest';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { InsertColCommand } from '../../src/commands/impl/InsertCol';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { FillRangeCommand } from '../../src/commands/impl/FillRange';
import { MoveRange } from '../../src/commands/impl/MoveRange';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { Store } from '../../src/store/Store';

describe('insert/delete row/col with merges (Excel)', () => {
  it('InsertRow shifts merges below and grows straddling merges', () => {
    const store = new Store();
    store.addMerge('A1:B1');
    store.addMerge('C5:D6');

    new InsertRowCommand({ r: 4 }).execute(store);

    expect(store.getMerges()).toEqual(['A1:B1', 'C6:D7']);
  });

  it('InsertRow undo restores merges', () => {
    const store = new Store();
    store.addMerge('C5:D6');
    const cmd = new InsertRowCommand({ r: 4 });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getMerges()).toEqual(['C5:D6']);
  });

  it('DeleteRow removes a fully covered merge', () => {
    const store = new Store();
    store.addMerge('A3:B4');

    new DeleteRowCommand({ r: 2, count: 2 }).execute(store);

    expect(store.getMerges()).toEqual([]);
  });

  it('DeleteCol shifts merges right of the deletion', () => {
    const store = new Store();
    store.addMerge('D2:E3');

    new DeleteColCommand({ c: 0, count: 2 }).execute(store);

    expect(store.getMerges()).toEqual(['B2:C3']);
  });

  it('InsertCol shifts merges', () => {
    const store = new Store();
    store.addMerge('B2:C3');

    new InsertColCommand({ c: 0 }).execute(store);

    expect(store.getMerges()).toEqual(['C2:D3']);
  });
});

describe('FillRange with merges (Excel fill handle)', () => {
  it('tiles the source merge pattern into the extended area', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    store.addMerge('A1:B1');

    new FillRangeCommand({ source: { r1: 0, c1: 0, r2: 0, c2: 1 }, target: { r1: 0, c1: 0, r2: 2, c2: 1 } }).execute(store);

    expect(store.getMerges()).toContain('A2:B2');
    expect(store.getMerges()).toContain('A3:B3');
  });

  it('does not create merges when the target is not an exact multiple', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    store.addMerge('A1:B2');

    new FillRangeCommand({ source: { r1: 0, c1: 0, r2: 1, c2: 1 }, target: { r1: 0, c1: 0, r2: 2, c2: 1 } }).execute(store);

    expect(store.getMerges()).toEqual(['A1:B2']);
  });

  it('undo removes the merges created by the fill', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    store.addMerge('A1:B1');
    const cmd = new FillRangeCommand({ source: { r1: 0, c1: 0, r2: 0, c2: 1 }, target: { r1: 0, c1: 0, r2: 2, c2: 1 } });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getMerges()).toEqual(['A1:B1']);
  });
});

describe('MoveRange with merges (Excel drag move)', () => {
  it('relocates merges fully inside the moved block', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'x' });
    store.addMerge('A1:B1');

    new MoveRange({ source: { r1: 0, c1: 0, r2: 0, c2: 1 }, target: { r1: 4, c1: 4, r2: 4, c2: 5 } }).execute(store);

    expect(store.getMerges()).toEqual(['E5:F5']);
  });

  it('copy-drag duplicates the merge', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'x' });
    store.addMerge('A1:B1');

    new MoveRange({ source: { r1: 0, c1: 0, r2: 0, c2: 1 }, target: { r1: 4, c1: 4, r2: 4, c2: 5 }, copy: true }).execute(store);

    expect(store.getMerges()).toContain('A1:B1');
    expect(store.getMerges()).toContain('E5:F5');
  });

  it('copy-drag onto its own merge keeps the merge (degenerate overlap)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'x' });
    store.addMerge('A1:B1');

    new MoveRange({ source: { r1: 0, c1: 0, r2: 0, c2: 1 }, target: { r1: 0, c1: 0, r2: 0, c2: 1 }, copy: true }).execute(store);

    expect(store.getMerges()).toEqual(['A1:B1']);
  });

  it('undo restores the original merge structure', () => {
    const store = new Store();
    store.addMerge('A1:B1');
    const cmd = new MoveRange({ source: { r1: 0, c1: 0, r2: 0, c2: 1 }, target: { r1: 4, c1: 4, r2: 4, c2: 5 } });

    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getMerges()).toEqual(['A1:B1']);
  });
});

describe('SortRange with merges (Excel refuses)', () => {
  it('is a no-op when the sort range intersects a merge', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(1, 0, { text: '1', value: 1 });
    store.addMerge('A1:B1');

    new SortRangeCommand({ r1: 0, c1: 0, r2: 1, c2: 0, sortCol: 0, direction: 'asc' }).execute(store);

    expect(store.getCell(0, 0)?.value).toBe(2);
    expect(store.getCell(1, 0)?.value).toBe(1);
  });
});
