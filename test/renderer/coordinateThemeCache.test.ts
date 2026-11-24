import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssHeaderText, readCanvasTheme, type CanvasTheme } from '../../src/renderer/coordinate';

/** Counts how often coordinate.ts actually hit getComputedStyle. */
let readCount = 0;
let props: Record<string, string> = {};
const computedStyleStub = vi.fn(() => {
  readCount += 1;
  return { getPropertyValue: (name: string) => props[name] ?? '' } as unknown as CSSStyleDeclaration;
});

const theme: CanvasTheme = {
  bg: '#fff', outside: '#f3f3f3', text: '#000000', grid: '#e0e0e0', selected: '#e7f1ea',
  headerBg: '#ececec', accent: '#217346', fontFamily: 'Calibri', border: '#bdbdbd', freezeLine: '#6f6f6f',
};

describe('coordinate theme cache', () => {
  beforeEach(() => {
    props = { '--ss-header-text': '#444444', '--ss-text': '#000000', '--ss-bg': '#ffffff' };
    readCount = 0;
    vi.stubGlobal('getComputedStyle', computedStyleStub);
    // Start from a known cache state: the event invalidates whatever a
    // previous test in this file cached.
    window.dispatchEvent(new CustomEvent('ss:theme-changed'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads getComputedStyle once for a burst of calls in the same frame', () => {
    readCanvasTheme();
    cssHeaderText(theme);
    readCanvasTheme();
    cssHeaderText(theme);

    expect(readCount).toBe(1);
    expect(cssHeaderText(theme)).toBe('#444444');
    expect(readCount).toBe(1);
  });

  it('re-reads and picks up new values after the ss:theme-changed event', () => {
    expect(cssHeaderText(theme)).toBe('#444444');
    expect(readCanvasTheme().text).toBe('#000000');

    props = { '--ss-header-text': '#b3b3b3', '--ss-text': '#f3f3f3' };
    window.dispatchEvent(new CustomEvent('ss:theme-changed'));

    expect(cssHeaderText(theme)).toBe('#b3b3b3');
    expect(readCanvasTheme().text).toBe('#f3f3f3');
    expect(readCount).toBe(2);
  });

  it('re-reads after the one-second safety window even without an event', () => {
    const t0 = 1_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    readCanvasTheme();
    cssHeaderText(theme);

    // Still inside the window: served from cache.
    now.mockReturnValue(t0 + 999);
    readCanvasTheme();
    expect(readCount).toBe(1);

    // Past the window: one fresh read, event or no event.
    now.mockReturnValue(t0 + 1001);
    cssHeaderText(theme);
    expect(readCount).toBe(2);
  });

  it('keeps the fallback constants when the stylesheet omits the tokens', () => {
    props = {};
    window.dispatchEvent(new CustomEvent('ss:theme-changed'));

    const t = readCanvasTheme();
    expect(t.bg).toBe('#fff');
    expect(t.text).toBe('#000000');
    expect(t.headerBg).toBe('#ececec');
    expect(t.accent).toBe('#217346');
    expect(t.fontFamily).toBe('Calibri, "Segoe UI", "Microsoft YaHei", sans-serif');
    expect(t.headerFilter).toBe('#999');
    expect(cssHeaderText(t)).toBe('#444444');
    expect(readCount).toBe(1);
  });
});
