import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { importXlsx, isTextPart } from '../../src/io/XlsxImporter';
import { Store } from '../../src/store/Store';
import type { Cell, Style } from '../../src/types';
import type { SerializedSheetData } from '../../src/store/SheetData';
import { buildFixtureXlsx, buildWorkbookXlsx } from './xlsxFixture';

const MAX_BOUND = Number.MAX_SAFE_INTEGER;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SHEET_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

function cellAt(data: SerializedSheetData, r: number, c: number): Cell | undefined {
  return data.cells.find(([key]) => key === `${r},${c}`)?.[1];
}

function styleOf(data: SerializedSheetData, cell: Cell | undefined): Style | undefined {
  if (cell?.styleId === undefined) return undefined;
  return data.styles.find(([id]) => id === cell.styleId)?.[1];
}

/** Minimal style table: one plain font/fill plus a `<dxfs>` table for rule styles. */
function stylesWithDxfs(): string {
  return `${XML_DECL}
<styleSheet ${SHEET_NS}>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
<dxfs count="3">
<dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF006100"/><i/></font><fill><patternFill><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf>
<dxf/>
</dxfs>
</styleSheet>`;
}

describe('importXlsx: borders', () => {
  const styles = `${XML_DECL}
<styleSheet ${SHEET_NS}>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><name val="Arial"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="6">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF000000"/></left><right style="medium"/><top style="double"/><bottom style="thick"/><diagonal/></border>
<border><left style="hair"/><bottom style="dashDot"/></border>
<border><top style="dashed"/></border>
<border><left style="dotted"/></border>
<border><top style="slantDashDot"/><right style="mediumDashDotDot"/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="4" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="5" xfId="0" applyBorder="1"/>
</cellXfs>
</styleSheet>`;
  const sheet = `${XML_DECL}
<worksheet ${SHEET_NS}>
<sheetData>
<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>boxed</t></is></c><c r="B1" s="5"/><c r="C1" s="2"/><c r="D1" s="3"/><c r="E1" s="4"/><c r="F1" s="0"/></row>
<row r="2"><c r="A2" s="1"/></row>
</sheetData>
</worksheet>`;
  const data = importXlsx(buildWorkbookXlsx({ styles, sheets: [sheet] })).sheets[0]!.data;

  it('maps each border side to the model line names', () => {
    // thin/medium/double → solid; thick → thick; colors are dropped.
    expect(styleOf(data, cellAt(data, 0, 0))?.border).toEqual({ left: 'solid', right: 'solid', top: 'solid', bottom: 'thick' });
    // slantDashDot / mediumDashDotDot → dashed (dash family), plus the font rides along.
    expect(styleOf(data, cellAt(data, 0, 1))?.border).toEqual({ top: 'dashed', right: 'dashed' });
    expect(styleOf(data, cellAt(data, 0, 1))?.bold).toBe(true);
    // hair → solid, dashDot → dashed.
    expect(styleOf(data, cellAt(data, 0, 2))?.border).toEqual({ left: 'solid', bottom: 'dashed' });
    expect(styleOf(data, cellAt(data, 0, 3))?.border).toEqual({ top: 'dashed' });
    expect(styleOf(data, cellAt(data, 0, 4))?.border).toEqual({ left: 'dotted' });
  });

  it('keeps unbordered styles border-free and folds identical bordered styles into one id', () => {
    // borderId 0 contributes no border (xf 0's plain font still applies).
    expect(styleOf(data, cellAt(data, 0, 5))?.border).toBeUndefined();
    expect(styleOf(data, cellAt(data, 1, 0))?.border).toEqual({ left: 'solid', right: 'solid', top: 'solid', bottom: 'thick' });
    expect(cellAt(data, 1, 0)?.styleId).toBe(cellAt(data, 0, 0)?.styleId);
  });
});

