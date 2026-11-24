import { describe, expect, it } from 'vitest';
import { strFromU8 } from 'fflate';
import * as XLSX from 'xlsx';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { safeUnzip } from '../../src/io/safeUnzip';
import { Store } from '../../src/store/Store';
import { CreateChartCommand } from '../../src/commands/impl/CreateChart';

function zipParts(buf: ArrayBuffer): Record<string, string> {
  const files = safeUnzip(new Uint8Array(buf));
  const parts: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) parts[path] = strFromU8(data);
  return parts;
}

function sheetXml(buf: ArrayBuffer, sheetNo = 1): string {
  const part = zipParts(buf)[`xl/worksheets/sheet${sheetNo}.xml`];
  expect(part).toBeDefined();
  return part!;
}

function stylesXml(buf: ArrayBuffer): string {
  const part = zipParts(buf)['xl/styles.xml'];
  expect(part).toBeDefined();
  return part!;
}

/** Exported zip must still be a workbook SheetJS can open, with values intact. */
function expectReadable(buf: ArrayBuffer, expected: Record<string, string | number>): void {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]!]! as XLSX.WorkSheet;
  for (const [addr, value] of Object.entries(expected)) {
    const cell = ws[addr] as XLSX.CellObject | undefined;
    expect(cell?.v).toBe(value);
  }
}

describe('xlsx export: borders', () => {
  it('writes a deduped borders table and real borderId/applyBorder on cell xfs', () => {
    const store = new Store();
    store.setStyle('s-box', { border: { top: 'solid', bottom: 'solid', left: 'solid', right: 'solid' } });
    store.setCell(0, 0, { text: '框', value: '框', styleId: 's-box' });
    store.setCell(1, 1, { text: '同', value: '同', styleId: 's-box' });

    const buf = exportXlsxBuffer(store);
    const styles = stylesXml(buf);
    expect(styles).toContain('<borders count="2">');
    expect(styles).toContain(
      '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right>'
      + '<top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>',
    );
    expect(styles).toContain('borderId="1"');
    expect(styles).toContain('applyBorder="1"');
    // The styled cell references its xf.
    expect(sheetXml(buf)).toMatch(/<c\b[^>]*\bs="1"/);
    // Same border on both cells → deduped (count stays 2: empty + one entry).
    expect(styles).not.toContain('<borders count="3">');
  });

  it('maps line styles solid/thick/dashed/dotted and drops none sides', () => {
    const store = new Store();
    store.setStyle('s-solid', { border: { top: 'solid' } });
    store.setStyle('s-thick', { border: { bottom: 'thick' } });
    store.setStyle('s-dashed', { border: { left: 'dashed' } });
    store.setStyle('s-dotted', { border: { right: 'dotted' } });
    store.setStyle('s-none', { border: { top: 'none', left: 'solid' } });
    store.setCell(0, 0, { text: 'a', value: 'a', styleId: 's-solid' });
    store.setCell(1, 0, { text: 'b', value: 'b', styleId: 's-thick' });
    store.setCell(2, 0, { text: 'c', value: 'c', styleId: 's-dashed' });
    store.setCell(3, 0, { text: 'd', value: 'd', styleId: 's-dotted' });
    store.setCell(4, 0, { text: 'e', value: 'e', styleId: 's-none' });

    const styles = stylesXml(exportXlsxBuffer(store));
    expect(styles).toContain('<borders count="6">');
    expect(styles).toContain('<top style="thin"><color rgb="FF000000"/></top>');
    expect(styles).toContain('<bottom style="thick"><color rgb="FF000000"/></bottom>');
    expect(styles).toContain('<left style="dashed"><color rgb="FF000000"/></left>');
    expect(styles).toContain('<right style="dotted"><color rgb="FF000000"/></right>');
    // 'none' sides stay empty elements.
    const noneBorder = styles.match(/<border><left style="thin"><color rgb="FF000000"\/><\/left><right\/><top\/><bottom\/><diagonal\/><\/border>/);
    expect(noneBorder).not.toBeNull();
  });

  it('a workbook whose cells have borders still reads back via SheetJS', () => {
    const store = new Store();
    store.setStyle('s-box', { border: { top: 'solid', bottom: 'dashed' } });
    store.setCell(0, 0, { text: '名单', value: '名单' });
    store.setCell(0, 1, { text: '88', value: 88, styleId: 's-box' });
    const buf = exportXlsxBuffer(store);
    expectReadable(buf, { A1: '名单', B1: 88 });
  });
});

