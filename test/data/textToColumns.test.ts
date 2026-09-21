import { describe, expect, it } from 'vitest';
import { splitCellText } from '../../src/data/textToColumns';
import { TextToColumnsCommand } from '../../src/commands/impl/TextToColumns';
import { Store } from '../../src/store/Store';

describe('splitCellText', () => {
  it('splits on comma and collapses consecutive when asked', () => {
    expect(splitCellText('a,b,c', { delimiter: 'comma' })).toEqual(['a', 'b', 'c']);
    expect(splitCellText('a,,b', { delimiter: 'comma', consecutiveAsOne: true })).toEqual(['a', 'b']);
    expect(splitCellText('a,,b', { delimiter: 'comma' })).toEqual(['a', '', 'b']);
    expect(splitCellText('a|b', { delimiter: 'custom', custom: '|' })).toEqual(['a', 'b']);
  });
});

describe('TextToColumnsCommand', () => {
  it('writes split values to the right and undoes', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'a,b,c' });
    store.setCell(1, 0, { text: 'd,e' });
    const cmd = new TextToColumnsCommand({
      r1: 0, c1: 0, r2: 1, options: { delimiter: 'comma' },
    });
    cmd.execute(store);
    expect(store.getCell(0, 0)?.text).toBe('a');
    expect(store.getCell(0, 1)?.text).toBe('b');
    expect(store.getCell(0, 2)?.text).toBe('c');
    expect(store.getCell(1, 0)?.text).toBe('d');
    expect(store.getCell(1, 1)?.text).toBe('e');
    expect(store.getCell(1, 2)?.text).toBe('');
    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)?.text).toBe('a,b,c');
    expect(store.getCell(0, 1)).toBeUndefined();
  });
});
