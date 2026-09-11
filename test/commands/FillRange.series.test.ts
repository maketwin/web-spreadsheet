import { describe, expect, it } from 'vitest';
import { FillRangeCommand } from '../../src/commands/impl/FillRange';
import { Store } from '../../src/store/Store';

describe('FillRangeCommand smart series (T2.2)', () => {
  it('infers numeric trend from two values when filling down', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2' });
    store.setCell(1, 0, { text: '4' });
    new FillRangeCommand({
      source: { r1: 0, c1: 0, r2: 1, c2: 0 },
      target: { r1: 0, c1: 0, r2: 4, c2: 0 },
    }).execute(store);

    expect([2, 3, 4].map((r) => store.getCell(r, 0)?.text)).toEqual(['6', '8', '10']);
  });

  it('fills dates across a month boundary', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2026-01-30' });
    new FillRangeCommand({
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 2, c2: 0 },
    }).execute(store);

    expect(store.getCell(1, 0)?.text).toBe('2026-01-31');
    expect(store.getCell(2, 0)?.text).toBe('2026-02-01');
  });

  it('fills weekday names horizontally', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Mon' });
    new FillRangeCommand({
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 0, c2: 2 },
    }).execute(store);

    expect(store.getCell(0, 1)?.text).toBe('Tue');
    expect(store.getCell(0, 2)?.text).toBe('Wed');
  });

  it('fills text+number sequences', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Item1' });
    new FillRangeCommand({
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 2, c2: 0 },
    }).execute(store);

    expect(store.getCell(1, 0)?.text).toBe('Item2');
    expect(store.getCell(2, 0)?.text).toBe('Item3');
  });

  it('shifts formula references along the fill direction', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1', formula: '=B1*2' });
    new FillRangeCommand({
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 2, c2: 0 },
    }).execute(store);

    expect(store.getCell(1, 0)?.formula).toBe('=B2*2');
    expect(store.getCell(2, 0)?.formula).toBe('=B3*2');
  });

  it('falls back to copy for plain text', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'hello' });
    new FillRangeCommand({
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 2, c2: 0 },
    }).execute(store);

    expect(store.getCell(1, 0)?.text).toBe('hello');
    expect(store.getCell(2, 0)?.text).toBe('hello');
  });

  it('Ctrl-drag on a lone number increments and is undoable in one step', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    const cmd = new FillRangeCommand({
      ctrlKey: true,
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 3, c2: 0 },
    });
    cmd.execute(store);
    expect([1, 2, 3].map((r) => store.getCell(r, 0)?.text)).toEqual(['2', '3', '4']);

    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)?.text).toBe('1');
    expect(store.getCell(1, 0)).toBeUndefined();
    expect(store.getCell(3, 0)).toBeUndefined();
  });
});
