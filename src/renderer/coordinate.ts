import { COL_HEADER_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';

// Re-exported so existing renderer-oriented importers keep working; the
// definitions live in util/gridSize (shared by non-renderer layers).
export { TOTAL_ROWS, TOTAL_COLS, ROW_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, COL_HEADER_HEIGHT } from '../util/gridSize';

export interface CellAddress { readonly r: number; readonly c: number }

export function canvasPointToCell(canvas: HTMLCanvasElement, clientX: number, clientY: number, scrollLeft = 0, scrollTop = 0, zoom = 100): CellAddress | null {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left - ROW_HEADER_WIDTH + scrollLeft;
  const y = clientY - rect.top - COL_HEADER_HEIGHT + scrollTop;
  const scale = zoom / 100;
  if (x < 0 || y < 0) return null;
  return { r: Math.floor(y / (ROW_HEIGHT * scale)), c: Math.floor(x / (COL_WIDTH * scale)) };
}

export type HeaderHit = { type: 'sheet' } | { type: 'column'; c: number } | { type: 'row'; r: number } | null;

export function canvasPointToHeader(canvas: HTMLCanvasElement, clientX: number, clientY: number, scrollLeft = 0, scrollTop = 0, zoom = 100): HeaderHit {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const c = canvasPointToColumn(canvas, clientX, scrollLeft, zoom);
  const r = canvasPointToRow(canvas, clientY, scrollTop, zoom);
  if (x >= 0 && x < ROW_HEADER_WIDTH && y >= 0 && y < COL_HEADER_HEIGHT) return { type: 'sheet' };
  if (y >= 0 && y < COL_HEADER_HEIGHT && c !== null) return { type: 'column', c };
  if (x >= 0 && x < ROW_HEADER_WIDTH && r !== null) return { type: 'row', r };
  return null;
}

export function canvasPointToColumn(canvas: HTMLCanvasElement, clientX: number, scrollLeft = 0, zoom = 100): number | null {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left - ROW_HEADER_WIDTH + scrollLeft;
  const scale = zoom / 100;
  if (x < 0) return null;
  return clamp(Math.floor(x / (COL_WIDTH * scale)), 0, TOTAL_COLS - 1);
}

export function canvasPointToRow(canvas: HTMLCanvasElement, clientY: number, scrollTop = 0, zoom = 100): number | null {
  const rect = canvas.getBoundingClientRect();
  const y = clientY - rect.top - COL_HEADER_HEIGHT + scrollTop;
  const scale = zoom / 100;
  if (y < 0) return null;
  return clamp(Math.floor(y / (ROW_HEIGHT * scale)), 0, TOTAL_ROWS - 1);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface CanvasTheme {
  readonly bg: string; readonly outside: string; readonly text: string; readonly grid: string; readonly selected: string;
  readonly headerBg: string; readonly accent: string; readonly fontFamily: string; readonly border: string; readonly freezeLine: string;
  readonly headerFilter?: string;
}

/** getComputedStyle is too expensive to pay per header cell per frame, so the
 * theme read from the CSS custom properties on `<html>` is cached in module
 * scope. The cache is invalidated by the `ss:theme-changed` event dispatched
 * on theme switches (components/Spreadsheet.tsx) and, as a safety net for
 * hosts that flip `data-spreadsheet-theme` without the event, re-read at most
 * once per second. One module-level listener installed lazily — callers never
 * subscribe, so there is no per-instance leak; without a `document` the
 * fallback literals apply as before. */
interface ThemeSnapshot { readonly theme: CanvasTheme; readonly headerText: string; readonly readAt: number }
const THEME_RECHECK_MS = 1000;
let themeCache: ThemeSnapshot | null = null;
let themeListenerInstalled = false;

function ensureThemeListener(): void {
  if (themeListenerInstalled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  themeListenerInstalled = true;
  window.addEventListener('ss:theme-changed', () => { themeCache = null; });
}

/** Cache hit within the re-check window; otherwise one fresh getComputedStyle read. */
function currentThemeSnapshot(): ThemeSnapshot | null {
  if (typeof document === 'undefined') return null;
  ensureThemeListener();
  const now = Date.now();
  if (themeCache !== null && now - themeCache.readAt < THEME_RECHECK_MS) return themeCache;
  const s = getComputedStyle(document.documentElement);
  themeCache = { theme: readThemeFrom(s), headerText: s.getPropertyValue('--ss-header-text').trim() || '#444444', readAt: now };
  return themeCache;
}

function readThemeFrom(s: CSSStyleDeclaration | null): CanvasTheme {
  return {
    bg: cssV(s, '--ss-bg', '#fff'), outside: cssV(s, '--ss-outside', '#f3f3f3'), text: cssV(s, '--ss-text', '#000000'), grid: cssV(s, '--ss-grid', '#e0e0e0'),
    selected: cssV(s, '--ss-selected', '#e7f1ea'), headerBg: cssV(s, '--ss-header-bg', '#ececec'),
    accent: cssV(s, '--ss-accent', '#217346'), fontFamily: cssV(s, '--ss-font-family', 'Calibri, "Segoe UI", "Microsoft YaHei", sans-serif'), border: cssV(s, '--ss-border', '#bdbdbd'), freezeLine: cssV(s, '--ss-freeze-line', '#6f6f6f'),
    headerFilter: cssV(s, '--ss-header-filter', '#999'),
  };
}

export function readCanvasTheme(): CanvasTheme {
  if (typeof document === 'undefined') return readThemeFrom(null);
  return currentThemeSnapshot()!.theme;
}

export function headerSelectionColor(theme: CanvasTheme): string {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', 'color-mix(in srgb, #000 10%, white)') ? `color-mix(in srgb, ${theme.accent} 14%, ${theme.headerBg})` : theme.selected;
}

/** Excel column/row header label color (dark gray in the light theme, light
 * gray in the dark theme via `--ss-header-text`). Shared by header painting
 * and AutoFilter chrome; served from the cached theme snapshot. */
export function cssHeaderText(_theme: CanvasTheme): string {
  const snap = currentThemeSnapshot();
  return snap === null ? '#444444' : snap.headerText;
}

function cssV(s: CSSStyleDeclaration | null, n: string, f: string): string { return s?.getPropertyValue(n).trim() || f; }
