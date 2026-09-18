import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { Store } from '../../src/store/Store';
import { CreateChartCommand } from '../../src/commands/impl/CreateChart';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';
import { importChartsForSheet, parseChartXml, unionRangeOf } from '../../src/io/chartXmlImport';
import type { ChartAnchor } from '../../src/charts/types';

const barAnchor: ChartAnchor = {
  from: { r: 4, c: 1, offX: 12, offY: 8 },
  to: { r: 18, c: 8, offX: 40, offY: 20 },
};

function storeWithCharts(): Store {
  const store = new Store();
  store.setCell(0, 0, { text: '季度', value: '季度' });
  store.setCell(0, 1, { text: '销售额', value: '销售额' });
  store.setCell(1, 0, { text: 'Q1', value: 'Q1' });
  store.setCell(1, 1, { text: '10', value: 10 });
  store.setCell(2, 0, { text: 'Q2', value: 'Q2' });
  store.setCell(2, 1, { text: '20', value: 20 });
  const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 2, c2: 1, type: 'bar', title: '销售图表', anchor: barAnchor });
  cmd.execute.bind(cmd)(store);
  return store;
}

describe('xlsx chart round-trip', () => {
  it('exports charts as drawing parts and re-imports geometry/type/range/title', () => {
    const store = storeWithCharts();
    const buf = exportXlsxBuffer(store);
    const restored = importXlsx(buf);
    const charts = restored.sheets[0]?.data.charts ?? [];
    expect(charts.length).toBe(1);
    const chart = charts[0]!;
    expect(chart.type).toBe('bar');
    expect(chart.title).toBe('销售图表');
    expect(chart.range).toBe('0,0:2,1');
    // EMU round-trip is exact for integer px offsets.
    expect(chart.anchor).toEqual(barAnchor);
  });

  it('no charts → zip untouched (no drawing parts added)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'plain', value: 'plain' });
    const buf = exportXlsxBuffer(store);
    const restored = importXlsx(buf);
    expect(restored.sheets[0]?.data.charts ?? []).toEqual([]);
  });

  it('imports oneCellAnchor drawings and maps exotic chart types to our three', () => {
    const files = new Map<string, string>([
      ['xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'],
      ['xl/drawings/drawing1.xml',
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">'
        + '<xdr:oneCellAnchor>'
        + '<xdr:from><xdr:col>2</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>9525</xdr:rowOff></xdr:from>'
        + '<ext cx="1905000" cy="952500" xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>'
        + '<xdr:graphicFrame><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId2"/></a:graphicData></a:graphic></xdr:graphicFrame>'
        + '<xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>'],
      ['xl/drawings/_rels/drawing1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>'],
      ['xl/charts/chart1.xml',
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        + '<c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>利润</a:t></a:r></a:p></c:rich></c:tx></c:title>'
        + '<c:plotArea><c:doughnutChart><c:ser><c:cat><c:strRef><c:f>Sheet1!$B$1:$D$1</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$4</c:f></c:numRef></c:val></c:ser><c:firstSliceAng val="0"/></c:doughnutChart></c:plotArea>'
        + '</c:chart></c:chartSpace>'],
    ]);
    const charts = importChartsForSheet(files, 'xl/worksheets/sheet1.xml');
    expect(charts.length).toBe(1);
    const chart = charts[0]!;
    expect(chart.type).toBe('pie');
    expect(chart.title).toBe('利润');
    expect(chart.range).toBe('0,1:3,3');
    expect(chart.anchor?.from).toEqual({ r: 1, c: 2, offX: 2, offY: 1 });
    expect(chart.anchor?.to).toEqual({ r: 1, c: 2, offX: 2 + 200, offY: 1 + 100 });
  });

  it('clamps crafted chart ranges and anchors to the fixed grid', () => {
    // A hostile file referencing the full 1M×16K sheet must not survive import
    // unclamped — readChartData walks the range and would freeze the page.
    const files = new Map<string, string>([
      ['xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'],
      ['xl/drawings/drawing1.xml',
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">'
        + '<xdr:twoCellAnchor>'
        + '<xdr:from><xdr:col>16383</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1048570</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
        + '<xdr:to><xdr:col>99999</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2097152</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
        + '<xdr:graphicFrame><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId2"/></a:graphicData></a:graphic></xdr:graphicFrame>'
        + '<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>'],
      ['xl/drawings/_rels/drawing1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>'],
      ['xl/charts/chart1.xml',
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">'
        + '<c:chart><c:plotArea><c:barChart><c:ser>'
        + '<c:cat><c:strRef><c:f>Sheet1!$A$1:$XFD$1048576</c:f></c:strRef></c:cat>'
        + '<c:val><c:numRef><c:f>Sheet1!$A$2:$XFD$1048576</c:f></c:numRef></c:val>'
        + '</c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>'],
    ]);
    const charts = importChartsForSheet(files, 'xl/worksheets/sheet1.xml');
    expect(charts.length).toBe(1);
    const chart = charts[0]!;
    const [r1, c1] = chart.range.split(':')[0]!.split(',').map(Number);
    const [r2, c2] = chart.range.split(':')[1]!.split(',').map(Number);
    expect(r1).toBeLessThanOrEqual(999);
    expect(r2).toBeLessThanOrEqual(999);
    expect(c1).toBeLessThanOrEqual(25);
    expect(c2).toBeLessThanOrEqual(25);
    expect(chart.anchor?.from.r).toBeLessThanOrEqual(999);
    expect(chart.anchor?.from.c).toBeLessThanOrEqual(25);
    expect(chart.anchor?.to.r).toBeLessThanOrEqual(999);
    expect(chart.anchor?.to.c).toBeLessThanOrEqual(25);
  });

  it('quotes sheet names with spaces in exported chart refs (round-trips)', () => {
    const store = new Store();
    store.renameSheet(store.getActiveSheetId(), 'Q1 销售');
    store.setCell(0, 0, { text: 'A', value: 'A' });
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 1, c2: 1, type: 'bar', anchor: barAnchor });
    cmd.execute.bind(cmd)(store);
    const buf = exportXlsxBuffer(store);
    const restored = importXlsx(buf);
    const chart = restored.sheets[0]?.data.charts[0];
    expect(chart).toBeDefined();
    // The quoted-name refs must survive the round-trip with the same range.
    expect(chart?.range).toBe('0,0:1,1');
    // And the raw chart part quotes the name for Excel.
    const raw = new TextDecoder().decode(unzipSync(new Uint8Array(buf))['xl/charts/chart1.xml']);
    expect(raw).toContain("'Q1 销售'!$A$1");
    expect(raw).not.toContain('Q1 销售!$A$1');
  });

  it('keeps plain sheet names unquoted in exported chart refs', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'A', value: 'A' });
    const cmd = new CreateChartCommand({ r1: 0, c1: 0, r2: 1, c2: 1, type: 'bar' });
    cmd.execute.bind(cmd)(store);
    const raw = new TextDecoder().decode(unzipSync(new Uint8Array(exportXlsxBuffer(store)))['xl/charts/chart1.xml']);
    expect(raw).toContain('Sheet1!$A$1');
  });

  it('parseChartXml maps bar/line/pie families and unions series refs', () => {
    const line = parseChartXml('<c:chart><c:plotArea><c:lineChart><c:ser><c:val><c:numRef><c:f>Sheet1!$B$2:$B$5</c:f></c:numRef></c:val></c:ser></c:lineChart></c:plotArea></c:chart>');
    expect(line?.type).toBe('line');
    expect(line?.range).toBe('1,1:4,1');
    expect(parseChartXml('<c:barChart/>')?.type).toBe('bar');
    expect(parseChartXml('<c:scatterChart/>')?.type).toBe('line');
    expect(parseChartXml('<c:bubbleChart/>')).toBeUndefined();
    expect(unionRangeOf(["Sheet1!$C$3:$D$4", "A1:B2"])).toBe('0,0:3,3');
  });
});
