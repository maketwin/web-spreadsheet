import type { Store } from '../store/Store';
import { saveWorkbook, DEFAULT_ID } from './WorkbookDB';

const DEBOUNCE_MS = 1500;

export interface AutoSaveHandle {
  readonly stop: () => void;
}

export function startAutoSave(store: Store): AutoSaveHandle {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    timer = undefined;
    // Quota exceeded / private mode / blocked upgrades surface as an error,
    // never an unhandled rejection crashing later unrelated code.
    void saveWorkbook(DEFAULT_ID, store.serialize()).catch((err) => {
      console.error('Auto-save to IndexedDB failed:', err);
    });
  };

  const unsub = store.subscribe(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });

  return {
    stop: () => {
      // Flush whatever the debounce was still holding, then detach.
      if (timer !== undefined) {
        clearTimeout(timer);
        flush();
      }
      unsub();
    },
  };
}
