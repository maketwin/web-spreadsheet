import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/store/Store';
import { WORKBOOK_FORMAT_VERSION } from '../../src/db/WorkbookDB';
import type * as WorkbookDBModule from '../../src/db/WorkbookDB';
import type { WorkbookRecord } from '../../src/db/WorkbookDB';
import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS, startAutoSave } from '../../src/db/autoSave';
import type { AutoSaveHandle, AutoSaveOptions } from '../../src/db/autoSave';
import type { SerializedSheetData } from '../../src/store/Store';

const db = vi.hoisted(() => ({ saveWorkbook: vi.fn(), putWorkbookRecord: vi.fn() }));
// Real WorkbookDB exports (DEFAULT_ID, WORKBOOK_FORMAT_VERSION) stay; only the writers are mocked.
vi.mock('../../src/db/WorkbookDB', async () => {
  const actual = await vi.importActual<typeof WorkbookDBModule>('../../src/db/WorkbookDB');
  return { ...actual, saveWorkbook: db.saveWorkbook, putWorkbookRecord: db.putWorkbookRecord };
});

const immediateYield = (): Promise<void> => Promise.resolve();

/** Advances the clock, then one more millisecond: a chunk yield's setTimeout(0)
 * scheduled at the tick this advance lands on is due at exactly `now`, which a
 * zero-width advance would not reach. */
const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(1);
};

function recordOf(index: number): WorkbookRecord {
  return db.putWorkbookRecord.mock.calls[index]![0] as WorkbookRecord;
}
function firstSheet(record: WorkbookRecord): SerializedSheetData {
  return JSON.parse(record.sheets![0]!.data) as SerializedSheetData;
}

