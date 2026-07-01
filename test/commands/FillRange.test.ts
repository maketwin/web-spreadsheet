import { describe, expect, it } from 'vitest';
import { FillRangeCommand, shiftFormula } from '../../src/commands/impl/FillRange';
import { Store } from '../../src/store/Store';

describe('FillRangeCommand', () => {
  it('copies text in copy mode', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'hello' });
    const cmd = new FillRangeCommand({
      mode: 'copy',
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 2, c2: 0 },
    });

    cmd.execute(store);

    expect(store.getCell(0, 0)?.text).toBe('hello');
    expect(store.getCell(1, 0)?.text).toBe('hello');
    expect(store.getCell(2, 0)?.text).toBe('hello');
  });

  it('increments numbers in series mode', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    store.setCell(1, 0, { text: '2' });
    const cmd = new FillRangeCommand({
      mode: 'series',
      source: { r1: 0, c1: 0, r2: 1, c2: 0 },
      target: { r1: 0, c1: 0, r2: 4, c2: 0 },
    });

    cmd.execute(store);

    expect(store.getCell(0, 0)?.text).toBe('1');
    expect(store.getCell(1, 0)?.text).toBe('2');
    expect(store.getCell(2, 0)?.text).toBe('3');
    expect(store.getCell(3, 0)?.text).toBe('4');
    expect(store.getCell(4, 0)?.text).toBe('5');
  });

  it('shifts formula references in copy mode', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '3', formula: '=A1+B1' });
    const cmd = new FillRangeCommand({
      mode: 'copy',
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 2, c2: 0 },
    });

    cmd.execute(store);

    expect(store.getCell(0, 0)?.formula).toBe('=A1+B1');
    expect(store.getCell(1, 0)?.formula).toBe('=A2+B2');
    expect(store.getCell(2, 0)?.formula).toBe('=A3+B3');
  });

  it('handles empty target cells gracefully', () => {
    const store = new Store();
    const cmd = new FillRangeCommand({
      mode: 'copy',
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 2, c2: 0 },
    });

    expect(() => cmd.execute(store)).not.toThrow();
    expect(store.getCell(1, 0)).toBeUndefined();
    expect(store.getCell(2, 0)).toBeUndefined();
  });
});

describe('shiftFormula', () => {
  it('shifts cell references by delta', () => {
    expect(shiftFormula('=A1+B2', 1, 0)).toBe('=A2+B3');
    expect(shiftFormula('=A1+B2', 0, 1)).toBe('=B1+C2');
  });

  it('does not shift $-prefixed references', () => {
    expect(shiftFormula('=$A$1+B2', 1, 0)).toBe('=$A$1+B3');
  });
});