describe('xlsx export: freeze panes', () => {
  it('writes a frozen pane into sheetViews (rows+cols)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'x', value: 'x' });
    store.setFreeze({ rows: 1, cols: 1 });
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).toContain(
      '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>',
    );
  });

  it('writes rows-only and cols-only panes', () => {
    const rowsOnly = new Store();
    rowsOnly.setCell(0, 0, { text: 'x', value: 'x' });
    rowsOnly.setFreeze({ rows: 2, cols: 0 });
    expect(sheetXml(exportXlsxBuffer(rowsOnly))).toContain(
      '<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>',
    );

    const colsOnly = new Store();
    colsOnly.setCell(0, 0, { text: 'x', value: 'x' });
    colsOnly.setFreeze({ rows: 0, cols: 2 });
    expect(sheetXml(exportXlsxBuffer(colsOnly))).toContain(
      '<pane xSplit="2" topLeftCell="C1" activePane="topRight" state="frozen"/>',
    );
  });

  it('no freeze → no pane node, and a frozen sheet still reads back', () => {
    const plain = new Store();
    plain.setCell(0, 0, { text: 'x', value: 'x' });
    expect(sheetXml(exportXlsxBuffer(plain))).not.toContain('<pane');

    const frozen = new Store();
    frozen.setCell(0, 0, { text: '表头', value: '表头' });
    frozen.setCell(1, 0, { text: '数据', value: '数据' });
    frozen.setFreeze({ rows: 1, cols: 0 });
    const buf = exportXlsxBuffer(frozen);
    expectReadable(buf, { A1: '表头', A2: '数据' });
  });
});

describe('xlsx export: conditional formatting', () => {
  it('exports a cellIs rule with its dxf style', () => {
    const store = new Store();
    store.setCell(1, 1, { text: '5', value: 5 });
    store.setConditionalRule('1,0:3,1', [
      { type: 'cellValue', operator: 'gt', value: 5, style: { bgcolor: '#FFFF00' } },
    ]);
    const buf = exportXlsxBuffer(store);
    const xml = sheetXml(buf);
    expect(xml).toContain(
      '<conditionalFormatting sqref="A2:B4"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>5</formula></cfRule></conditionalFormatting>',
    );
    const styles = stylesXml(buf);
    expect(styles).toContain('<dxfs count="1"><dxf><fill><patternFill><bgColor rgb="FFFFFF00"/></patternFill></fill></dxf></dxfs>');
  });

  it('maps eq/neq/lt/lte/gte operators and string operands as quoted formulas', () => {
    const store = new Store();
    store.setConditionalRule('0,0:0,0', [{ type: 'cellValue', operator: 'eq', value: 'ok', style: { bold: true } }]);
    store.setConditionalRule('1,0:1,0', [{ type: 'cellValue', operator: 'between', value: 10, value2: 20, style: { italic: true } }]);
    store.setConditionalRule('2,0:2,0', [{ type: 'cellValue', operator: 'lte', value: 3, style: { color: '#FF0000' } }]);
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).toContain('<cfRule type="cellIs" dxfId="0" priority="1" operator="equal"><formula>"ok"</formula></cfRule>');
    expect(xml).toContain('<cfRule type="cellIs" dxfId="1" priority="2" operator="between"><formula>10</formula><formula>20</formula></cfRule>');
    expect(xml).toContain('<cfRule type="cellIs" dxfId="2" priority="3" operator="lessThanOrEqual"><formula>3</formula></cfRule>');
  });

  it('exports contains rules as Excel containsText with a SEARCH formula', () => {
    const store = new Store();
    store.setConditionalRule('0,0:2,0', [{ type: 'cellValue', operator: 'contains', value: '错"误', style: { bgcolor: '#FFC7CE' } }]);
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).toContain(
      '<cfRule type="containsText" dxfId="0" priority="1" operator="containsText" text="错&quot;误"><formula>NOT(ISERROR(SEARCH("错""误",A1)))</formula></cfRule>',
    );
  });

  it('exports formula rules as expression with the leading = stripped and XML escaped', () => {
    const store = new Store();
    store.setConditionalRule('0,0:2,0', [{ type: 'formula', formula: '=IF(A1<5,"是&否","")', style: { bold: true } }]);
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).toContain('<cfRule type="expression" dxfId="0" priority="1"><formula>IF(A1&lt;5,"是&amp;否","")</formula></cfRule>');
  });

  it('exports dataBar, colorScale, and iconSet rules', () => {
    const store = new Store();
    store.setConditionalRule('0,0:0,0', [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }]);
    store.setConditionalRule('1,0:1,0', [{ type: 'colorScale', min: 0, max: 100, minColor: '#FFFFFF', maxColor: '#000000' }]);
    store.setConditionalRule('2,0:2,0', [{ type: 'iconSet', icons: 'arrows3' }]);
    store.setConditionalRule('3,0:3,0', [{ type: 'iconSet', icons: 'lights3', thresholds: [80, 20], basis: 'num' }]);
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).toContain(
      '<cfRule type="dataBar" priority="1"><dataBar><cfvo type="num" val="0"/><cfvo type="num" val="100"/><color rgb="FF4A90D9"/></dataBar></cfRule>',
    );
    expect(xml).toContain(
      '<cfRule type="colorScale" priority="2"><colorScale><cfvo type="num" val="0"/><cfvo type="num" val="100"/><color rgb="FFFFFFFF"/><color rgb="FF000000"/></colorScale></cfRule>',
    );
    expect(xml).toContain(
      '<cfRule type="iconSet" priority="3"><iconSet iconSet="3Arrows"><cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/></iconSet></cfRule>',
    );
    expect(xml).toContain(
      '<cfRule type="iconSet" priority="4"><iconSet iconSet="3TrafficLights1"><cfvo type="min"/><cfvo type="num" val="20"/><cfvo type="num" val="80"/></iconSet></cfRule>',
    );
  });

  it('dedupes identical rule styles into one dxf and skips empty styles', () => {
    const store = new Store();
    store.setConditionalRule('0,0:0,0', [{ type: 'cellValue', operator: 'gt', value: 1, style: { bgcolor: '#FFFF00', bold: true } }]);
    store.setConditionalRule('1,0:1,0', [{ type: 'formula', formula: '=A1>2', style: { bold: true, bgcolor: '#FFFF00' } }]);
    store.setConditionalRule('2,0:2,0', [{ type: 'cellValue', operator: 'lt', value: 0, style: {} }]);
    const buf = exportXlsxBuffer(store);
    const styles = stylesXml(buf);
    expect(styles).toContain('<dxfs count="1"><dxf><font><b/></font><fill><patternFill><bgColor rgb="FFFFFF00"/></patternFill></fill></dxf></dxfs>');
    const xml = sheetXml(buf);
    expect(xml.match(/dxfId="0"/g)?.length).toBe(2);
    expect(xml).toContain('<cfRule type="cellIs" priority="3" operator="lessThan"><formula>0</formula></cfRule>');
  });

  it('skips disabled rules entirely', () => {
    const store = new Store();
    store.setConditionalRule('0,0:0,0', [
      { type: 'cellValue', operator: 'gt', value: 1, style: { bgcolor: '#FFFF00' }, disabled: true },
      { type: 'dataBar', min: 0, max: 10, color: '#4A90D9' },
    ]);
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).not.toContain('cellIs');
    expect(xml).toContain('<cfRule type="dataBar" priority="1">');
  });

  it('conditional formats ride along and the workbook still reads back', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(1, 0, { text: '3', value: 3 });
    store.setConditionalRule('0,0:1,0', [{ type: 'cellValue', operator: 'gt', value: 5, style: { bgcolor: '#FFFF00' } }]);
    expectReadable(exportXlsxBuffer(store), { A1: 10, A2: 3 });
  });
});

