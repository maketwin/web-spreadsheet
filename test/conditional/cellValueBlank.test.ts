import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { ConditionalService } from '../../src/conditional/ConditionalService';

describe('cellValue rules on blank cells', () => {
  it('blank cells match no comparison rule (Excel)', () => {
    const store = new Store();
    // A cell that exists but is empty, next to a rule that 0 would satisfy.
    store.setCell(0, 0, { text: '' });
    store.setConditionalRule('0,0:0,0', [{ type: 'cellValue', operator: 'lt', value: 5, style: { bold: true } }]);
    store.setConditionalRule('1,0:1,0', [{ type: 'cellValue', operator: 'eq', value: 0, style: { bold: true } }]);

    expect(new ConditionalService().computeOverlay(store, 0, 0).style).toBeUndefined();
    expect(new ConditionalService().computeOverlay(store, 1, 0).style).toBeUndefined();
  });

  it('a real value still matches the comparison', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '3', value: 3 });
    store.setConditionalRule('0,0:0,0', [{ type: 'cellValue', operator: 'lt', value: 5, style: { bold: true } }]);

    expect(new ConditionalService().computeOverlay(store, 0, 0).style?.bold).toBe(true);
  });
});
