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
    void saveWorkbook(DEFAULT_ID, store.serialize());
  };

  const unsub = store.subscribe(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });

  return {
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
      unsub?.();
    },
  };
}