describe('xlsx export: data validations', () => {
  it('exports list validations with Excel quote escaping and 中文 values', () => {
    const store = new Store();
    store.setValidationRule('1,0:1,0', { type: 'list', values: ['苹果,香蕉', '他说"好"', '否'] });
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).toContain(
      '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="A2">'
      + '<formula1>"苹果,香蕉,他说""好"",否"</formula1></dataValidation></dataValidations>',
    );
  });

  it('exports whole/decimal/textLength between rules and date rules as serials', () => {
    const store = new Store();
    store.setValidationRule('0,0:0,0', { type: 'integer', min: 1, max: 10 });
    store.setValidationRule('1,0:1,0', { type: 'decimal', min: 0.5, max: 9.5 });
    store.setValidationRule('2,0:2,0', { type: 'textLength', min: 2, max: 8 });
    store.setValidationRule('3,0:3,0', { type: 'date', minDate: '2024-01-01', maxDate: '2024-01-31' });
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).toContain('<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" sqref="A1"><formula1>1</formula1><formula2>10</formula2></dataValidation>');
    expect(xml).toContain('<dataValidation type="decimal" operator="between" allowBlank="1" showErrorMessage="1" sqref="A2"><formula1>0.5</formula1><formula2>9.5</formula2></dataValidation>');
    expect(xml).toContain('<dataValidation type="textLength" operator="between" allowBlank="1" showErrorMessage="1" sqref="A3"><formula1>2</formula1><formula2>8</formula2></dataValidation>');
    // 1900-system serials, 1899-12-30 = 0: 2024-01-01 → 45292, 2024-01-31 → 45322.
    expect(xml).toContain('<dataValidation type="date" operator="between" allowBlank="1" showErrorMessage="1" sqref="A4"><formula1>45292</formula1><formula2>45322</formula2></dataValidation>');
    expect(xml).toContain('<dataValidations count="4">');
  });

  it('exports custom validations with the leading = stripped and escaped', () => {
    const store = new Store();
    store.setValidationRule('0,0:0,0', { type: 'custom', formula: '=AND(A1>0,A1<100)' });
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).toContain('<dataValidation type="custom" allowBlank="1" showErrorMessage="1" sqref="A1"><formula1>AND(A1&gt;0,A1&lt;100)</formula1></dataValidation>');
  });

  it('validations ride along and the workbook still reads back', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '甲', value: '甲' });
    store.setValidationRule('0,0:0,0', { type: 'list', values: ['甲', '乙'] });
    expectReadable(exportXlsxBuffer(store), { A1: '甲' });
  });
});

