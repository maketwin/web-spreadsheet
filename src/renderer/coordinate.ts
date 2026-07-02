export const TOTAL_ROWS = 1_000;
export const TOTAL_COLS = 26;
export const ROW_HEIGHT = 25;
export const COL_WIDTH = 100;
export const ROW_HEADER_WIDTH = 46;
export const COL_HEADER_HEIGHT = 25;

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
  readonly bg: string; readonly text: string; readonly grid: string; readonly selected: string;
  readonly headerBg: string; readonly accent: string; readonly fontFamily: string; readonly border: string;
  readonly headerFilter?: string;
}

export function readCanvasTheme(): CanvasTheme {
  const s = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  return {
    bg: cssV(s, '--ss-bg', '#fff'), text: cssV(s, '--ss-text', '#333'), grid: cssV(s, '--ss-grid', '#f0f0f0'),
    selected: cssV(s, '--ss-selected', '#e8f0ff'), headerBg: cssV(s, '--ss-header-bg', '#f7f7f7'),
    accent: cssV(s, '--ss-accent', '#1677ff'), fontFamily: cssV(s, '--ss-font-family', 'sans-serif'), border: cssV(s, '--ss-border', '#d9d9d9'),
    headerFilter: cssV(s, '--ss-header-filter', '#999'),
  };
}

export function headerSelectionColor(theme: CanvasTheme): string {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', 'color-mix(in srgb, #000 10%, white)') ? `color-mix(in srgb, ${theme.accent} 14%, ${theme.headerBg})` : theme.selected;
}

function cssV(s: CSSStyleDeclaration | null, n: string, f: string): string { return s?.getPropertyValue(n).trim() || f; }
