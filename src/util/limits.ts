/**
 * Ceilings on materialising cells. The address space is Excel's (gridSize.ts),
 * so an address is cheap but a cell is not: anything that would create or
 * expand cells — a paste tiled over a selection, a fill dragged down a column,
 * a range reference read into one array — stops at these numbers.
 */

/**
 * Cells one paste or fill may write. Excel repeats a copied block until it
 * has filled a selection that is an exact multiple of it, even when that
 * selection is a whole column; here the paste lands once at the anchor and a
 * fill stops at this many cells instead.
 */
export const MAX_MATERIALIZED_CELLS = 250_000;

/**
 * Cells one range reference may be read into a single dense array. A larger
 * range is still exact: aggregates (SUM, COUNT, …) walk the cells that exist,
 * and the other functions answer `#VALUE!` rather than allocate.
 */
export const MAX_DENSE_RANGE_CELLS = 2_000_000;

/**
 * Empty addresses the xlsx worksheet writer may additionally walk during one
 * export before the sheet switches to the packed-export path (XlsxExporter).
 * SheetJS writes every address of the `!ref` rectangle, so a workbook whose
 * only two cells sit at A1 and XFD1048576 would keep the writer busy for
 * hours; beyond this budget the stored cells are packed into a dense block
 * for the write and their real coordinates are restored into the sheet XML
 * afterwards, which keeps the walk at one address per stored cell. Ordinary
 * workbooks never come near the budget and take the plain path unchanged.
 */
export const MAX_DENSE_EXPORT_EMPTY_CELLS = 1_000_000;
