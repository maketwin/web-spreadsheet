// Const assertion preserves literal values for the Theme union.
export const THEMES = { light: 'light', dark: 'dark' } as const;
export type Theme = (typeof THEMES)[keyof typeof THEMES];

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-spreadsheet-theme', theme);
  localStorage.setItem('web-spreadsheet-theme', theme);
}

export function getTheme(): Theme {
  const stored = localStorage.getItem('web-spreadsheet-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyStoredTheme(): void {
  setTheme(getTheme());
}
