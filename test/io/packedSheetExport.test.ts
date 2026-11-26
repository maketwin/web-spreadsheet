import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';
import * as packing from '../../src/io/sheetPackingExport';
import { Store } from '../../src/store/Store';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';
import { SetCellCommentCommand } from '../../src/commands/impl/SetCellComment';

/**
 * The packed export path: when a sheet's stored cells leave more than
 * MAX_DENSE_EXPORT_EMPTY_CELLS empty addresses inside their used rectangle,
 * SheetJS would walk them all (hours on the far corner), so the exporter
 * writes the cells packed into a dense block and restores their real
 * coordinates in the sheet part afterwards. Ordinary workbooks never take
 * the path; packed output must be indistinguishable from plain output.
 */

/** Unzip an exported package into text parts. */
function parts(buf: ArrayBuffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, data] of Object.entries(unzipSync(new Uint8Array(buf)))) out[path] = strFromU8(data);
  return out;
}

describe('packing decision', () => {
  it('keeps the plain path while empty addresses are within the budget', () => {
    const restoreSpy = vi.spyOn(packing, 'restorePackedSheets');
    // 10×10 dense block: zero empty addresses.
    const dense = new Store();
    dense.batch(() => {
      for (let r = 0; r < 10; r += 1) for (let c = 0; c < 10; c += 1) dense.setCell(r, c, { text: 'x', value: 'x' });
    });
    exportXlsxBuffer(dense);
    expect(restoreSpy).not.toHaveBeenCalled();

    // One cell in a 1000×1000 rectangle: 999,999 empty addresses — exactly
    // one under the budget, so the plain path stays.
    const atLimit = new Store();
    atLimit.setCell(999, 999, { text: 'edge', value: 'edge' });
    exportXlsxBuffer(atLimit);
    expect(restoreSpy).not.toHaveBeenCalled();
    restoreSpy.mockRestore();
  });

  it('packs once the empty addresses exceed the budget, and both cells read back', () => {
    const restoreSpy = vi.spyOn(packing, 'restorePackedSheets');
    const store = new Store();
    store.setCell(0, 0, { text: 'top', value: 'top' });
    store.setCell(TOTAL_ROWS - 1, 0, { text: 'bottom', value: 'bottom' });

    const buf = exportXlsxBuffer(store);
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    const [, plans] = restoreSpy.mock.calls[0]!;
    const plan = plans.get(0)!;
    // Two cells packed into a ceil(sqrt(2))=2-wide block, k → real key ascending.
    expect(plan.width).toBe(2);
    expect(plan.realKeys).toEqual([0, (TOTAL_ROWS - 1) * TOTAL_COLS + 0]);
    restoreSpy.mockRestore();

    const restored = Store.deserialize(importXlsx(buf));
    expect(restored.getCellCount()).toBe(2);
    expect(restored.getCell(0, 0)?.value).toBe('top');
    expect(restored.getCell(TOTAL_ROWS - 1, 0)?.value).toBe('bottom');
    expect(restored.getUsedBounds()).toEqual({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: 0 });
  });
});

/**
 * A deliberately rich sheet: every value type, every export feature. `A` is
 * exported plainly; `B` is the same sheet plus one trigger cell at XFD1048576
 * that forces the packed path. Apart from the dimension (which legitimately
 * grows) and the trigger's own row, the packages must be byte-identical, and
 * their imports equal once the trigger is removed.
 */
