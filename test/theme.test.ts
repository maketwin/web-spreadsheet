import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyStoredTheme, getTheme, setTheme, THEMES } from '../src/theme';

/** Runs `fn` while counting `ss:theme-changed` events on window. */
function countThemeEvents(fn: () => void): number {
  let count = 0;
  const listener = (): void => { count += 1; };
  window.addEventListener('ss:theme-changed', listener);
  try { fn(); } finally { window.removeEventListener('ss:theme-changed', listener); }
  return count;
}

describe('theme utilities', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-spreadsheet-theme');
    vi.unstubAllGlobals();
  });

  it('persists the selected theme', () => {
    setTheme('dark');

    expect(localStorage.getItem('web-spreadsheet-theme')).toBe('dark');
  });

  it('updates the document theme attribute', () => {
    setTheme('light');

    expect(document.documentElement.getAttribute('data-spreadsheet-theme')).toBe('light');
  });

  it('returns a stored theme when present', () => {
    localStorage.setItem('web-spreadsheet-theme', 'dark');

    expect(getTheme()).toBe('dark');
  });

  it('falls back to prefers-color-scheme when no stored theme exists', () => {
    vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    expect(getTheme()).toBe('dark');
  });

  it('contains light and dark theme constants', () => {
    expect(THEMES).toEqual({ light: 'light', dark: 'dark' });
  });

  it('setTheme dispatches exactly one ss:theme-changed so the canvas repaints', () => {
    expect(countThemeEvents(() => setTheme('dark'))).toBe(1);
  });

  it('applyStoredTheme dispatches exactly one ss:theme-changed', () => {
    localStorage.setItem('web-spreadsheet-theme', 'light');
    expect(countThemeEvents(() => applyStoredTheme())).toBe(1);
  });

  it('does not touch window events when no window exists (headless core stays loadable)', () => {
    vi.stubGlobal('window', undefined);
    // The guard must make this a no-op instead of throwing on window.dispatchEvent.
    expect(() => setTheme('dark')).not.toThrow();
    expect(document.documentElement.getAttribute('data-spreadsheet-theme')).toBe('dark');
  });
});
