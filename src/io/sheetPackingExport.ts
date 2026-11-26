import { strFromU8, strToU8 } from 'fflate';
import { num2alpha } from '../util/alphabet';
import { TOTAL_COLS } from '../util/gridSize';

/**
 * Packed export for sparse sheets. SheetJS's worksheet writer touches every
 * address of the `!ref` rectangle, so when the stored cells leave more empty
 * addresses than `MAX_DENSE_EXPORT_EMPTY_CELLS` the exporter instead lays them
 * out densely (the k-th cell at `(floor(k / width), k % width)`) and this
 * module restores the real coordinates in the written sheet part afterwards —
 * cell `r=` attributes, `<hyperlink ref>`s, and the extent metadata
 * (`<dimension>`, the ignoredErrors sqref) that SheetJS derives from `!ref`.
 * The path only triggers on spread-out sheets; ordinary workbooks are written
 * as-is.
 */

/** How one sheet's packed coordinates map back to real ones. */
export interface SheetPackPlan {
  /** Packed columns per row: the k-th cell sits at `(floor(k / width), k % width)`. */
  readonly width: number;
  /** Real `row * TOTAL_COLS + col` key of the k-th packed cell, in ascending (row, col) order. */
  readonly realKeys: readonly number[];
  /** The sheet's true used rectangle, written back into `<dimension>`. */
  readonly bounds: { readonly r1: number; readonly c1: number; readonly r2: number; readonly c2: number };
}

/** Rewrite every packed sheet part in the file table back to real coordinates. */
export function restorePackedSheets(files: Record<string, Uint8Array>, packs: Map<number, SheetPackPlan>): void {
  for (const [index, plan] of packs) {
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    const part = files[path];
    if (part === undefined) continue;
    files[path] = strToU8(restoreSheetXml(strFromU8(part), plan));
  }
}

/** One `<c>` element, self-closing or with content — the same shape patchSheetCells matches. */
const CELL_ELEMENT = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;

/** `r="AB12"` open-tag attribute of a cell: column letters + 1-based row. */
const CELL_REF = /\br="([A-Z]+)(\d+)"/;

/** `ref="AB12"` attribute of a `<hyperlink>` tag. */
const HYPERLINK_REF = /\bref="([A-Z]+)(\d+)"/;

function restoreSheetXml(xml: string, plan: SheetPackPlan): string {
  const head = '<sheetData>';
  const start = xml.indexOf(head);
  const end = xml.lastIndexOf('</sheetData>');
  if (start < 0 || end < start) return xml;
  const body = xml.slice(start + head.length, end);

  // Lookup tables built once for the whole part, never per fragment: packed
  // column letters → packed column index, packed serial k → real A1 address.
  const packedCol = new Map<string, number>();
  for (let c = 0; c < plan.width; c += 1) packedCol.set(num2alpha(c), c);
  const realAddr = plan.realKeys.map((key) => `${num2alpha(key % TOTAL_COLS)}${Math.floor(key / TOTAL_COLS) + 1}`);
  // Packed serial k → real row, for regrouping the fragments.
  const realRow = plan.realKeys.map((key) => Math.floor(key / TOTAL_COLS));

  // Regroup the cell fragments by their real row; Excel requires ascending rows.
  // Every fragment comes from a cell this export placed, so one without a plan
  // entry means the restore is out of step with the writer: fail the export
  // rather than finish a file that is missing cells.
  const rows = new Map<number, string[]>();
  for (const match of body.matchAll(CELL_ELEMENT)) {
    const k = packedSerialOf(match[0], plan, packedCol, CELL_REF);
    const real = k === undefined ? undefined : realAddr[k];
    if (k === undefined || real === undefined) throw new Error(`Packed export: cell ${match[0].slice(0, 40)} has no address to restore`);
    const row = realRow[k]!;
    let fragments = rows.get(row);
    if (fragments === undefined) {
      fragments = [];
      rows.set(row, fragments);
    }
    fragments.push(match[0].replace(CELL_REF, `r="${real}"`));
  }
  const rebuilt = [...rows.keys()].sort((a, b) => a - b)
    .map((row) => `<row r="${row + 1}">${rows.get(row)!.join('')}</row>`)
    .join('');
  let out = xml.slice(0, start + head.length) + rebuilt + xml.slice(end);

  // The extent travels with the cells: the real used rectangle.
  const realRef = `${num2alpha(plan.bounds.c1)}${plan.bounds.r1 + 1}:${num2alpha(plan.bounds.c2)}${plan.bounds.r2 + 1}`;
  out = out.replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="${realRef}"/>`);

  // SheetJS caps the sheet with a "numbers stored as text" suppression over
  // its whole extent — the extent's corners are packed addresses too, and
  // they would be meaningless after the restore, so point it at the real one.
  out = out.replace(/(<ignoredError\b[^>]*\bsqref=")[^"]*(")/, `$1${realRef}$2`);

  // Hyperlink refs are packed addresses too; r:id / location / tooltip carry
  // over. Their attribute is `ref=`, not the bare `r=` of a cell tag.
  if (out.includes('<hyperlink')) {
    out = out.replace(/<hyperlink\b[^>]*>/g, (tag) => {
      const k = packedSerialOf(tag, plan, packedCol, HYPERLINK_REF);
      const real = k === undefined ? undefined : realAddr[k];
      // Same rule as the cells: a hyperlink this export did not place must not
      // leave the file pointing at a packed address.
      if (k === undefined || real === undefined) throw new Error(`Packed export: hyperlink ${tag.slice(0, 60)} has no address to restore`);
      return tag.replace(HYPERLINK_REF, `ref="${real}"`);
    });
  }
  return out;
}

/**
 * Packed serial `k = packedRow * width + packedColumn` of one tag's cell
 * address, or undefined when the tag carries no ref the plan knows (crafted
 * or already-restored markup stays untouched).
 */
function packedSerialOf(tag: string, plan: SheetPackPlan, packedCol: Map<string, number>, ref: RegExp): number | undefined {
  const m = tag.match(ref);
  if (m === null) return undefined;
  const column = packedCol.get(m[1]!);
  const packedRow = Number(m[2]!) - 1;
  if (column === undefined || !Number.isInteger(packedRow) || packedRow < 0) return undefined;
  return packedRow * plan.width + column;
}