describe('importXlsx: freeze panes', () => {
  const cellRow = '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>';
  const sheet = (view: string): string => `${XML_DECL}
<worksheet ${SHEET_NS}>
${view}
<sheetData>${cellRow}</sheetData>
</worksheet>`;
  const result = importXlsx(buildWorkbookXlsx({
    sheets: [
      sheet('<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="2" xSplit="1" topLeftCell="B3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'),
      sheet('<sheetViews><sheetView workbookViewId="0"><pane xSplit="3" topLeftCell="D1"/></sheetView></sheetViews>'),
      sheet('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2"/></sheetView></sheetViews>'),
      sheet('<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" xSplit="1" topLeftCell="B3" state="split"/></sheetView></sheetViews>'),
      sheet(''),
    ],
  }));

  it('imports frozen rows and columns', () => {
    expect(result.sheets[0]!.data.freeze).toEqual({ rows: 2, cols: 1 });
  });

  it('keeps a zero side when only the other axis is frozen', () => {
    expect(result.sheets[1]!.data.freeze).toEqual({ rows: 0, cols: 3 });
    expect(result.sheets[2]!.data.freeze).toEqual({ rows: 1, cols: 0 });
  });

  it('ignores split (non-frozen) panes and plain sheets', () => {
    expect(result.sheets[3]!.data.freeze).toBeUndefined();
    expect(result.sheets[4]!.data.freeze).toBeUndefined();
  });
});

describe('importXlsx: conditional formats', () => {
  const sheet = `${XML_DECL}
<worksheet ${SHEET_NS}>
<sheetData>
<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>9</v></c></row>
<row r="2"><c r="A2"><v>3</v></c></row>
<row r="3"><c r="C3" t="inlineStr"><is><t>cfg</t></is></c></row>
</sheetData>
<conditionalFormatting sqref="A1:B2">
<cfRule type="cellIs" dxfId="0" priority="1" operator="lessThan"><formula>2</formula></cfRule>
<cfRule type="cellIs" dxfId="0" priority="2" operator="between"><formula>1</formula><formula>5</formula></cfRule>
<cfRule type="cellIs" dxfId="0" priority="3" operator="notBetween"><formula>0</formula><formula>9</formula></cfRule>
<cfRule type="cellIs" priority="4" operator="greaterThan"></cfRule>
</conditionalFormatting>
<conditionalFormatting sqref="C3:C6 D3:D6">
<cfRule type="expression" dxfId="1" priority="5"><formula>A1&lt;2&amp;B1&gt;3</formula></cfRule>
</conditionalFormatting>
<conditionalFormatting sqref="E1:E5">
<cfRule type="dataBar" priority="6"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule>
<cfRule type="dataBar" priority="7"><dataBar><cfvo type="num" val="10"/><cfvo type="num" val="90"/></dataBar></cfRule>
</conditionalFormatting>
<conditionalFormatting sqref="F1:F5">
<cfRule type="colorScale" priority="8"><colorScale><cfvo type="min"/><cfvo type="percent" val="50"/><cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color rgb="FF63BE7B"/></colorScale></cfRule>
</conditionalFormatting>
<conditionalFormatting sqref="G1:G5">
<cfRule type="iconSet" priority="9"><iconSet iconSet="3Arrows"><cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/></iconSet></cfRule>
</conditionalFormatting>
<conditionalFormatting sqref="H1:H5">
<cfRule type="iconSet" priority="10"><iconSet iconSet="5Rating"><cfvo type="num" val="1"/><cfvo type="num" val="2"/></iconSet></cfRule>
<cfRule type="aboveAverage" priority="11" dxfId="0"/>
</conditionalFormatting>
<conditionalFormatting sqref="J1:J5">
<cfRule type="expression" dxfId="1" priority="12"><formula><![CDATA[B1>9]]></formula></cfRule>
</conditionalFormatting>
</worksheet>`;
  const rulesOf = (data: SerializedSheetData): Map<string, unknown> => new Map(data.conditionalRules.map(([k, r]) => [k, r]));
  const data = importXlsx(buildWorkbookXlsx({ styles: stylesWithDxfs(), sheets: [sheet] })).sheets[0]!.data;
  const rules = rulesOf(data);

  it('maps cellIs rules with the dxf style', () => {
    const style = { bold: true, color: '#9C0006', bgcolor: '#FFC7CE' };
    expect(rules.get('0,0:1,1')).toEqual([
      { type: 'cellValue', operator: 'lt', value: 2, style },
      { type: 'cellValue', operator: 'between', value: 1, value2: 5, style },
    ]);
  });

  it('maps expression rules with unescaped formulas and expands multi-area sqref', () => {
    const style = { italic: true, color: '#006100', bgcolor: '#C6EFCE' };
    const rule = { type: 'formula', formula: '=A1<2&B1>3', style };
    expect(rules.get('2,2:5,2')).toEqual([rule]);
    expect(rules.get('2,3:5,3')).toEqual([rule]);
  });

  it('maps dataBar, colorScale and iconSet (unstyled variants)', () => {
    expect(rules.get('0,4:4,4')).toEqual([{ type: 'dataBar', min: 0, max: 100, color: '#638EC6' }]);
    expect(rules.get('0,5:4,5')).toEqual([{ type: 'colorScale', min: 0, max: 100, minColor: '#F8696B', maxColor: '#63BE7B' }]);
    expect(rules.get('0,6:4,6')).toEqual([{ type: 'iconSet', icons: 'arrows3', thresholds: [67, 33] }]);
  });

  it('skips unsupported sets/types and reads CDATA formulas verbatim', () => {
    // 5Rating icon set and aboveAverage have no counterpart → no rules on H1:H5.
    expect(rules.has('0,7:4,7')).toBe(false);
    expect(rules.get('0,9:4,9')).toEqual([
      { type: 'formula', formula: '=B1>9', style: { italic: true, color: '#006100', bgcolor: '#C6EFCE' } },
    ]);
  });
});

