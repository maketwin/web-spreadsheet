import { shiftFormula } from '../commands/impl/FillRange';
import type { CellPatch } from '../commands/impl/SetRangeValues';
import type { RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import type { Cell } from '../types';

/** Excel Paste Special modes (粘贴方式). */
export type PasteMode = 'all' | 'formulas' | 'values' | 'formats';
/** Excel Paste Special operations (运算): target = target <op> source. */
export type PasteOperation = 'none' | 'add' | 'subtract' | 'multiply' | 'divide';

export interface PasteSpecialOptions {
  readonly mode: PasteMode;
  readonly operation: PasteOperation;
  /** Excel 跳过空单元格: blank source cells leave the target untouched. */
  readonly skipBlanks: boolean;
  /** Excel 转置: rows become columns and vice versa. */
  readonly transpose: boolean;
}

export const DEFAULT_PASTE_SPECIAL: PasteSpecialOptions = { mode: 'all', operation: 'none', skipBlanks: false, transpose: false };

/** Structurally compatible with the in-app clipboard session snapshot. */
export interface PasteSpecialSource {
  readonly type: 'cut' | 'copy';
  readonly range: RangeAddress;
  readonly cells: ReadonlyArray<ReadonlyArray<Cell | undefined>>;
}

const isBlank = (cell: Cell | undefined): boolean =>
  cell === undefined || (cell.text === '' && cell.formula === undefined && cell.value === undefined && cell.styleId === undefined);

const numeric = (cell: Cell | undefined): number | undefined => {
  if (cell === undefined) return undefined;
  if (typeof cell.value === 'number') return cell.value;
  if (cell.text.trim() === '') return undefined;
  const n = Number(cell.text);
  return Number.isNaN(n) ? undefined : n;
};

function applyOp(target: number, source: number, op: PasteOperation): number | '#DIV/0!' {
  switch (op) {
    case 'add': return target + source;
    case 'subtract': return target - source;
    case 'multiply': return target * source;
    case 'divide': return source === 0 ? '#DIV/0!' : target / source;
    default: return target;
  }
}

/** One snapshot cell → paste patch, honouring mode/operation/skipBlanks. */
function patchFor(store: Store, cell: Cell | undefined, formula: string | undefined, tr: number, tc: number, opts: PasteSpecialOptions): CellPatch | undefined {
  const blankSource = isBlank(cell);
  if (opts.skipBlanks && blankSource) return undefined;
  if (opts.mode === 'formats') {
    // Formats only: touch nothing but the style. Blank source style clears it (Excel).
    return { styleId: cell?.styleId };
  }
  if (opts.operation !== 'none') {
    // Excel: operations turn the target into a static computed value. Blank
    // targets count as 0; non-numeric sources paste through unchanged.
    const src = numeric(cell);
    if (src === undefined) return blankSource ? { text: '', formula: undefined, value: undefined, type: undefined } : { text: cell?.text ?? '', value: cell?.value, formula: undefined, type: cell?.type };
    const result = applyOp(numeric(store.getCell(tr, tc)) ?? 0, src, opts.operation);
    if (result === '#DIV/0!') return { text: '#DIV/0!', value: undefined, formula: undefined, type: undefined };
    return { text: String(result), value: result, formula: undefined, type: 'number' };
  }
  if (blankSource) {
    // Empty source cell fully clears the target (unless skipped above).
    return { text: '', formula: undefined, value: undefined, styleId: undefined, type: undefined };
  }
  const c = cell as Cell;
  if (opts.mode === 'values') {
    // Values only: keep the target's own style (no styleId key = keep).
    return { text: c.text, value: c.value, formula: undefined, type: c.type };
  }
  if (opts.mode === 'formulas') {
    // Formulas (and number formats live on style, which Excel keeps here).
    return { text: c.text, formula, value: c.value, type: c.type };
  }
  // all: full replacement including style.
  return { text: c.text, formula, value: c.value, styleId: c.styleId, type: c.type };
}

/**
 * Build the paste-special matrix anchored at (r, c). Copy sources shift
 * relative formula references per tile (Excel); cut sources stay verbatim.
 * An exact-multiple target tiles the source block, then transpose/skipBlanks/
 * operation are applied on top.
 */
export function buildPasteSpecialMatrix(store: Store, source: PasteSpecialSource, r: number, c: number, target: RangeAddress | undefined, opts: PasteSpecialOptions): (CellPatch | undefined)[][] {
  const srcRows = source.cells.length;
  const srcCols = source.cells[0]?.length ?? 1;
  let rows = srcRows;
  let cols = srcCols;
  if (target !== undefined && srcRows > 0 && srcCols > 0) {
    const tr = target.r2 - target.r1 + 1;
    const tc = target.c2 - target.c1 + 1;
    if ((tr > srcRows || tc > srcCols) && tr % srcRows === 0 && tc % srcCols === 0) { rows = tr; cols = tc; }
  }
  // src offset (i, j) → source cell with formula shifted to target cell (tr, tc).
  const at = (i: number, j: number, tr: number, tc: number): Cell | undefined => {
    const si = i % srcRows;
    const sj = j % srcCols;
    const cell = source.cells[si]?.[sj];
    if (cell?.formula === undefined || source.type !== 'copy') return cell;
    const shifted = shiftFormula(cell.formula, tr - (source.range.r1 + si), tc - (source.range.c1 + sj));
    return shifted === cell.formula ? cell : { ...cell, formula: shifted };
  };
  const out: (CellPatch | undefined)[][] = [];
  const outRows = opts.transpose ? cols : rows;
  const outCols = opts.transpose ? rows : cols;
  for (let oi = 0; oi < outRows; oi += 1) {
    const line: (CellPatch | undefined)[] = [];
    for (let oj = 0; oj < outCols; oj += 1) {
      const cell = opts.transpose ? at(oj, oi, r + oi, c + oj) : at(oi, oj, r + oi, c + oj);
      line.push(patchFor(store, cell, cell?.formula, r + oi, c + oj, opts));
    }
    out.push(line);
  }
  return out;
}
