import { describe, expect, it } from 'vitest';
import { FillRangeCommand, shiftFormula } from '../../src/commands/impl/FillRange';
import { Store } from '../../src/store/Store';

describe('FillRangeCommand', () => {
  it('copies plain text', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'hello' });
    const cmd = new FillRangeCommand({
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 2, c2: 0 },
    });

    cmd.execute(store);

    expect(store.getCell(0, 0)?.text).toBe('hello');
    expect(store.getCell(1, 0)?.text).toBe('hello');
    expect(store.getCell(2, 0)?.text).toBe('hello');
  });

  it('continues an arithmetic number series by default (Excel)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '1' });
    store.setCell(1, 0, { text: '2' });
    const cmd = new FillRangeCommand({
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

  it('shifts formula references when copying', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '3', formula: '=A1+B1' });
    const cmd = new FillRangeCommand({
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

  it('keeps an absolute column fixed but shifts the row ($A1)', () => {
    expect(shiftFormula('=$A1+B2', 1, 1)).toBe('=$A2+C3');
  });

  it('keeps an absolute row fixed but shifts the column (A$1)', () => {
    expect(shiftFormula('=A$1+B2', 1, 1)).toBe('=B$1+C3');
  });

  it('does not touch sheet names or function names', () => {
    expect(shiftFormula('=SUM(Sheet2!A1:B3)+LOG10(100)', 1, 0)).toBe('=SUM(Sheet2!A2:B4)+LOG10(100)');
  });
});