describe('importXlsx: containsText conditional formats', () => {
  // The exporter writes `contains` as Excel's containsText rule; text criteria
  // with `&`, `<` or `"` exercise the attribute and formula decoding.
  const sheet = `${XML_DECL}
<worksheet ${SHEET_NS}>
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>cfg</t></is></c></row></sheetData>
<conditionalFormatting sqref="A1:A5">
<cfRule type="containsText" dxfId="0" priority="1" operator="containsText" text="a&amp;b&lt;c"><formula>NOT(ISERROR(SEARCH("a&amp;b&lt;c",A1)))</formula></cfRule>
<cfRule type="containsText" dxfId="0" priority="2"><formula>NOT(ISERROR(SEARCH("fr""uit",A1)))</formula></cfRule>
<cfRule type="containsText" dxfId="1" priority="3" operator="notContains" text="q"><formula>ISERROR(SEARCH("q",A1))</formula></cfRule>
<cfRule type="containsText" dxfId="1" priority="4" text=""><formula>LEFT(A1)</formula></cfRule>
<cfRule type="beginsWith" dxfId="1" priority="5" operator="beginsWith" text="q"><formula>LEFT(A1,1)="q"</formula></cfRule>
</conditionalFormatting>
</worksheet>`;
  const data = importXlsx(buildWorkbookXlsx({ styles: stylesWithDxfs(), sheets: [sheet] })).sheets[0]!.data;
  const rules = new Map(data.conditionalRules.map(([k, r]) => [k, r]));
  const style = { bold: true, color: '#9C0006', bgcolor: '#FFC7CE' };

  it('imports the text attribute (entity-decoded) with its dxf style', () => {
    expect(rules.get('0,0:4,0')![0]).toEqual({ type: 'cellValue', operator: 'contains', value: 'a&b<c', style });
  });

  it('falls back to the first quoted formula literal when the text attribute is missing', () => {
    const list = rules.get('0,0:4,0') as Array<{ value: string | number }>;
    // Excel escapes a quote inside the literal by doubling it.
    expect(list[1]?.value).toBe('fr"uit');
  });

  it('skips notContains, other text operators and rules without any text', () => {
    // notContains (rule 3), text="" + unquoted formula (rule 4) and beginsWith
    // (rule 5) have no counterpart → only the two `contains` rules survive.
    expect(rules.get('0,0:4,0')).toHaveLength(2);
  });
});

