import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { buildSessionPasteValues, snapshotCells } from '../../src/clipboard/session';
import { SetRangeValues } from '../../src/commands/impl/SetRangeValues';
import { ClipboardService } from '../../src/clipboard/ClipboardService';
import { FillRangeCommand } from '../../src/commands/impl/FillRange';

describe('hyperlink paste / fill', () => {
  it('session paste carries hyperlink and clears stale link on plain overwrite', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Docs', hyperlink: { target: 'https://example.com', tooltip: 't' } });
    const session = {
      type: 'copy' as const,
      range: { r1: 0, c1: 0, r2: 0, c2: 0 },
      text: 'Docs',
      cells: snapshotCells(store, { r1: 0, c1: 0, r2: 0, c2: 0 }),
    };
    const linked = buildSessionPasteValues(session, 1, 0);
    expect(linked[0]![0]!.hyperlink?.target).toBe('https://example.com');
    new SetRangeValues({ r1: 1, c1: 0, r2: 1, c2: 0, values: linked }).execute(store);
    expect(store.getCell(1, 0)?.hyperlink?.target).toBe('https://example.com');

    store.setCell(2, 0, { text: 'old', hyperlink: { target: 'https://old.com' } });
    new SetRangeValues({
      r1: 2, c1: 0, r2: 2, c2: 0,
      values: [[{ text: 'plain', formula: undefined, value: undefined, styleId: undefined, type: undefined, richText: undefined, hyperlink: undefined }]],
    }).execute(store);
    expect(store.getCell(2, 0)?.text).toBe('plain');
    expect(store.getCell(2, 0)?.hyperlink).toBeUndefined();
  });

  it('clipboard HTML round-trips href', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Docs', hyperlink: { target: 'https://example.com' } });
    const payload = ClipboardService.createPayload(store, { r1: 0, c1: 0, r2: 0, c2: 0 });
    expect(payload?.html ?? '').toContain('href="https://example.com"');
    const parsed = ClipboardService.parseHtml(payload!.html);
    expect(parsed[0]![0]!.hyperlink?.target).toBe('https://example.com');
  });

  it('fill handle copies hyperlink on straight copy', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Go', hyperlink: { target: 'https://x.com' } });
    new FillRangeCommand({
      source: { r1: 0, c1: 0, r2: 0, c2: 0 },
      target: { r1: 0, c1: 0, r2: 2, c2: 0 },
      ctrlKey: false,
    }).execute(store);
    expect(store.getCell(1, 0)?.hyperlink?.target).toBe('https://x.com');
    expect(store.getCell(2, 0)?.hyperlink?.target).toBe('https://x.com');
  });
});
