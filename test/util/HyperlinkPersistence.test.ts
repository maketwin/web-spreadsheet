import { describe, expect, it } from 'vitest';
import { cellFromText } from '../../src/util/cell';
import { Store } from '../../src/store/Store';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { SetHyperlinkCommand } from '../../src/commands/impl/SetHyperlink';

/** Editing a hyperlink cell's text keeps the link (Excel); clearing the
 * content drops it. Regression: every text commit used to strip the link,
 * so the link vanished as soon as the cell editor lost focus. */
describe('hyperlink persistence across text commits', () => {
  it('cellFromText keeps the hyperlink when the text changes', () => {
    const cell = { text: 'Example', hyperlink: { target: 'https://example.com' } };
    const next = cellFromText(cell, 'Renamed');
    expect(next.text).toBe('Renamed');
    expect(next.hyperlink?.target).toBe('https://example.com');
  });

  it('cellFromText drops the hyperlink when the text is cleared', () => {
    const cell = { text: 'Example', hyperlink: { target: 'https://example.com' } };
    expect(cellFromText(cell, '').hyperlink).toBeUndefined();
  });

  it('SetCellText commit keeps the link', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute(new SetHyperlinkCommand({ r: 0, c: 0, hyperlink: { target: 'https://example.com' }, displayText: 'Example' }));
    expect(store.getCell(0, 0)?.hyperlink?.target).toBe('https://example.com');

    cm.execute(new SetCellText({ r: 0, c: 0, text: 'Edited label' }));
    expect(store.getCell(0, 0)?.text).toBe('Edited label');
    expect(store.getCell(0, 0)?.hyperlink?.target).toBe('https://example.com');
  });

  it('SetHyperlinkCommand with hyperlink undefined still removes the link', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute(new SetHyperlinkCommand({ r: 0, c: 0, hyperlink: { target: 'https://example.com' } }));
    cm.execute(new SetHyperlinkCommand({ r: 0, c: 0, hyperlink: undefined }));
    expect(store.getCell(0, 0)?.hyperlink).toBeUndefined();
  });
});
