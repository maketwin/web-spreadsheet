/**
 * Fixed grid geometry. Lives in util/ (below every feature layer) so the
 * formula engine, commands and renderer can share it without the formula or
 * command layers reaching into the renderer for constants.
 */
export const TOTAL_ROWS = 1_000;
export const TOTAL_COLS = 26;
export const ROW_HEIGHT = 20;
export const COL_WIDTH = 64;
export const ROW_HEADER_WIDTH = 46;
export const COL_HEADER_HEIGHT = 20;
