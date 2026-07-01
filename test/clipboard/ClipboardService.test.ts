import { describe, expect, it, vi } from 'vitest';
import { ClipboardService } from '../../src/clipboard/ClipboardService';
import { Store } from '../../src/store/Store';

describe('ClipboardService', () => {
  it('copy writes TSV fallback text', async () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'A1' });
    store.setCell(0, 1, { text: 'B1' });
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) } as Pick<Clipboard, 'writeText'> as Clipboard;

    await ClipboardService.copy(store, { r1: 0, c1: 0, r2: 0, c2: 1 }, clipboard);

    expect(clipboard.writeText).toHaveBeenCalledWith('A1\tB1');
  });

  it('parses TSV into cells', () => {
    const cells = ClipboardService.parseText('1\tTwo\n3\t4');

    expect(cells[0]?.[0]).toMatchObject({ text: '1', value: 1 });
    expect(cells[0]?.[1]).toMatchObject({ text: 'Two' });
    expect(cells[1]?.[1]).toMatchObject({ text: '4', value: 4 });
  });

  it('creates HTML table payload', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '<A1>' });

    const payload = ClipboardService.createPayload(store, { r1: 0, c1: 0, r2: 0, c2: 0 });

    expect(payload?.html).toBe('<table><tr><td>&lt;A1&gt;</td></tr></table>');
  });

  it('returns null for empty selection', () => {
    const store = new Store();

    expect(ClipboardService.createPayload(store, { r1: 1, c1: 1, r2: 0, c2: 0 })).toBeNull();
  });
});