describe('importXlsx: data validations', () => {
  const sheet = `${XML_DECL}
<worksheet ${SHEET_NS}>
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>b</t></is></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>c</t></is></c></row>
</sheetData>
<dataValidations count="10">
<dataValidation type="list" allowBlank="1" sqref="D2:D9"><formula1>"红色,绿色,蓝色"</formula1></dataValidation>
<dataValidation type="list" sqref="E2"><formula1>Sheet1!$A$1:$A$3</formula1></dataValidation>
<dataValidation type="list" sqref="E3"><formula1>Missing!B1:B3</formula1></dataValidation>
<dataValidation type="whole" operator="between" sqref="F2:F10"><formula1>1</formula1><formula2>10</formula2></dataValidation>
<dataValidation type="decimal" operator="greaterThanOrEqual" sqref="G2"><formula1>0.5</formula1></dataValidation>
<dataValidation type="textLength" operator="lessThan" sqref="H2"><formula1>5</formula1></dataValidation>
<dataValidation type="date" operator="between" sqref="I2"><formula1>45000</formula1><formula2>45010</formula2></dataValidation>
<dataValidation type="custom" sqref="J2"><formula1><![CDATA[LEN(J2)<5]]></formula1></dataValidation>
<dataValidation type="whole" operator="notEqual" sqref="K2"><formula1>7</formula1></dataValidation>
<dataValidation type="whole" sqref="K3"><formula1>3</formula1><formula2>8</formula2></dataValidation>
<dataValidation type="whole" sqref="K5"><formula1>4</formula1></dataValidation>
<dataValidation sqref="K4"><formula1>1</formula1></dataValidation>
</dataValidations>
</worksheet>`;
  const data = importXlsx(buildWorkbookXlsx({ sheets: [sheet] })).sheets[0]!.data;
  const rulesOf = (d: SerializedSheetData): Map<string, unknown> => new Map(d.validationRules.map(([k, r]) => [k, r]));
  const rules = rulesOf(data);

  it('imports an inline list (with escaping intact)', () => {
    expect(rules.get('1,3:8,3')).toEqual({ type: 'list', values: ['红色', '绿色', '蓝色'] });
  });

  it('expands a range-reference list from the imported cell values', () => {
    expect(rules.get('1,4:1,4')).toEqual({ type: 'list', values: ['a', 'b', 'c'] });
    // Unresolvable reference (empty range) → the rule is skipped.
    expect(rules.has('2,4:2,4')).toBe(false);
  });

  it('maps whole/decimal/textLength with their operators', () => {
    expect(rules.get('1,5:9,5')).toEqual({ type: 'integer', min: 1, max: 10 });
    expect(rules.get('1,6:1,6')).toEqual({ type: 'decimal', min: 0.5, max: MAX_BOUND });
    expect(rules.get('1,7:1,7')).toEqual({ type: 'textLength', min: -MAX_BOUND, max: 5 });
  });

  it('converts date serials to YYYY-MM-DD', () => {
    expect(rules.get('1,8:1,8')).toEqual({ type: 'date', minDate: '2023-03-15', maxDate: '2023-03-25' });
  });

  it('maps custom formulas (CDATA) and defaults a missing operator to between', () => {
    expect(rules.get('1,9:1,9')).toEqual({ type: 'custom', formula: '=LEN(J2)<5' });
    expect(rules.get('2,10:2,10')).toEqual({ type: 'integer', min: 3, max: 8 });
    // between with only formula1 degenerates to an exact match.
    expect(rules.get('4,10:4,10')).toEqual({ type: 'integer', min: 4, max: 4 });
  });

  it('skips notEqual rules and type-less validations', () => {
    expect(rules.has('1,10:1,10')).toBe(false);
    expect(rules.has('3,10:3,10')).toBe(false);
  });
});

describe('importXlsx: auto filter', () => {
  it('imports the filter range with empty criteria (column filters ignored)', () => {
    const sheet = `${XML_DECL}
<worksheet ${SHEET_NS}>
<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>
<autoFilter ref="A1:D10"><filterColumn colId="0"><filters><filter val="1"/></filters></filterColumn></autoFilter>
</worksheet>`;
    expect(importXlsx(buildWorkbookXlsx({ sheets: [sheet] })).sheets[0]!.data.autoFilter)
      .toEqual({ range: { r1: 0, c1: 0, r2: 9, c2: 3 }, criteria: {} });
  });

  it('ignores a filter without a ref or reaching past the grid', () => {
    const sheet = `${XML_DECL}
<worksheet ${SHEET_NS}>
<sheetData/>
<autoFilter/>
<autoFilter ref="A1:AA5"/>
</worksheet>`;
    expect(importXlsx(buildWorkbookXlsx({ sheets: [sheet] })).sheets[0]!.data.autoFilter).toBeUndefined();
  });
});

