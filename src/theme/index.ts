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
