import { describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import type { SerializedStore } from '../../src/store/Store';
import { caretOffsetAtClick } from '../../src/components/EditorOverlay';

/**
 * GUI regression (2026-09-28): a corrupt autosave blob (sheet data missing
 * its `cells` array — e.g. saved from a half-dead HMR page) aborted
 * `replaceAll` AFTER `sheets.clear()` but BEFORE the activeSheetId fixup.
 * The demo's restore `.catch` swallowed the error, leaving the store
 * permanently inconsistent: every subsequent read threw
 * `Unknown sheet: sheet-1` — a canvas double-click crashed the whole React
 * tree ("画布点击没有任何反应").
 */
describe('replaceAll atomicity', () => {
  it('a corrupt sheet aborts the swap with the live store untouched', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'alive' });

    const bad = {
      activeSheetId: 'restored-1',
      sheets: [
        { id: 'restored-1', name: 'Good', data: emptySheetData() },
        // Missing `cells` etc. — SheetData.deserialize throws on `.forEach`.
        { id: 'restored-2', name: 'Bad', data: {} as never },
      ],
    } as unknown as SerializedStore;

    expect(() => store.replaceAll(bad)).toThrow();

    // The original sheet and active id survive untouched — no half-cleared maps.
    expect(store.getSheets().map((s) => s.id)).toEqual(['sheet-1']);
    expect(store.getActiveSheetId()).toBe('sheet-1');
    expect(store.getCell(0, 0)?.text).toBe('alive');
  });

  it('a valid swap still replaces sheets and fixes up the active id', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'old' });

    store.replaceAll({
      activeSheetId: 'restored-1',
      sheets: [
        { id: 'restored-1', name: 'Restored', data: emptySheetData('0,0', { text: 'new' }) },
      ],
    });

    expect(store.getSheets().map((s) => s.id)).toEqual(['restored-1']);
    expect(store.getActiveSheetId()).toBe('restored-1');
    expect(store.getCell(0, 0)?.text).toBe('new');
  });

  it('falls back to the first sheet when the saved active id is gone', () => {
    const store = new Store();
    store.replaceAll({
      activeSheetId: 'missing-id',
      sheets: [
        { id: 'a', name: 'A', data: emptySheetData() },
        { id: 'b', name: 'B', data: emptySheetData() },
      ],
    });
    expect(store.getActiveSheetId()).toBe('a');
  });
});

describe('caretOffsetAtClick resilience', () => {
  it('returns 0 instead of throwing when the store is inconsistent', () => {
    const brokenStore = {
      getCell: () => { throw new Error('Unknown sheet: sheet-1'); },
    } as unknown as Store;
    expect(caretOffsetAtClick(null, brokenStore, { r: 0, c: 0 }, 10, 10, 100)).toBe(0);
  });

  it('reads through a healthy store without touching the renderer for empty cells', () => {
    const store = new Store(); // (0,0) empty → early return 0, renderer untouched
    const renderer = { getCellViewportRect: vi.fn() } as never;
    expect(caretOffsetAtClick(renderer, store, { r: 0, c: 0 }, 10, 10, 100)).toBe(0);
    expect((renderer as unknown as { getCellViewportRect: ReturnType<typeof vi.fn> }).getCellViewportRect).not.toHaveBeenCalled();
  });
});

function emptySheetData(seedKey?: string, cell?: { text: string }): ReturnType<() => SerializedStore['sheets'][number]['data']> {
  return {
    cells: seedKey !== undefined && cell !== undefined ? [[seedKey, cell]] : [],
    rows: [],
    cols: [],
    styles: [],
    merges: [],
    conditionalRules: [],
    charts: [],
    images: [],
    validationRules: [],
    sparklines: [],
    namedRanges: [],
    rowGroups: [],
  };
}