describe('importXlsx: robustness against broken feature xml', () => {
  const sheet = `${XML_DECL}
<worksheet ${SHEET_NS}>
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData>
<conditionalFormatting>
<cfRule type="cellIs" operator="lessThan"><formula>1</formula></cfRule>
</conditionalFormatting>
<conditionalFormatting sqref="ZZZ99:ZZZ99">
<cfRule type="cellIs" dxfId="0" operator="lessThan"><formula>1</formula></cfRule>
</conditionalFormatting>
<pane xSplit="abc" ySplit="NaN" state="frozen"/>
<autoFilter/>
<dataValidations>
<dataValidation type="date" operator="between" sqref="A1:A2"><formula1>notadate</formula1><formula2> neither </formula2></dataValidation>
</dataValidations>
</worksheet>`;
  const data = importXlsx(buildWorkbookXlsx({ sheets: [sheet] })).sheets[0]!.data;

  it('imports the cells and skips every broken feature without failing', () => {
    expect(cellAt(data, 0, 0)?.text).toBe('ok');
    expect(data.conditionalRules).toEqual([]);
    expect(data.validationRules).toEqual([]);
    expect(data.freeze).toBeUndefined();
    expect(data.autoFilter).toBeUndefined();
  });
});

describe('importXlsx: namespaced worksheet parts', () => {
  const sheet = `${XML_DECL}
<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>prefixed</x:t></x:is></x:c></x:row></x:sheetData>
<x:pane ySplit="1" state="frozen"/>
<x:autoFilter ref="B2:C3"/>
</x:worksheet>`;
  const data = importXlsx(buildWorkbookXlsx({ sheets: [sheet] })).sheets[0]!.data;

  it('still finds the freeze pane and auto filter under a namespace prefix', () => {
    expect(data.freeze).toEqual({ rows: 1, cols: 0 });
    expect(data.autoFilter).toEqual({ range: { r1: 1, c1: 1, r2: 2, c2: 2 }, criteria: {} });
  });
});

describe('importXlsx: plain files keep their shape', () => {
  const result = importXlsx(buildFixtureXlsx());
  const data = result.sheets[0]!.data;

  it('adds none of the new feature fields when the parts are absent', () => {
    expect(data.freeze).toBeUndefined();
    expect(data.autoFilter).toBeUndefined();
    expect(data.conditionalRules).toEqual([]);
    expect(data.validationRules).toEqual([]);
    for (const [, style] of data.styles) expect(style.border).toBeUndefined();
    expect(cellAt(data, 0, 0)?.text).toBe('标题');
    expect(data.merges).toEqual(['A4:B4']);
  });

  it('the serialized store keeps working through Store.replaceAll', () => {
    const store = new Store();
    store.replaceAll(importXlsx(buildFixtureXlsx()));
    expect(store.getCell(0, 0)?.text).toBe('标题');
    expect(store.getFreeze()).toBeUndefined();
    expect(store.getAutoFilter()).toBeUndefined();
  });
});

describe('importXlsx: features reach the store through replaceAll', () => {
  const sheet = `${XML_DECL}
<worksheet ${SHEET_NS}>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" xSplit="1" state="frozen"/></sheetView></sheetViews>
<sheetData>
<row r="1"><c r="A1"><v>1</v></c></row>
</sheetData>
<conditionalFormatting sqref="A1:A5">
<cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>3</formula></cfRule>
</conditionalFormatting>
<dataValidations count="1">
<dataValidation type="whole" operator="between" sqref="B1:B4"><formula1>1</formula1><formula2>5</formula2></dataValidation>
</dataValidations>
<autoFilter ref="A1:B10"/>
</worksheet>`;
  const imported = importXlsx(buildWorkbookXlsx({ styles: stylesWithDxfs(), sheets: [sheet] }));

  it('freeze / rules / filter survive into the live store', () => {
    const store = new Store();
    store.replaceAll(imported);
    expect(store.getFreeze()).toEqual({ rows: 2, cols: 1 });
    expect(store.getAutoFilter()).toEqual({ range: { r1: 0, c1: 0, r2: 9, c2: 1 }, criteria: {} });
    expect(store.getValidationRules()).toContainEqual(['0,1:3,1', { type: 'integer', min: 1, max: 5 }]);
    expect([...store.getConditionalRules()].map(([k]) => k)).toContain('0,0:4,0');
  });
});

