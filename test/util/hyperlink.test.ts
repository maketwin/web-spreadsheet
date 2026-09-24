import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { resolveHyperlinkTarget } from '../../src/util/hyperlink';
import { SetHyperlinkCommand } from '../../src/commands/impl/SetHyperlink';

describe('resolveHyperlinkTarget', () => {
  const store = new Store();

  it('classifies http and mailto', () => {
    expect(resolveHyperlinkTarget(store, { target: 'https://example.com' })).toEqual({
      kind: 'external', url: 'https://example.com',
    });
    expect(resolveHyperlinkTarget(store, { target: 'mailto:a@b.com' }).kind).toBe('external');
  });

  it('resolves A1 and Sheet!A1', () => {
    expect(resolveHyperlinkTarget(store, { target: 'B2' })).toEqual({ kind: 'sheet', r: 1, c: 1 });
    const sheets = store.getSheets();
    const name = sheets[0]!.name;
    const hit = resolveHyperlinkTarget(store, { target: `${name}!A1` });
    expect(hit).toEqual({ kind: 'sheet', sheetId: sheets[0]!.id, r: 0, c: 0 });
  });

  it('rejects garbage', () => {
    expect(resolveHyperlinkTarget(store, { target: 'not a link' }).kind).toBe('invalid');
  });
});

describe('SetHyperlinkCommand', () => {
  it('sets and clears hyperlink with undo', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Click' });
    const set = new SetHyperlinkCommand({
      r: 0, c: 0,
      hyperlink: { target: 'https://example.com', tooltip: 'ex' },
      displayText: 'Go',
    });
    set.execute(store);
    expect(store.getCell(0, 0)?.hyperlink?.target).toBe('https://example.com');
    expect(store.getCell(0, 0)?.text).toBe('Go');
    set.getUndo().execute(store);
    expect(store.getCell(0, 0)?.hyperlink).toBeUndefined();
    expect(store.getCell(0, 0)?.text).toBe('Click');

    const clear = new SetHyperlinkCommand({ r: 0, c: 0, hyperlink: undefined });
    store.setCell(0, 0, { text: 'x', hyperlink: { target: 'https://a.com' } });
    clear.execute(store);
    expect(store.getCell(0, 0)?.hyperlink).toBeUndefined();
  });
});

  it('resolves quoted sheet names and doubled apostrophes', () => {
    const store = new Store();
    store.addSheet('My Sheet');
    store.addSheet("O'Brien");
    const space = store.getSheets().find((s) => s.name === 'My Sheet')!;
    const apos = store.getSheets().find((s) => s.name === "O'Brien")!;
    expect(resolveHyperlinkTarget(store, { target: "'My Sheet'!A1" })).toEqual({
      kind: 'sheet', sheetId: space.id, r: 0, c: 0,
    });
    expect(resolveHyperlinkTarget(store, { target: "'O''Brien'!B2" })).toEqual({
      kind: 'sheet', sheetId: apos.id, r: 1, c: 1,
    });
  });
