import { describe, expect, it } from 'vitest';
import { FillRangeCommand } from '../../src/commands/impl/FillRange';
import { Store } from '../../src/store/Store';

/**
 * GUI regression (2026-09-28): dragging the fill handle over a target that
 * already holds a formula produced "=SUM(M18:M20)=AVERAGE(M18:M20)" — the new
 * shifted formula concatenated with the target's old one — while the painted
 * value still looked right (the SUM half won), hiding the corruption.
 */
describe('FillRangeCommand over existing formulas', () => {
  it('replaces (not concatenates) a target cell that already has a formula', () => {
    const store = new Store();
    store.setCell(16, 12, { text: '10' }); // M17
    store.setCell(17, 12, { text: '20' }); // M18
    store.setCell(18, 12, { text: '30' }); // M19
    store.setCell(16, 13, { text: '60', formula: '=SUM(M17:M19)' }); // N17 source
    store.setCell(17, 13, { text: '20', formula: '=AVERAGE(M17:M19)' }); // N18 target

    const cmd = new FillRangeCommand({
      source: { r1: 16, c1: 13, r2: 16, c2: 13 },
      target: { r1: 16, c1: 13, r2: 17, c2: 13 },
    });
    cmd.execute(store);

    expect(store.getCell(17, 13)?.formula).toBe('=SUM(M18:M20)');
  });

  it('replaces a multi-column fill into formula-bearing targets', () => {
    const store = new Store();
    store.setCell(16, 12, { text: '10' }); // M17
    store.setCell(16, 13, { text: '60', formula: '=SUM(M17:M19)' }); // N17 source
    store.setCell(17, 13, { text: '20', formula: '=AVERAGE(M17:M19)' }); // N18 target
    store.setCell(18, 13, { text: '50', formula: '=SUMPRODUCT((M17:M19>15)*M17:M19)' }); // N19 target

    const cmd = new FillRangeCommand({
      source: { r1: 16, c1: 12, r2: 16, c2: 13 },
      target: { r1: 16, c1: 12, r2: 18, c2: 13 },
    });
    cmd.execute(store);

    expect(store.getCell(17, 13)?.formula).toBe('=SUM(M18:M20)');
    expect(store.getCell(18, 13)?.formula).toBe('=SUM(M19:M21)');
  });
});
