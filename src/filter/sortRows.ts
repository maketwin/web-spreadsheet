import type { Store } from '../store/Store';
import type { Cell } from '../types';
import { remapFormulaRows } from '../util/cell';
import { remapRefsForMovedRows, type OutsideRewrite } from '../formula/rowMoveRefs';

export type { OutsideRewrite } from '../formula/rowMoveRefs';

/** Excel value ordering: numbers before text, numbers compare numerically, text locale-aware. */
export function compareExcelValues(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  const aNumber = a !== '' && !Number.isNaN(an);
  const bNumber = b !== '' && !Number.isNaN(bn);
  if (aNumber && bNumber) return an - bn;
  if (aNumber) return -1;
  if (bNumber) return 1;
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

interface SortRow {
  readonly index: number;
  readonly cells: ReadonlyArray<Cell | undefined>;
}

/**
 * Excel-style range sort for rows r1..r2 × columns c1..c2 by `sortCol`:
 * blanks stay last in either direction, and all cell writes go through one
 * store batch so subscribers (formula recalculation, rendering) observe the
 * fully sorted state instead of intermediate rows. Formulas inside the range
 * have their row references remapped through the permutation so they keep
 * pointing at the same logical data.
 */
export function sortRowsInPlace(store: Store, r1: number, c1: number, r2: number, c2: number, sortCol: number, direction: 'asc' | 'desc'): OutsideRewrite[] {
  interface RowEntry { readonly index: number; readonly hidden: boolean; readonly cells: ReadonlyArray<Cell | undefined> }
  const all: RowEntry[] = [];
  const visible: SortRow[] = [];
  for (let r = r1; r <= r2; r += 1) {
    const cells: Array<Cell | undefined> = [];
    for (let c = c1; c <= c2; c += 1) {
      const cell = store.getCell(r, c);
      cells.push(cell === undefined ? undefined : { ...cell });
    }
    const hidden = store.getRow(r)?.hide === true;
    all.push({ index: r, hidden, cells });
    // Excel: sorting a filtered range reorders only the visible rows; rows
    // hidden by the filter stay pinned at their original positions.
    if (!hidden) visible.push({ index: r, cells });
  }

  const dir = direction === 'asc' ? 1 : -1;
  const offset = sortCol - c1;
  visible.sort((a, b) => {
    const av = a.cells[offset]?.text ?? '';
    const bv = b.cells[offset]?.text ?? '';
    if (av === '' || bv === '') {
      if (av === bv) return 0;
      return av === '' ? 1 : -1; // Excel keeps blanks last in either sort direction.
    }
    return dir * compareExcelValues(av, bv);
  });

  // Visible rows land back into the visible slots, in sorted order.
  const permutation = new Map<number, number>();
  let slot = 0;
  const targetOf = new Map<number, SortRow>();
  all.forEach((entry) => {
    if (entry.hidden) return;
    const row = visible[slot];
    if (row !== undefined) { permutation.set(row.index, entry.index); targetOf.set(entry.index, row); }
    slot += 1;
  });

  // Cells outside the sorted range whose formulas reference moved rows
  // (Excel treats a sort as row moves and rewrites references workbook-wide).
  let outsideRewrites: OutsideRewrite[] = [];

  store.batch(() => {
    all.forEach((entry) => {
      const row = targetOf.get(entry.index);
      const cells = row !== undefined ? row.cells : entry.cells;
      // Hidden rows keep their cells but their formulas still follow any
      // referenced rows that moved (Excel remaps references sheet-wide).
      for (let c = c1; c <= c2; c += 1) {
        let cell = cells[c - c1];
        if (cell?.formula !== undefined) cell = { ...cell, formula: remapFormulaRows(cell.formula, permutation, c1, c2) };
        store.setCell(entry.index, c, cell);
      }
    });

    outsideRewrites = remapRefsForMovedRows(store, { r1, r2, c1, c2, permutation });
  });
  return outsideRewrites;
}
