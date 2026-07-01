import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTheme, setTheme, THEMES } from '../src/theme';

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
});
