import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import type { Spreadsheet as SpreadsheetFacade, SpreadsheetOptions } from '../../src/components/Spreadsheet';
import type * as AutoSaveModule from '../../src/db/autoSave';

const db = vi.hoisted(() => ({ saveWorkbook: vi.fn(), loadWorkbook: vi.fn(), deleteWorkbook: vi.fn() }));
vi.mock('../../src/db/WorkbookDB', () => ({ ...db, DEFAULT_ID: 'default' }));
const autoSave = vi.hoisted(() => ({ startAutoSave: vi.fn() }));
vi.mock('../../src/db/autoSave', () => autoSave);

const { Spreadsheet, SpreadsheetComponent } = await import('../../src/components/Spreadsheet');

// Auto-save used to be unconditional and single-slot: every instance on an
// origin wrote the same IndexedDB record, and one started without data
// restored whatever had been left there.
function installCanvasContext(): void {
  const ctx = { beginPath: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), rect: vi.fn(), restore: vi.fn(), save: vi.fn(), scale: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), strokeRect: vi.fn() } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  // Park animation frames: rendering is not under test here.
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
}

async function mount(options: SpreadsheetOptions): Promise<SpreadsheetFacade> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const sheet = new Spreadsheet(host, options);
  sheet.mount();
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
  return sheet;
}

describe('storage option', () => {
  beforeEach(() => {
    installCanvasContext();
    autoSave.startAutoSave.mockReset().mockReturnValue({ stop: vi.fn() });
    db.saveWorkbook.mockReset().mockResolvedValue(undefined);
    db.loadWorkbook.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
  });
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('auto-saves to the given record', async () => {
    vi.useFakeTimers();
    try {
      const { startAutoSave } = await vi.importActual<typeof AutoSaveModule>('../../src/db/autoSave');
      const store = new Store();
      const handle = startAutoSave(store, 'oa-report');
      store.setCell(0, 0, { text: '1', value: 1 });
      store.setCell(0, 1, { text: '2', value: 2 });
      vi.advanceTimersByTime(1500);
      handle.stop();
      expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
      expect(db.saveWorkbook.mock.calls[0]?.[0]).toBe('oa-report');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is wired from the component: on by default, off with false, keyed with a key', () => {
    autoSave.startAutoSave.mockClear();
    const a = render(<SpreadsheetComponent store={new Store()} theme={false} />);
    expect(autoSave.startAutoSave).toHaveBeenLastCalledWith(expect.any(Store), undefined);
    a.unmount();
    const b = render(<SpreadsheetComponent store={new Store()} theme={false} storage={{ key: 'oa-report' }} />);
    expect(autoSave.startAutoSave).toHaveBeenLastCalledWith(expect.any(Store), 'oa-report');
    b.unmount();
    autoSave.startAutoSave.mockClear();
    const c = render(<SpreadsheetComponent store={new Store()} theme={false} storage={false} />);
    expect(autoSave.startAutoSave).not.toHaveBeenCalled();
    c.unmount();
    const d = render(<SpreadsheetComponent store={new Store()} theme={false} storage={{ enabled: false }} />);
    expect(autoSave.startAutoSave).not.toHaveBeenCalled();
    d.unmount();
  });

  it('restores the record with the given key — and nothing when storage is off or data is passed', async () => {
    await mount({ storage: { key: 'oa-report' }, theme: false });
    expect(db.loadWorkbook).toHaveBeenLastCalledWith('oa-report');
    await mount({ storage: false, theme: false });
    expect(db.loadWorkbook).toHaveBeenCalledTimes(1);
    await mount({ theme: false });
    expect(db.loadWorkbook).toHaveBeenLastCalledWith('default');
    db.loadWorkbook.mockClear();
    await mount({ data: [[{ text: 'x' }]], storage: { key: 'never' }, theme: false });
    expect(db.loadWorkbook).not.toHaveBeenCalled();
  });

  it('restores a saved workbook into the sheet when no data is given', async () => {
    const saved = new Store();
    saved.setCell(0, 0, { text: 'restored' });
    saved.setCell(0, 1, { text: '=A1&"!"', formula: '=A1&"!"' });
    db.loadWorkbook.mockResolvedValue(saved.serialize());
    const sheet = await mount({ theme: false });
    expect(sheet.store.getCell(0, 0)?.text).toBe('restored');
    expect(sheet.store.getCell(0, 1)?.value).toBe('restored!');
  });
});
