// Const assertion preserves literal values for the Theme union.
export const THEMES = { light: 'light', dark: 'dark' } as const;
export type Theme = (typeof THEMES)[keyof typeof THEMES];

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-spreadsheet-theme', theme);
  // Storage can be unavailable (private windows, sandboxed iframes): the
  // theme still applies, it just is not remembered.
  try {
    localStorage.setItem('web-spreadsheet-theme', theme);
  } catch { /* not persisted */ }
  dispatchThemeChanged();
}

/** Canvas repaint hooks (CanvasRenderer, the coordinate theme cache,
 * FloatingChart) listen for this on window. Hosts that call the public
 * setTheme get the same repaint the in-app theme switch triggers. Guarded:
 * the headless ./core build must stay loadable where no window exists. */
function dispatchThemeChanged(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new Event('ss:theme-changed'));
}

export function getTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('web-spreadsheet-theme');
  } catch { /* fall through to the system preference */ }
  if (stored === 'light' || stored === 'dark') return stored;
  const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function applyStoredTheme(): void {
  setTheme(getTheme());
}
