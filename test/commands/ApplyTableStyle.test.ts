import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { ApplyTableStyleCommand } from '../../src/commands/impl/ApplyTableStyle';

function storeWithHeaderRow(): Store {
  const store = new Store();
  const header = { text: '名称', value: '名称' };
  const v1 = { text: '10', value: 10 };
  const v2 = { text: '20', value: 20 };
  store.setCell(0, 0, header);
  store.setCell(1, 0, v1);
  store.setCell(2, 0, v2);
  return store;
}

describe('ApplyTableStyle command', () => {
  it('applies dark header + banded body over A1:A3', () => {
    const store = storeWithHeaderRow();
    const cmd = new ApplyTableStyleCommand({ r1: 0, c1: 0, r2: 2, c2: 0, preset: 'blue' });
    cmd.execute.bind(cmd)(store);
    const header = store.getCell(0, 0);
    const body1 = store.getCell(1, 0);
    const body2 = store.getCell(2, 0);
    const headerStyle = header?.styleId !== undefined ? store.getStyle(header.styleId) : undefined;
    const body1Style = body1?.styleId !== undefined ? store.getStyle(body1.styleId) : undefined;
    const body2Style = body2?.styleId !== undefined ? store.getStyle(body2.styleId) : undefined;
    expect(headerStyle?.bgcolor).toBe('#2F5597');
    expect(headerStyle?.color).toBe('#FFFFFF');
    expect(headerStyle?.bold).toBe(true);
    expect(body1Style?.bgcolor).toBeUndefined();
    expect(body2Style?.bgcolor).toBe('#D9E7F5');
  });

  it('undo restores the original styles', () => {
    const store = storeWithHeaderRow();
    const before0 = store.getCell(0, 0);
    const before1 = store.getCell(1, 0);
    const cmd = new ApplyTableStyleCommand({ r1: 0, c1: 0, r2: 2, c2: 0, preset: 'blue' });
    cmd.execute.bind(cmd)(store);
    const undo = cmd.getUndo();
    undo.execute.bind(undo)(store);
    expect(store.getCell(0, 0)?.styleId).toBe(before0?.styleId);
    expect(store.getCell(1, 0)?.styleId).toBe(before1?.styleId);
    const headerStyle = store.getCell(0, 0)?.styleId !== undefined ? store.getStyle(store.getCell(0, 0)!.styleId!) : undefined;
    expect(headerStyle?.bgcolor).toBeUndefined();
  });
});