describe('xlsx export: autofilter', () => {
  it('writes autoFilter between sheetData and mergeCells', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '名', value: '名' });
    store.addMerge('A5:B6');
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 3, c2: 3 }, criteria: {} });
    const xml = sheetXml(exportXlsxBuffer(store));
    expect(xml).toContain('<autoFilter ref="A1:D4"/>');
    expect(xml.indexOf('<autoFilter ref="A1:D4"/>')).toBeGreaterThan(xml.indexOf('</sheetData>'));
    expect(xml.indexOf('<autoFilter ref="A1:D4"/>')).toBeLessThan(xml.indexOf('<mergeCells'));
  });

  it('an autofiltered sheet still reads back', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '表头', value: '表头' });
    store.setCell(1, 0, { text: '行', value: '行' });
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 1, c2: 1 }, criteria: {} });
    expectReadable(exportXlsxBuffer(store), { A1: '表头', A2: '行' });
  });
});

describe('xlsx export: worksheet schema order', () => {
  it('merges all feature elements in CT_Worksheet order, before drawing/legacyDrawing', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '名', value: '名' });
    store.setCell(3, 0, { text: '链接', value: '链接', hyperlink: { target: 'https://example.com', tooltip: '提示' } });
    store.setCell(4, 0, { text: '批注', value: '批注', comment: { text: '注意' } });
    store.addMerge('A5:B6');
    store.setFreeze({ rows: 1, cols: 1 });
    store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 5, c2: 3 }, criteria: {} });
    store.setConditionalRule('1,0:2,1', [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }]);
    store.setValidationRule('2,0:2,0', { type: 'list', values: ['是', '否'] });
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 2, c2: 1, type: 'bar', title: '图' });
    cmd.execute.bind(cmd)(store);

    const xml = sheetXml(exportXlsxBuffer(store));
    // pane sits inside <sheetViews>, which precedes <sheetData>.
    const marks = [
      '<dimension', '<sheetViews><sheetView workbookViewId="0"><pane ',
      '</sheetView></sheetViews>', '<sheetData>', '<autoFilter ref="A1:D6"/>',
      '<mergeCells', '<conditionalFormatting', '<dataValidations', '<hyperlinks',
      '<ignoredErrors', '<drawing ', '<legacyDrawing ',
    ];
    const positions = marks.map((mark) => xml.indexOf(mark));
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(xml).toContain('<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>');
  });
});

describe('xlsx export: plain workbooks stay untouched', () => {
  it('no features → sheet xml byte-identical to the raw SheetJS output', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello', value: 'Hello' });
    store.setCell(1, 0, { text: '42', value: 42 });
    const buf = exportXlsxBuffer(store);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Hello'], [42]]), 'Sheet1');
    const baseline = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    expect(sheetXml(buf)).toBe(sheetXml(baseline));
  });

  it('no features → no empty nodes anywhere; freeze-only adds no dxfs', () => {
    const plain = new Store();
    plain.setCell(0, 0, { text: 'x', value: 'x' });
    const xml = sheetXml(exportXlsxBuffer(plain));
    expect(xml).not.toContain('<pane');
    expect(xml).not.toContain('<autoFilter');
    expect(xml).not.toContain('<conditionalFormatting');
    expect(xml).not.toContain('<dataValidations');
    const styles = stylesXml(exportXlsxBuffer(plain));
    expect(styles).toContain('<borders count="1">');
    // SheetJS's untouched styles part carries an empty <dxfs count="0"/>; the
    // point is that no dxf entries appear.
    expect(styles).not.toContain('<dxf>');
    expect(styles).not.toContain('<dxf ');

    const frozenOnly = new Store();
    frozenOnly.setCell(0, 0, { text: 'x', value: 'x' });
    frozenOnly.setFreeze({ rows: 1, cols: 0 });
    const frozenStyles = stylesXml(exportXlsxBuffer(frozenOnly));
    expect(frozenStyles).not.toContain('<dxf>');
    expect(frozenStyles).not.toContain('<dxf ');
  });
});
