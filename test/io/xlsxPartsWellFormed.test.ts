import { describe, expect, it } from 'vitest';
import { strFromU8 } from 'fflate';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { safeUnzip } from '../../src/io/safeUnzip';
import { Store } from '../../src/store/Store';
import { SetCellCommentCommand } from '../../src/commands/impl/SetCellComment';

const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** A workbook exercising every zip post-processor: styles/borders, sheet
 * features (freeze/autofilter/conditional/validation/merge), a chart and a
 * comment on the same sheet — the worst case for rels-part wiring. */
function storeWithEverything(): Store {
  const store = new Store();
  store.setCell(0, 0, { text: '季度', value: '季度' });
  store.setCell(0, 1, { text: '销售额', value: '销售额' });
  store.setCell(1, 0, { text: 'Q1', value: 'Q1' });
  store.setCell(1, 1, { text: '10', value: 10 });
  store.setCell(2, 0, { text: 'Q2', value: 'Q2' });
  store.setCell(2, 1, { text: '20', value: 20 });
  store.addMerge('A1:B2');
  store.setStyle('s-box', { border: { top: 'solid', bottom: 'solid', left: 'solid', right: 'solid' } });
  store.setCell(3, 3, { text: '框', value: '框', styleId: 's-box' });
  store.setFreeze({ rows: 1, cols: 1 });
  store.setConditionalRule('4,0:5,1', [{ type: 'cellValue', operator: 'gt', value: 5, style: { bgcolor: '#FFFF00' } }]);
  store.setValidationRule('6,0:6,0', { type: 'list', values: ['是', '否'] });
  store.setAutoFilter({ range: { r1: 0, c1: 0, r2: 2, c2: 1 }, criteria: {} });
  store.addChart({
    id: 'chart-1', type: 'bar', range: '0,0:2,2', title: '销售图表',
    anchor: { from: { r: 4, c: 0, offX: 0, offY: 0 }, to: { r: 12, c: 5, offX: 0, offY: 0 } },
  });
  const cmd = new SetCellCommentCommand({ r: 5, c: 2, comment: { text: '核对一下这个数', author: '审计' } });
  cmd.execute.bind(cmd)(store);
  // A second sheet with a comment but no chart: there the comment exporter
  // creates the sheet rels part from scratch (the chart path can't cover it).
  const sheet2 = store.addSheet('说明');
  store.setCell(0, 0, { text: '备注', value: '备注' }, sheet2);
  const cmd2 = new SetCellCommentCommand({ r: 1, c: 0, comment: { text: '仅批注' }, sheetId: sheet2 });
  cmd2.execute.bind(cmd2)(store);
  return store;
}

function decodeParts(buf: ArrayBuffer): Record<string, string> {
  const files = safeUnzip(new Uint8Array(buf));
  const parts: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) parts[path] = strFromU8(data);
  return parts;
}

describe('xlsx exported XML parts are well-formed', () => {
  it('every .xml/.rels/.vml part parses as strict XML (no parsererror)', () => {
    const parts = decodeParts(exportXlsxBuffer(storeWithEverything()));
    const parser = new DOMParser();
    for (const [path, text] of Object.entries(parts)) {
      if (!/\.(xml|rels|vml)$/.test(path)) continue;
      const doc = parser.parseFromString(text, 'application/xml');
      const err = doc.getElementsByTagName('parsererror')[0];
      expect(err, `${path} is not well-formed. Head: ${JSON.stringify(text.slice(0, 200))}`).toBeUndefined();
    }
  });

  it('sheet rels is a complete Relationships document and drawing r:ids resolve', () => {
    const parts = decodeParts(exportXlsxBuffer(storeWithEverything()));
    const relsXml = parts['xl/worksheets/_rels/sheet1.xml.rels'];
    expect(relsXml).toBeDefined();
    const parser = new DOMParser();
    const rels = parser.parseFromString(relsXml!, 'application/xml');
    const root = rels.documentElement;
    expect(root.localName).toBe('Relationships');
    expect(root.namespaceURI).toBe(RELS_NS);

    const sheetXml = parts['xl/worksheets/sheet1.xml'];
    expect(sheetXml).toBeDefined();
    const sheet = parser.parseFromString(sheetXml!, 'application/xml');
    const relIds = [...rels.getElementsByTagName('Relationship')].map((el) => el.getAttribute('Id'));
    // Every Relationship Id is unique.
    expect(new Set(relIds).size).toBe(relIds.length);
    // Every r:id the worksheet references (drawing / legacyDrawing) resolves.
    const usedRids: string[] = [];
    for (const tag of ['drawing', 'legacyDrawing']) {
      for (const el of sheet.getElementsByTagName(tag)) {
        const rid = el.getAttribute('r:id');
        expect(rid, `<${tag}> carries no r:id`).toBeTruthy();
        usedRids.push(rid!);
        expect(relIds, `${tag} r:id ${rid} missing from the rels part`).toContain(rid);
      }
    }
    // Chart and comment live on the same sheet: their rIds must not collide.
    expect(new Set(usedRids).size).toBe(usedRids.length);
    expect(usedRids.length).toBe(2);
  });
});
