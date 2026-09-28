/**
 * jsdom lacks browser APIs antd 6 popups (@rc-component/trigger align,
 * CSSMotion media queries) depend on. Assigned directly (not vi.stubGlobal)
 * so per-test `vi.unstubAllGlobals()` in cleanup cannot strip them.
 */
class ResizeObserverStub implements Partial<ResizeObserver> {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

if (typeof globalThis.matchMedia === 'undefined') {
  (globalThis as { matchMedia?: unknown }).matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}
