/** Demo debug handle (demo/main.ts) used by e2e store-level assertions. */
declare global {
  interface Window {
    __ss: { store: import('../src/store/Store').Store };
  }
}

export {};
