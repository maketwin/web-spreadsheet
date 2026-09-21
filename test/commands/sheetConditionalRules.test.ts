import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetSheetConditionalRulesCommand } from '../../src/commands/impl/SetConditionalFormat';
import type { ConditionalRule } from '../../src/conditional/ConditionalRule';

const bar: ConditionalRule = { type: 'dataBar', min: 0, max: 100, color: '#4A90D9' };
const scale: ConditionalRule = { type: 'colorScale', min: 0, max: 100, minColor: '#FFF', maxColor: '#000' };

describe('SetSheetConditionalRulesCommand (管理规则)', () => {
  it('replaces the whole sheet rule set in one undoable step', () => {
    const store = new Store();
    store.setConditionalRule('0,0:3,0', [bar]);
    store.setConditionalRule('0,1:3,1', [scale]);
    const mgr = new CommandManager(store);

    // Manager op: delete the colorScale range, disable the dataBar rule.
    mgr.execute(new SetSheetConditionalRulesCommand({ entries: [['0,0:3,0', [{ ...bar, disabled: true }]]] }));

    expect(store.getConditionalRules()).toHaveLength(1);
    const [key, rules] = store.getConditionalRules()[0]!;
    expect(key).toBe('0,0:3,0');
    expect(rules[0]?.disabled).toBe(true);

    mgr.undo();
    expect(store.getConditionalRules()).toHaveLength(2);
    const restored = store.getConditionalRules().find(([k]) => k === '0,1:3,1');
    expect(restored?.[1][0]?.type).toBe('colorScale');

    mgr.redo();
    expect(store.getConditionalRules()).toHaveLength(1);
  });

  it('reordering rules within a range round-trips through undo', () => {
    const store = new Store();
    store.setConditionalRule('0,0:3,0', [bar, scale]);
    const mgr = new CommandManager(store);
    mgr.execute(new SetSheetConditionalRulesCommand({ entries: [['0,0:3,0', [scale, bar]]] }));
    expect(store.getConditionalRules()[0]?.[1][0]?.type).toBe('colorScale');
    mgr.undo();
    expect(store.getConditionalRules()[0]?.[1][0]?.type).toBe('dataBar');
  });
});
