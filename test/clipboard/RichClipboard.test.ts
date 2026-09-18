import { describe, expect, it } from 'vitest';
import { ClipboardService } from '../../src/clipboard/ClipboardService';
import { Store } from '../../src/store/Store';
import type { RangeAddress } from '../../src/selection/Range';
import { SetCellText } from '../../src/commands/impl/SetCellText';

const RED = { color: '#FF0000' };
const BLUE = { color: '#0000FF', bold: true };
const RANGE: RangeAddress = { r1: 0, c1: 0, r2: 0, c2: 1 };

describe('clipboard rich text HTML flavor', () => {
  it('writes rich runs as styled spans and reads them back', () => {
    const store = new Store();
    new SetCellText({ r: 0, c: 0, text: '红蓝', richText: [{ text: '红', style: RED }, { text: '蓝', style: BLUE }] }).execute(store);
    store.setCell(0, 1, { text: 'plain' });

    const payload = ClipboardService.createPayload(store, RANGE)!;
    expect(payload.text).toBe('红蓝\tplain');
    expect(payload.html).toContain('color:#FF0000');
    expect(payload.html).toContain('font-weight:700');

    const parsed = ClipboardService.parseHtml(payload.html);
    expect(parsed[0]![0]!.text).toBe('红蓝');
    expect(parsed[0]![0]!.richText).toEqual([
      { text: '红', style: RED },
      { text: '蓝', style: BLUE },
    ]);
    // plain cell stays plain
    expect(parsed[0]![1]!.richText).toBeUndefined();
  });

  it('reads Excel-style clipboard HTML (pt sizes, rgb colors, tags)', () => {
    const html = '<table><tr><td>'
      + '<span style="font-weight:700;color:rgb(255,0,0);font-size:14pt;font-family:\'宋体\'">粗</span>'
      + '<i>斜</i><u>线</u><s>删</s><sub>下</sub><sup>上</sup>'
      + '</td></tr></table>';
    const cell = ClipboardService.parseHtml(html)[0]![0]!;
    expect(cell.text).toBe('粗斜线删下上');
    expect(cell.richText).toEqual([
      { text: '粗', style: { bold: true, color: '#FF0000', fontSize: 14, fontFamily: '宋体' } },
      { text: '斜', style: { italic: true } },
      { text: '线', style: { underline: true } },
      { text: '删', style: { strike: true } },
      { text: '下', style: { vertAlign: 'subscript' } },
      { text: '上', style: { vertAlign: 'superscript' } },
    ]);
  });

  it('nested styling accumulates over plain text runs', () => {
    const html = '<table><tr><td>a<span style="color:#00FF00">b<u>c</u></span>d</td></tr></table>';
    const cell = ClipboardService.parseHtml(html)[0]![0]!;
    expect(cell.text).toBe('abcd');
    expect(cell.richText).toEqual([
      { text: 'a' },
      { text: 'b', style: { color: '#00FF00' } },
      { text: 'c', style: { color: '#00FF00', underline: true } },
      { text: 'd' },
    ]);
  });

  it('text-only HTML still parses to plain cells', () => {
    const cell = ClipboardService.parseHtml('<table><tr><td>hello</td></tr></table>')[0]![0]!;
    expect(cell.text).toBe('hello');
    expect(cell.richText).toBeUndefined();
  });
});
