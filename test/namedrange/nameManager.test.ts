import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { NamedRangeService } from '../../src/namedrange/NamedRangeService';
import { parseNameBoxInput } from '../../src/selection/nameBox';

describe('name manager flows', () => {
  it('add / edit / delete a name via A1 input (dialog path)', () => {
    const store = new Store();
    const svc = new NamedRangeService();

    // 新建: parse A1 → internal range → add
    const target = parseNameBoxInput(store, 'B2:D5');
    expect(target).not.toBeNull();
    const { r1, c1, r2, c2 } = target!.range;
    svc.add(store, '销售数据', `${r1},${c1}:${r2},${c2}`, store.getActiveSheetId());
    expect(svc.resolveToA1(store, '销售数据')).toBe('B2:D5');

    // 编辑: replace the reference
    const next = parseNameBoxInput(store, 'A1:A9');
    svc.add(store, '销售数据', `${next!.range.r1},${next!.range.c1}:${next!.range.r2},${next!.range.c2}`, store.getActiveSheetId());
    expect(svc.resolveToA1(store, '销售数据')).toBe('A1:A9');

    // 删除
    svc.remove(store, '销售数据');
    expect(svc.lookup(store, '销售数据')).toBeUndefined();
  });

  it('defined names resolve in formulas after manager edits', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2', value: 2 });
    store.setCell(1, 0, { text: '3', value: 3 });
    const svc = new NamedRangeService();
    svc.add(store, 'vals', '0,0:1,0', store.getActiveSheetId());
    expect(svc.resolveFormula(store, '=SUM(vals)')).toBe('=SUM(0,0:1,0)');
  });
  it('cross-sheet refersTo still registers the name on the active sheet', () => {
    const store = new Store();
    store.addSheet('Sheet2');
    store.activateSheet('sheet-1'); // addSheet 会激活新表，切回用户视角的活动表
    const svc = new NamedRangeService();
    const target = parseNameBoxInput(store, 'Sheet2!A1:B2');
    expect(target).not.toBeNull();
    const { r1, c1, r2, c2 } = target!.range;
    // Dialog path: always register on the active sheet so list/remove/resolve see it.
    const owner = store.getActiveSheetId();
    store.setNamedRange('ext', { range: `${r1},${c1}:${r2},${c2}`, sheetId: target!.sheetId ?? owner }, owner);
    const def = svc.lookup(store, 'ext');
    expect(def).toBeDefined();
    expect(def!.sheetId).not.toBe(owner); // 被引用表保留在 def 上
    expect(svc.resolveToA1(store, 'ext')).toBe('A1:B2');
  });
});
