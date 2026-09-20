import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { ConditionalService } from '../../src/conditional/ConditionalService';

describe('conditional cellValue rules', () => {
  it('applies style when value is greater than threshold', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setConditionalRule('0,0:0,0', [{
      type: 'cellValue',
      operator: 'gt',
      value: 5,
      style: { bgcolor: '#FFC7CE' },
    }]);
    const overlay = new ConditionalService().computeOverlay(store, 0, 0);
    expect(overlay.style?.bgcolor).toBe('#FFC7CE');
  });

  it('matches contains for text', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello', value: 'Hello' });
    store.setConditionalRule('0,0:0,0', [{
      type: 'cellValue',
      operator: 'contains',
      value: 'ell',
      style: { bold: true },
    }]);
    const overlay = new ConditionalService().computeOverlay(store, 0, 0);
    expect(overlay.style?.bold).toBe(true);
  });
});
