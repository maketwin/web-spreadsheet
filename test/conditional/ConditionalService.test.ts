import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { ConditionalService } from '../../src/conditional/ConditionalService';
import type { ConditionalRule } from '../../src/conditional/ConditionalRule';
import { SetConditionalFormatCommand } from '../../src/commands/impl/SetConditionalFormat';

describe('ConditionalService', () => {
  const service = new ConditionalService();

  it('applies data bar overlay for numeric cell', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '50', value: 50 });
    store.setConditionalRule('0,0:0,0', [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }]);

    const overlay = service.computeOverlay(store, 0, 0);

    expect(overlay.dataBar).toEqual({ ratio: 0.5, color: '#4A90D9' });
  });

  it('applies color scale overlay with interpolated bgcolor', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '50', value: 50 });
    store.setConditionalRule('0,0:0,0', [{ type: 'colorScale', min: 0, max: 100, minColor: '#FFFFFF', maxColor: '#000000' }]);

    const overlay = service.computeOverlay(store, 0, 0);

    expect(overlay.style?.bgcolor).toBe('#808080');
  });

  it('applies formula condition when formula evaluates to true', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(0, 1, { text: '5', value: 5 });
    store.setConditionalRule('0,0:0,1', [{ type: 'formula', formula: '=A1>5', style: { bgcolor: '#FFFF00' } }]);

    const overlay = service.computeOverlay(store, 0, 0);

    expect(overlay.style?.bgcolor).toBe('#FFFF00');
  });

  it('formula condition does not apply when formula is false', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '3', value: 3 });
    store.setCell(0, 1, { text: '5', value: 5 });
    store.setConditionalRule('0,0:0,1', [{ type: 'formula', formula: '=A1>5', style: { bgcolor: '#FFFF00' } }]);

    const overlay = service.computeOverlay(store, 0, 0);

    expect(overlay.style).toBeUndefined();
  });

  it('later rules override earlier ones (priority)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '50', value: 50 });
    const rules: ConditionalRule[] = [
      { type: 'colorScale', min: 0, max: 100, minColor: '#FFFFFF', maxColor: '#000000' },
      { type: 'formula', formula: '=A1>0', style: { bgcolor: '#FF0000' } },
    ];
    store.setConditionalRule('0,0:0,0', rules);

    const overlay = service.computeOverlay(store, 0, 0);

    // Formula rule wins — bgcolor overridden to #FF0000
    expect(overlay.style?.bgcolor).toBe('#FF0000');
  });
});

describe('SetConditionalFormatCommand', () => {
  it('stores and undoes conditional rule', () => {
    const store = new Store();
    const cmd = new SetConditionalFormatCommand({
      r1: 0, c1: 0, r2: 0, c2: 0,
      rules: [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }],
    });

    cmd.execute(store);
    expect(store.getConditionalRules()).toHaveLength(1);

    const undo = cmd.getUndo();
    undo.execute(store);
    expect(store.getConditionalRules()).toHaveLength(0);
  });
});
