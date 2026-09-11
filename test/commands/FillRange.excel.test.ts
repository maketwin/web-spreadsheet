import { describe, expect, it } from 'vitest';
import { FillRangeCommand } from '../../src/commands/impl/FillRange';
import { Store } from '../../src/store/Store';

/**
 * Excel fill-handle parity matrix: what a plain drag fills vs. holding Ctrl.
 * Ctrl toggles — series-able sources copy, a lone number increments.
 */
describe('FillRangeCommand Excel parity', () => {
  const fill = (store: Store, source: { r1: number; c1: number; r2: number; c2: number }, target: { r1: number; c1: number; r2: number; c2: number }, ctrl = false): void => {
    new FillRangeCommand({ ctrlKey: ctrl, source, target }).execute(store);
  };
  const column = (store: Store, r1: number, r2: number): string[] => {
    const out: string[] = [];
    for (let r = r1; r <= r2; r += 1) out.push(store.getCell(r, 0)?.text ?? '');
    return out;
  };

  describe('default drag (no Ctrl)', () => {
    it('copies a lone number', () => {
      const store = new Store();
      store.setCell(0, 0, { text: '5' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
      expect(column(store, 0, 2)).toEqual(['5', '5', '5']);
    });

    it('continues an arithmetic pair', () => {
      const store = new Store();
      store.setCell(0, 0, { text: '1' });
      store.setCell(1, 0, { text: '3' });
      fill(store, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
      expect(column(store, 0, 4)).toEqual(['1', '3', '5', '7', '9']);
    });

    it('increments a lone date by one day', () => {
      const store = new Store();
      store.setCell(0, 0, { text: '2026-09-10' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
      expect(column(store, 0, 2)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    });

    it('cycles text lists', () => {
      const store = new Store();
      store.setCell(0, 0, { text: 'Mon' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
      expect(column(store, 0, 2)).toEqual(['Mon', 'Tue', 'Wed']);
    });

    it('increments text+number', () => {
      const store = new Store();
      store.setCell(0, 0, { text: 'Item1' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
      expect(column(store, 0, 2)).toEqual(['Item1', 'Item2', 'Item3']);
    });
  });

  describe('Ctrl held (toggle)', () => {
    it('increments a lone number', () => {
      const store = new Store();
      store.setCell(0, 0, { text: '5' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 }, true);
      expect(column(store, 0, 2)).toEqual(['5', '6', '7']);
    });

    it('copies an arithmetic pair instead of continuing it', () => {
      const store = new Store();
      store.setCell(0, 0, { text: '1' });
      store.setCell(1, 0, { text: '3' });
      fill(store, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 5, c2: 0 }, true);
      expect(column(store, 0, 5)).toEqual(['1', '3', '1', '3', '1', '3']);
    });

    it('copies a lone date', () => {
      const store = new Store();
      store.setCell(0, 0, { text: '2026-09-10' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 }, true);
      expect(column(store, 0, 2)).toEqual(['2026-09-10', '2026-09-10', '2026-09-10']);
    });

    it('copies a weekday list entry', () => {
      const store = new Store();
      store.setCell(0, 0, { text: 'Mon' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 }, true);
      expect(column(store, 0, 2)).toEqual(['Mon', 'Mon', 'Mon']);
    });

    it('copies text+number', () => {
      const store = new Store();
      store.setCell(0, 0, { text: 'Item1' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 }, true);
      expect(column(store, 0, 2)).toEqual(['Item1', 'Item1', 'Item1']);
    });

    it('still copies plain text (nothing to toggle)', () => {
      const store = new Store();
      store.setCell(0, 0, { text: 'hello' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 1, c2: 0 }, true);
      expect(column(store, 0, 1)).toEqual(['hello', 'hello']);
    });
  });

  describe('filling upward / leftward', () => {
    it('continues a numeric series before the first value', () => {
      const store = new Store();
      store.setCell(1, 0, { text: '1' });
      store.setCell(2, 0, { text: '3' });
      fill(store, { r1: 1, c1: 0, r2: 2, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
      expect(store.getCell(0, 0)?.text).toBe('-1');
    });

    it('decrements a lone date upward', () => {
      const store = new Store();
      store.setCell(1, 0, { text: '2026-09-10' });
      fill(store, { r1: 1, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 1, c2: 0 });
      expect(store.getCell(0, 0)?.text).toBe('2026-09-09');
    });

    it('cycles a weekday list backward', () => {
      const store = new Store();
      store.setCell(1, 0, { text: 'Mon' });
      fill(store, { r1: 1, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 1, c2: 0 });
      expect(store.getCell(0, 0)?.text).toBe('Sun');
    });

    it('Ctrl-drag upward on a lone number decrements', () => {
      const store = new Store();
      store.setCell(1, 0, { text: '5' });
      fill(store, { r1: 1, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 1, c2: 0 }, true);
      expect(store.getCell(0, 0)?.text).toBe('4');
    });

    it('continues a horizontal series to the left', () => {
      const store = new Store();
      store.setCell(0, 2, { text: '10' });
      store.setCell(0, 3, { text: '20' });
      fill(store, { r1: 0, c1: 2, r2: 0, c2: 3 }, { r1: 0, c1: 0, r2: 0, c2: 3 });
      expect(store.getCell(0, 1)?.text).toBe('0');
      expect(store.getCell(0, 0)?.text).toBe('-10');
    });
  });

  describe('copy fallback details', () => {
    it('cycles multi-cell sources starting at source[0] (Excel block copy)', () => {
      const store = new Store();
      store.setCell(0, 0, { text: 'A' });
      store.setCell(1, 0, { text: 'B' });
      fill(store, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
      expect(column(store, 0, 4)).toEqual(['A', 'B', 'A', 'B', 'A']);
    });

    it('cycles formulas shifted by their geometric displacement', () => {
      const store = new Store();
      store.setCell(0, 0, { text: '1', formula: '=B1+C1' });
      store.setCell(1, 0, { text: '2', formula: '=B2+C2' });
      fill(store, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 });
      expect(store.getCell(2, 0)?.formula).toBe('=B3+C3');
      expect(store.getCell(3, 0)?.formula).toBe('=B4+C4');
    });
  });

  describe('cell attributes', () => {
    it('keeps styleId and type on series fills', () => {
      const store = new Store();
      store.setCell(0, 0, { text: 'Mon', styleId: 's1', type: 'text' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
      expect(store.getCell(1, 0)?.styleId).toBe('s1');
      expect(store.getCell(1, 0)?.type).toBe('text');
      expect(store.getCell(2, 0)?.styleId).toBe('s1');
    });

    it('keeps styleId and type on copy fills', () => {
      const store = new Store();
      store.setCell(0, 0, { text: '5', value: 5, styleId: 's2', type: 'number' });
      fill(store, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 1, c2: 0 });
      expect(store.getCell(1, 0)).toMatchObject({ text: '5', value: 5, styleId: 's2', type: 'number' });
    });

    it('stores numeric values on numeric series fills', () => {
      const store = new Store();
      store.setCell(0, 0, { text: '1' });
      store.setCell(1, 0, { text: '3' });
      fill(store, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
      expect(store.getCell(2, 0)?.value).toBe(5);
    });
  });

  it('undo restores the whole filled area in one step', () => {
    const store = new Store();
    store.setCell(1, 0, { text: '1' });
    store.setCell(2, 0, { text: '3' });
    const cmd = new FillRangeCommand({ source: { r1: 1, c1: 0, r2: 2, c2: 0 }, target: { r1: 0, c1: 0, r2: 4, c2: 0 } });
    cmd.execute(store);
    expect(store.getCell(0, 0)?.text).toBe('-1');

    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)).toBeUndefined();
    expect(store.getCell(3, 0)).toBeUndefined();
    expect(column(store, 1, 2)).toEqual(['1', '3']);
  });
});
