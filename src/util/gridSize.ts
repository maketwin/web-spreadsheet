/**
 * Grid geometry. Lives in util/ (below every feature layer) so the formula
 * engine, commands and renderer can share them without the formula or command
 * layers reaching into the renderer for constants.
 *
 * The address space is Excel's: rows 1 … 1,048,576 and columns A … XFD. It is
 * an address space, not an allocation — nothing may loop over it. Code that
 * walks cells goes through the stored ones (`Store.forEachCell`) or the
 * visible ones; see `limits.ts` for the ceilings on materialising cells.
 */
export const TOTAL_ROWS = 1_048_576;
export const TOTAL_COLS = 16_384;
export const ROW_HEIGHT = 20;
export const COL_WIDTH = 64;
export const ROW_HEADER_WIDTH = 46;
export const COL_HEADER_HEIGHT = 20;
