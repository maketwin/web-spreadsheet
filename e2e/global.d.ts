import type { Store } from '../src/store/Store';

/** Demo debug handle (demo/main.ts) used by e2e store-level assertions. */
declare global {
  interface Window {
    __ss: { store: Store };
  }
}

export {};
