import type { Store } from '../store/Store';
import { saveWorkbook, DEFAULT_ID } from './WorkbookDB';
import { WorkbookEncoder, type WorkbookSnapshot } from './workbookEncoder';

/** Quiet period after the latest change before a save fires. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;
/**
 * Cap on how long the first unsaved change may stay unsaved, even while the
 * user keeps editing (a steady edit stream used to starve the debounce).
 */
export const AUTOSAVE_MAX_WAIT_MS = 5000;

export interface AutoSaveHandle {
  readonly stop: () => void;
}

/** Injection point for tests: background encodes yield through it between chunks. */
export interface AutoSaveOptions {
  readonly yieldFn?: (() => Promise<void>) | undefined;
}

export function startAutoSave(store: Store, id: string = DEFAULT_ID, options: AutoSaveOptions = {}): AutoSaveHandle {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = false; // changes not yet handed to the encoder / saveWorkbook
  let inFlight = 0; // save calls still running
  let stopped = false;
  // Tracks which sheets changed since the last successful commit and encodes
  // them chunk by chunk; unchanged sheets reuse their committed JSON string.
  const encoder = new WorkbookEncoder(store, options.yieldFn);

  const clearTimers = (): void => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    if (maxWaitTimer !== undefined) clearTimeout(maxWaitTimer);
    debounceTimer = undefined;
    maxWaitTimer = undefined;
  };

  const schedule = (): void => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    // Anchored on the first unsaved change, not the latest one.
    if (maxWaitTimer === undefined) maxWaitTimer = setTimeout(flush, AUTOSAVE_MAX_WAIT_MS);
  };

  const runWrite = (write: Promise<void>, snapshot: WorkbookSnapshot | undefined): void => {
    inFlight += 1;
    // Quota exceeded / private mode / blocked upgrades surface as an error,
    // never an unhandled rejection crashing later unrelated code. The failed
    // round's sheets stay dirty (or are put back), so the next window retries.
    void write
      .catch((err) => {
        console.error('Auto-save to IndexedDB failed:', err);
        if (snapshot !== undefined) encoder.redirty(snapshot);
      })
      .finally(() => {
        inFlight -= 1;
        if (pending && inFlight === 0) {
          if (stopped) flush(true); // stop() left no timers; finish synchronously without them
          else schedule();
        }
      });
  };

  const flush = (leaving = false): void => {
    clearTimers();
    // One write at a time: a change landing meanwhile keeps the dirty mark, and
    // the running save's finally schedules the next one. Leaving the page is
    // the exception — that may be the last chance to write. It writes in one
    // synchronous shot (a long task, as before): a chunked round cannot be
    // trusted to get its put created before teardown, and IndexedDB commits
    // puts to one record in creation order, so the newer snapshot wins.
    if (!pending || (inFlight > 0 && !leaving)) return;
    pending = false;
    if (leaving) {
      encoder.noteLeaving(); // voids any background round still mid-encode
      runWrite(saveWorkbook(id, store.serialize()), undefined);
      return;
    }
    const snapshot = encoder.snapshot();
    runWrite((async () => {
      const strings = await encoder.encode(snapshot);
      if (strings === null) {
        // Superseded (workbook replace / full write): the events that
        // superseded us already re-marked everything; re-mark the snapshot's
        // sheets too so nothing relies on the aborted round.
        encoder.redirty(snapshot);
        return;
      }
      const written = await encoder.commitPut(id, snapshot, strings);
      if (!written) encoder.redirty(snapshot);
    })(), snapshot);
  };

  // Closing / switching tabs must not lose the last debounce window.
  const onPageHide = (): void => flush(true);
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') flush(true);
  };
  // Headless Node use has neither; listeners just don't exist there.
  const win = typeof window === 'undefined' ? undefined : window;
  const doc = typeof document === 'undefined' ? undefined : document;
  win?.addEventListener('pagehide', onPageHide);
  doc?.addEventListener('visibilitychange', onVisibilityChange);

  const unsub = store.subscribe((event) => {
    // Per-sheet dirty tracking: content events name their sheet; structure
    // events (add/delete/rename/move/recolor) only rebuild the record's sheet
    // array — except add, whose sheet has no committed string yet; a workbook
    // replace voids everything. The password is a workbook-level field the
    // record re-reads on every save.
    if (event.type === 'workbook') encoder.noteReplaced();
    else if (event.type === 'sheet') {
      encoder.noteStructure();
      if (event.action === 'add') encoder.noteChange(event.sheetId);
    } else if (event.type !== 'workbookPassword') {
      encoder.noteChange(event.sheetId);
    }
    pending = true;
    schedule();
  });

  return {
    stop: () => {
      stopped = true;
      clearTimers();
      win?.removeEventListener('pagehide', onPageHide);
      doc?.removeEventListener('visibilitychange', onVisibilityChange);
      unsub();
      // Flush whatever was still unsaved, synchronously like any leaving
      // write; a running background save picks the rest up in its finally.
      if (inFlight === 0) flush(true);
    },
  };
}
