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
