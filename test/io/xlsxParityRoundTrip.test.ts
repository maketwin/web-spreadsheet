import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';

// Export and import of the sheet features were written against the same
// mapping tables but on separate sides; this pins that a workbook survives
// the round trip.
describe('xlsx round trip of sheet features', () => {
  function workbook(): Store {
    const store = new Store();
    store.setCell(0, 0, { text: '名称', value: '名称', styleId: 'head' });
    store.setCell(0, 1, { text: '数量', value: '数量', styleId: 'head' });
    store.setCell(1, 0, { text: '苹果', value: '苹果', styleId: 'boxed' });
    store.setCell(1, 1, { text: '12', value: 12, styleId: 'boxed' });
    store.setCell(2, 0, { text: '梨', value: '梨' });
    store.setCell(2, 1, { text: '30', value: 30 });
    store.setStyle('head', { bold: true, bgcolor: '#D9EAD3', border: { bottom: 'solid' } });
    store.setStyle('boxed', { border: { top: 'thick', left: 'dashed', right: 'dotted', bottom: 'solid' } });
    store.setFreeze({ rows: 1, cols: 1 });
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 2, c2: 1 }, criteria: {} });
    store.setConditionalRule('1,1:2,1', [
      { type: 'cellValue', operator: 'gt', value: '20', style: { bold: true, color: '#FF0000' } },
      { type: 'formula', formula: '=B2>$A$3', style: { bgcolor: '#FFF2CC' } },
      // The text needs attribute escaping (`&`/`<`), pinning the import's decoding.
      { type: 'cellValue', operator: 'contains', value: 'a&b<c', style: { italic: true } },
    ]);
    store.setValidationRule('1,1:2,1', { type: 'integer', min: 0, max: 100 });
    store.setValidationRule('1,0:2,0', { type: 'list', values: ['苹果', '梨', '桃"子'] });
    store.setValidationRule('2,1:2,1', { type: 'custom', formula: '=B3<$B$1' });
    return store;
  }

  it('keeps borders, freeze, conditional formats, validations and the autofilter', () => {
    const source = workbook();
    const imported = importXlsx(exportXlsxBuffer(source));
    const sheet = imported.sheets[0]!.data;
    const restored = Store.deserialize(imported);

    expect(restored.getFreeze()).toEqual({ rows: 1, cols: 1 });
    expect(restored.getAutoFilter()).toEqual({ range: { r1: 0, c1: 0, r2: 2, c2: 1 }, criteria: {} });

    const cellAt = (r: number, c: number) => sheet.cells.find(([key]) => key === `${r},${c}`)?.[1];
    const styleOf = (r: number, c: number) => {
      const id = cellAt(r, c)?.styleId;
      return id === undefined ? undefined : sheet.styles.find(([styleId]) => styleId === id)?.[1];
    };
    expect(styleOf(0, 0)?.bold).toBe(true);
    expect(styleOf(0, 0)?.bgcolor?.toUpperCase()).toBe('#D9EAD3');
    expect(styleOf(0, 0)?.border).toEqual({ bottom: 'solid' });
    expect(styleOf(1, 0)?.border).toEqual({ top: 'thick', left: 'dashed', right: 'dotted', bottom: 'solid' });
    expect(cellAt(1, 1)?.value).toBe(12);
    expect(cellAt(1, 0)?.value).toBe('苹果');

    const rules = restored.getConditionalRules();
    expect(rules.map(([range]) => range)).toEqual(['1,1:2,1']);
    const [, list] = rules[0]!;
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ type: 'cellValue', operator: 'gt' });
    expect(Number((list[0] as { value: string | number }).value)).toBe(20);
    expect((list[0] as { style: { bold?: boolean } }).style.bold).toBe(true);
    expect(list[1]).toMatchObject({ type: 'formula', formula: '=B2>$A$3' });
    expect(list[2]).toMatchObject({ type: 'cellValue', operator: 'contains', value: 'a&b<c' });
    expect((list[2] as { style: { italic?: boolean } }).style.italic).toBe(true);

    const validations = restored.getValidationRules();
    const ruleAt = (range: string) => validations.find(([key]) => key === range)?.[1];
    expect(ruleAt('1,1:2,1')).toMatchObject({ type: 'integer', min: 0, max: 100 });
    expect(ruleAt('1,0:2,0')).toEqual({ type: 'list', values: ['苹果', '梨', '桃"子'] });
    expect(ruleAt('2,1:2,1')).toEqual({ type: 'custom', formula: '=B3<$B$1' });
  });

  it('leaves a workbook without any of them untouched', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'plain', value: 'plain' });
    const sheet = importXlsx(exportXlsxBuffer(store)).sheets[0]!.data;
    expect(sheet.freeze).toBeUndefined();
    expect(sheet.autoFilter).toBeUndefined();
    expect(sheet.conditionalRules).toEqual([]);
    expect(sheet.validationRules).toEqual([]);
    expect(sheet.cells[0]![1].value).toBe('plain');
  });
});