describe('importXlsx: SheetJS-written workbook cross-check', () => {
  it('merges and hidden rows import unchanged, without any feature leakage', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['合并', 'x'], ['r2', 1], ['r3', 2]]);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    ws['!rows'] = [{ hidden: true }, {}, { hpt: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'S1');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

    const data = importXlsx(buf).sheets[0]!.data;
    expect(data.merges).toEqual(['A1:B1']);
    expect(data.rows).toContainEqual([0, { hide: true }]);
    expect(data.rows).toContainEqual([2, { height: 18 }]);
    expect(data.freeze).toBeUndefined();
    expect(data.autoFilter).toBeUndefined();
    expect(data.conditionalRules).toEqual([]);
    expect(data.validationRules).toEqual([]);
    expect(cellAt(data, 0, 0)?.text).toBe('合并');
    expect(cellAt(data, 2, 1)?.value).toBe(2);
  });
});

describe('isTextPart', () => {
  it('accepts xml, rels and vml parts case-insensitively', () => {
    expect(isTextPart('xl/workbook.xml')).toBe(true);
    expect(isTextPart('[Content_Types].xml')).toBe(true);
    expect(isTextPart('xl/_rels/workbook.xml.rels')).toBe(true);
    expect(isTextPart('xl/worksheets/_rels/sheet1.xml.rels')).toBe(true);
    expect(isTextPart('xl/drawings/vmlDrawing1.vml')).toBe(true);
    expect(isTextPart('XL/Styles.XML')).toBe(true);
  });

  it('rejects binary parts, directories and extensionless entries', () => {
    expect(isTextPart('xl/media/image1.png')).toBe(false);
    expect(isTextPart('xl/media/photo.PNG')).toBe(false);
    expect(isTextPart('xl/media/image2.jpeg')).toBe(false);
    expect(isTextPart('xl/printerSettings/printerSettings.bin')).toBe(false);
    expect(isTextPart('docProps/thumbnail.emf')).toBe(false);
    expect(isTextPart('custom part')).toBe(false);
    expect(isTextPart('xl/media/')).toBe(false);
    expect(isTextPart('')).toBe(false);
  });
});

describe('importXlsx: binary zip parts are not decoded', () => {
  // Bytes that are not valid UTF-8 (PNG header followed by 0xFF 0xFE 0x00):
  // before the text-parts filter the reader materialised them as garbled
  // strings, although nothing ever reads media or printer-settings parts.
  const invalidUtf8 = Uint8Array.of(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0xFE, 0x00);
  const sheet = `${XML_DECL}
<worksheet ${SHEET_NS}>
<sheetData>
<row r="1"><c r="A1" s="0" t="inlineStr"><is><t>标题</t></is></c></row>
</sheetData>
<conditionalFormatting sqref="A1:A5">
<cfRule type="containsText" dxfId="0" priority="1" operator="containsText" text="题"><formula>NOT(ISERROR(SEARCH("题",A1)))</formula></cfRule>
</conditionalFormatting>
</worksheet>`;
  const imported = importXlsx(buildWorkbookXlsx({
    styles: stylesWithDxfs(),
    sheets: [sheet],
    binaryParts: [
      { name: 'xl/media/image1.png', content: invalidUtf8 },
      { name: 'xl/printerSettings/printerSettings.bin', content: Uint8Array.of(0x00, 0x01, 0x02) },
    ],
  }));

  it('still imports sheets, cells, styles and conditional formats', () => {
    expect(imported.sheets).toHaveLength(1);
    const data = imported.sheets[0]!.data;
    expect(cellAt(data, 0, 0)?.text).toBe('标题');
    expect(styleOf(data, cellAt(data, 0, 0))).toBeDefined();
    expect(data.conditionalRules).toEqual([
      ['0,0:4,0', [{ type: 'cellValue', operator: 'contains', value: '题', style: { bold: true, color: '#9C0006', bgcolor: '#FFC7CE' } }]],
    ]);
  });

  it('never hands the binary bytes to the text decoder', () => {
    const decodeSpy = vi.spyOn(TextDecoder.prototype, 'decode');
    try {
      importXlsx(buildWorkbookXlsx({
        styles: stylesWithDxfs(),
        sheets: [sheet],
        binaryParts: [{ name: 'xl/media/image1.png', content: invalidUtf8 }],
      }));
      const decodedBinary = decodeSpy.mock.calls.filter((args) => {
        const input = args[0] as Uint8Array | undefined;
        return input !== undefined && Array.from(input).includes(0xFF);
      });
      expect(decodedBinary).toHaveLength(0);
    } finally {
      decodeSpy.mockRestore();
    }
  });
});
