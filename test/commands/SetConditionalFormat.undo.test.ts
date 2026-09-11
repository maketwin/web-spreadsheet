import { describe, expect, it } from 'vitest';
import { SetConditionalFormatCommand } from '../../src/commands/impl/SetConditionalFormat';
import type { ConditionalRule } from '../../src/conditional/ConditionalRule';
import { Store } from '../../src/store/Store';

const rule: ConditionalRule = { type: 'dataBar', min: 0, max: 100, color: '#638ec6' };

describe('SetConditionalFormatCommand undo', () => {
  it('undo removes a newly added rule', () => {
    const store = new Store();
    const cmd = new SetConditionalFormatCommand({ r1: 0, c1: 0, r2: 9, c2: 0, rules: [rule] });

    cmd.execute(store);
    expect(store.getConditionalRules()).toHaveLength(1);

    cmd.getUndo().execute(store);
    expect(store.getConditionalRules()).toHaveLength(0);
  });

  it('undo restores a replaced rule', () => {
    const store = new Store();
    const oldRule: ConditionalRule = { type: 'colorScale', min: 0, max: 10, minColor: '#fff', maxColor: '#000' };
    new SetConditionalFormatCommand({ r1: 0, c1: 0, r2: 9, c2: 0, rules: [oldRule] }).execute(store);

    const cmd = new SetConditionalFormatCommand({ r1: 0, c1: 0, r2: 9, c2: 0, rules: [rule] });
    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getConditionalRules()[0]?.[1]).toEqual([oldRule]);
  });
});