function richStore(withTrigger: boolean): Store {
  const store = new Store();
  store.setStyle('s-font', { bold: true, italic: true, fontSize: 14, color: '#FF0000', fontFamily: 'Arial' });
  store.setStyle('s-fill', { bgcolor: '#FFFF00' });
  store.setStyle('s-border', { border: { top: 'solid', left: 'dashed', right: 'dotted', bottom: 'thick' } });
  store.setStyle('s-num', { numberFormat: 'number' });
  store.setStyle('s-align', { align: 'center', valign: 'middle', wrap: true });

  store.setCell(0, 0, { text: '产品', value: '产品', styleId: 's-font' });
  store.setCell(0, 1, { text: '数量', value: '数量', styleId: 's-fill' });
  store.setCell(0, 2, { text: '价格', value: '价格', styleId: 's-border' });
  store.setCell(0, 3, { text: '金额', value: '金额', styleId: 's-align' });

  store.setCell(1, 0, { text: '苹果', value: '苹果' });
  store.setCell(1, 1, { text: '42', value: 42 });
  store.setCell(1, 2, { text: '3.5', value: 3.5, styleId: 's-num' });
  store.setCell(1, 3, { formula: '=B2*C2', text: '147', value: 147 });

  store.setCell(2, 0, { text: ' "引号" 与 空格 & 符号 ', value: ' "引号" 与 空格 & 符号 ' });
  store.setCell(2, 1, { text: 'TRUE', value: true });
  store.setCell(2, 2, { text: '#DIV/0!', value: '#DIV/0!' });
  store.setCell(2, 3, { formula: '=IF(TRUE,"是","否")', text: '是', value: '是' });

  store.setCell(3, 0, { text: '香蕉', value: '香蕉' });
  store.setCell(3, 1, { text: '7', value: 7 });
  store.setCell(3, 2, { text: '2', value: 2 });
  store.setCell(3, 3, { formula: '=AND(1<2,2<3)', text: 'TRUE', value: true });

  store.setCell(4, 0, { text: '富文本你 & 我', value: '富文本你 & 我', richText: [{ text: '富', style: { bold: true, color: '#0066CC' } }, { text: '文本你 & 我' }] });
  store.setCell(4, 3, { formula: '=SQRT(4)', text: '' });

  store.setCell(5, 0, { text: '外部链接', value: '外部链接', hyperlink: { target: 'https://example.com/?a=1&b=2', tooltip: '示例站点' } });
  store.setCell(5, 1, { text: '内部链接', value: '内部链接', hyperlink: { target: '#Sheet1!B2' } });

  store.addMerge('A1:D1');
  store.setConditionalRule('2,0:3,1', [{ type: 'cellValue', operator: 'gt', value: 5, style: { bgcolor: '#FF8800' } }]);
  store.setConditionalRule('4,0:4,3', [{ type: 'formula', formula: '=LEN(A5)>2', style: { italic: true } }]);
  store.setValidationRule('2,2:2,2', { type: 'list', values: ['是', '否'] });
  store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 5, c2: 3 }, criteria: {} });
  store.setFreeze({ rows: 1, cols: 1 });
  store.addChart({
    id: 'chart-1', type: 'bar', range: '0,0:3,1', title: '对比图表',
    anchor: { from: { r: 7, c: 0, offX: 0, offY: 0 }, to: { r: 15, c: 5, offX: 0, offY: 0 } },
  });
  const comment = new SetCellCommentCommand({ r: 1, c: 3, comment: { text: '核对一下这个数', author: '审计' } });
  comment.execute.bind(comment)(store);

  if (withTrigger) store.setCell(TOTAL_ROWS - 1, TOTAL_COLS - 1, { text: '触发', value: '触发' });
  return store;
}

const TRIGGER_KEY = `${TOTAL_ROWS - 1},${TOTAL_COLS - 1}`;
const TRIGGER_ROW_XML = new RegExp(`<row r="${TOTAL_ROWS}">[\\s\\S]*?</row>`);

describe('packed path differential', () => {
  const plain = parts(exportXlsxBuffer(richStore(false)));
  const packed = parts(exportXlsxBuffer(richStore(true)));

  it('produces the same part set', () => {
    expect(Object.keys(packed).sort()).toEqual(Object.keys(plain).sort());
  });

  it('sheet XML is identical apart from extent metadata and the trigger row', () => {
    // <dimension> and <ignoredErrors> both derive from the sheet extent,
    // which legitimately grows to cover the trigger cell; everything else —
    // cells, rows, merges, hyperlinks, cfRules, validations, autofilter,
    // drawing/legacyDrawing refs — must be byte-identical.
    const stripExtent = (xml: string): string => xml
      .replace(/<dimension ref="[^"]*"\s*\/>/, '')
      .replace(/<ignoredErrors>[\s\S]*?<\/ignoredErrors>/, '');
    expect(stripExtent(packed['xl/worksheets/sheet1.xml']!).replace(TRIGGER_ROW_XML, ''))
      .toBe(stripExtent(plain['xl/worksheets/sheet1.xml']!));
  });

  it('rels and content types are identical', () => {
    for (const [path, text] of Object.entries(plain)) {
      if (path === 'xl/worksheets/sheet1.xml') continue;
      expect(packed[path], path).toBe(text);
    }
  });

  it('imports equally once the trigger cell is removed', () => {
    const importedPlain = importXlsx(exportXlsxBuffer(richStore(false)));
    const importedPacked = importXlsx(exportXlsxBuffer(richStore(true)));
    const withoutTrigger = {
      ...importedPacked,
      sheets: importedPacked.sheets.map((sheet) => ({
        ...sheet,
        data: { ...sheet.data, cells: sheet.data.cells.filter(([key]) => key !== TRIGGER_KEY) },
      })),
    };
    expect(withoutTrigger).toEqual(importedPlain);
  });

  it('the trigger cell itself reads back at XFD1048576', () => {
    const restored = Store.deserialize(importXlsx(exportXlsxBuffer(richStore(true))));
    expect(restored.getCellCount()).toBe(21); // 20 rich cells + the trigger
    expect(restored.getCell(TOTAL_ROWS - 1, TOTAL_COLS - 1)?.value).toBe('触发');
    expect(restored.getCell(0, 0)?.styleId).toBeDefined();
    expect(restored.getCell(2, 1)?.value).toBe(true);
    expect(restored.getCell(1, 3)?.formula).toBe('=B2*C2');
  });
});