describe('autoSave', () => {
  // A failed assertion can skip a test's own stop(); detaching every handle
  // here keeps one red test from leaking listeners into the next one.
  const live: AutoSaveHandle[] = [];
  const tracked = (store: Store, id: string, options?: AutoSaveOptions): AutoSaveHandle => {
    const handle = startAutoSave(store, id, options);
    live.push(handle);
    return handle;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    db.saveWorkbook.mockReset().mockResolvedValue(undefined);
    db.putWorkbookRecord.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    for (const handle of live) handle.stop();
    live.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('saves once after the quiet period with the latest serialization', async () => {
    const store = new Store();
    const handle = tracked(store, 'quiet');
    store.setCell(0, 0, { text: '1', value: 1 });
    store.setCell(0, 1, { text: '2', value: 2 });
    const expected = store.getSheetData()!.serialize();
    await advance(AUTOSAVE_DEBOUNCE_MS);
    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(1);
    const record = recordOf(0);
    expect(record.id).toBe('quiet');
    expect(record.formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
    expect(record.activeSheetId).toBe(store.getActiveSheetId());
    expect(firstSheet(record)).toEqual(expected);
    handle.stop();
  });

  it('still saves while edits keep coming: max wait bounds the first save', async () => {
    const store = new Store();
    const startedAt = Date.now();
    const saveTimes: number[] = [];
    db.putWorkbookRecord.mockImplementation(() => {
      saveTimes.push(Date.now() - startedAt);
      return Promise.resolve();
    });
    const handle = tracked(store, 'busy');
    for (let elapsed = 0; elapsed < 20_000; elapsed += 500) {
      store.setCell(0, elapsed / 500, { text: 'x' });
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(db.putWorkbookRecord.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(saveTimes[0]).toBeGreaterThanOrEqual(AUTOSAVE_DEBOUNCE_MS);
    // The max wait fires the flush at exactly MAX_WAIT; the chunked encode's
    // yield lands the write one fake-timer tick (sinon: now + 1) later.
    expect(saveTimes[0]).toBeLessThanOrEqual(AUTOSAVE_MAX_WAIT_MS + 1);
    handle.stop();
  });

  it('flushes on pagehide only when there is unsaved work', () => {
    const store = new Store();
    const handle = tracked(store, 'leave');
    store.setCell(0, 0, { text: 'a' });
    window.dispatchEvent(new Event('pagehide'));
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
    handle.stop();
    window.dispatchEvent(new Event('pagehide'));
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);

    const idle = tracked(new Store(), 'idle');
    window.dispatchEvent(new Event('pagehide'));
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
    idle.stop();
  });

  it('flushes on visibilitychange only when the page turns hidden', () => {
    const store = new Store();
    const handle = tracked(store, 'tab');
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    store.setCell(0, 0, { text: 'a' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    store.setCell(0, 1, { text: 'b' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('stop flushes once, then nothing saves and the store subscription is gone', async () => {
    const store = new Store();
    const realSubscribe = store.subscribe.bind(store);
    let unsubscribeCalls = 0;
    const subscribeSpy = vi.spyOn(store, 'subscribe').mockImplementation((fn) => {
      const unsub = realSubscribe(fn);
      return () => {
        unsubscribeCalls += 1;
        unsub();
      };
    });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    const handle = tracked(store, 'gone');
    store.setCell(0, 0, { text: 'a' });
    handle.stop();
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);

    store.setCell(0, 1, { text: 'b' });
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS + AUTOSAVE_DEBOUNCE_MS);
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(unsubscribeCalls).toBe(1);
  });

  it('a failed save is logged, never unhandled, and the next window still saves', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.putWorkbookRecord.mockRejectedValueOnce(new Error('quota exceeded'));
    const store = new Store();
    const handle = tracked(store, 'flaky');
    store.setCell(0, 0, { text: 'a' });
    await advance(AUTOSAVE_DEBOUNCE_MS);
    expect(consoleError).toHaveBeenCalledWith('Auto-save to IndexedDB failed:', expect.any(Error));
    store.setCell(0, 1, { text: 'b' });
    await advance(AUTOSAVE_DEBOUNCE_MS);
    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it('saves the latest state again after an in-flight save settles', async () => {
    let resolveSave: () => void = () => undefined;
    db.putWorkbookRecord.mockImplementation(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const store = new Store();
    const handle = tracked(store, 'slow');
    store.setCell(0, 0, { text: 'first' });
    await advance(AUTOSAVE_DEBOUNCE_MS);
    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(1);

    store.setCell(0, 1, { text: 'second' });
    await advance(AUTOSAVE_DEBOUNCE_MS);
    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(1);

    const expected = store.getSheetData()!.serialize();
    resolveSave();
    await advance(AUTOSAVE_DEBOUNCE_MS);
    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(2);
    expect(firstSheet(recordOf(1))).toEqual(expected);
    handle.stop();
  });

  it('pagehide during an in-flight save writes the newer state at once', async () => {
    let resolveFirst: () => void = () => undefined;
    db.putWorkbookRecord.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    const store = new Store();
    const handle = tracked(store, 'leaving');
    store.setCell(0, 0, { text: 'first' });
    await advance(AUTOSAVE_DEBOUNCE_MS);
    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(1);

    // The page may be torn down before the slow write settles: the exit flush
    // must not wait for it, and its synchronous write must land after.
    store.setCell(0, 1, { text: 'second' });
    window.dispatchEvent(new Event('pagehide'));
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
    expect(db.saveWorkbook).toHaveBeenCalledWith('leaving', store.serialize());

    resolveFirst();
    await advance(0);
    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('a pagehide flush is one synchronous write and never yields', () => {
    const yieldFn = vi.fn(immediateYield);
    const store = new Store();
    const handle = tracked(store, 'sync-pagehide', { yieldFn });
    store.setCell(0, 0, { text: 'a' });
    window.dispatchEvent(new Event('pagehide'));
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
    expect(db.saveWorkbook).toHaveBeenCalledWith('sync-pagehide', store.serialize());
    expect(db.putWorkbookRecord).not.toHaveBeenCalled();
    expect(yieldFn).not.toHaveBeenCalled();
    handle.stop();
  });

  it('a visibilitychange flush is one synchronous write and never yields', () => {
    const yieldFn = vi.fn(immediateYield);
    const store = new Store();
    const handle = tracked(store, 'sync-tab', { yieldFn });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    store.setCell(0, 0, { text: 'a' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
    expect(db.saveWorkbook).toHaveBeenCalledWith('sync-tab', store.serialize());
    expect(db.putWorkbookRecord).not.toHaveBeenCalled();
    expect(yieldFn).not.toHaveBeenCalled();
    handle.stop();
  });

  it('stop flushes synchronously in one shot and never yields', () => {
    const yieldFn = vi.fn(immediateYield);
    const store = new Store();
    const handle = tracked(store, 'sync-stop', { yieldFn });
    store.setCell(0, 0, { text: 'a' });
    handle.stop();
    expect(db.saveWorkbook).toHaveBeenCalledTimes(1);
    expect(db.saveWorkbook).toHaveBeenCalledWith('sync-stop', store.serialize());
    expect(db.putWorkbookRecord).not.toHaveBeenCalled();
    expect(yieldFn).not.toHaveBeenCalled();
  });

  it('a change made during the encode lands in a follow-up round, not the running one', async () => {
    const store = new Store();
    let mutated = false;
    const yieldFn = vi.fn(async () => {
      if (!mutated) {
        mutated = true;
        store.setCell(0, 0, { text: 'changed' });
      }
    });
    const handle = tracked(store, 'midround', { yieldFn });
    store.setCell(0, 0, { text: 'original' });
    const snapshotCells = store.getSheetData()!.serialize().cells;
    await advance(AUTOSAVE_DEBOUNCE_MS);
    await advance(AUTOSAVE_DEBOUNCE_MS); // the follow-up round for the mid-encode change

    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(2);
    expect(firstSheet(recordOf(0)).cells).toEqual(snapshotCells); // snapshot state
    expect(firstSheet(recordOf(1)).cells).toEqual([['0,0', { text: 'changed' }]]);
    handle.stop();
  });

  it('a workbook replace during the encode voids the round and saves the new workbook', async () => {
    const store = new Store();
    const fresh = new Store();
    fresh.setCell(0, 0, { text: 'new workbook' });
    const freshData = fresh.serialize();
    let replaced = false;
    const yieldFn = vi.fn(async () => {
      if (!replaced) {
        replaced = true;
        store.replaceAll(freshData);
      }
    });
    const handle = tracked(store, 'replaced', { yieldFn });
    store.setCell(0, 0, { text: 'old workbook' });
    await advance(AUTOSAVE_DEBOUNCE_MS);
    await advance(AUTOSAVE_DEBOUNCE_MS); // the follow-up round for the replace

    // The voided round never wrote; the follow-up wrote the new workbook in full.
    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(1);
    const record = recordOf(0);
    expect(record.activeSheetId).toBe(freshData.activeSheetId);
    expect(record.sheets).toHaveLength(1);
    expect(firstSheet(record).cells).toEqual(freshData.sheets[0]!.data.cells);
    handle.stop();
  });

  it('sheets renamed, added, or deleted during the encode land in the record', async () => {
    const store = new Store();

    // A rename and a new sheet arrive mid-encode: the record carries the new
    // sheet array, the new sheet encoded, the snapshot content unchanged.
    let structured = false;
    const yieldFn = vi.fn(async () => {
      if (!structured) {
        structured = true;
        store.renameSheet('sheet-1', 'Renamed');
        const added = store.addSheet('Extra');
        store.setCell(0, 0, { text: 'brand new' }, added);
      }
    });
    const handle = tracked(store, 'struct', { yieldFn });
    store.setCell(0, 0, { text: 'a' });
    await advance(AUTOSAVE_DEBOUNCE_MS);
    await advance(AUTOSAVE_DEBOUNCE_MS); // follow-up round for the mid-encode events
    const first = recordOf(0);
    expect(first.sheets).toHaveLength(2);
    expect(first.sheets![0]).toMatchObject({ id: 'sheet-1', name: 'Renamed' });
    expect(first.sheets![1]).toMatchObject({ name: 'Extra' });
    expect(firstSheet(first).cells).toEqual([['0,0', { text: 'a' }]]);
    handle.stop();

    // The added sheet is then deleted mid-encode: it leaves the record.
    const second = store.getSheets().find((sheet) => sheet.name === 'Extra')!.id;
    let deleted = false;
    const deleteYield = vi.fn(async () => {
      if (!deleted) {
        deleted = true;
        store.deleteSheet(second);
      }
    });
    db.putWorkbookRecord.mockClear();
    const handle2 = tracked(store, 'struct', { yieldFn: deleteYield });
    store.setCell(1, 1, { text: 'a2' });
    await advance(AUTOSAVE_DEBOUNCE_MS);
    await advance(AUTOSAVE_DEBOUNCE_MS);
    const last = recordOf(db.putWorkbookRecord.mock.calls.length - 1);
    expect(last.sheets).toHaveLength(1);
    expect(last.sheets![0]).toMatchObject({ id: 'sheet-1', name: 'Renamed' });
    handle2.stop();
  });

  it('works headless without window/document', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    const store = new Store();
    const handle = tracked(store, 'headless');
    store.setCell(0, 0, { text: 'a' });
    await advance(AUTOSAVE_DEBOUNCE_MS);
    expect(db.putWorkbookRecord).toHaveBeenCalledTimes(1);
    handle.stop();
  });
});
