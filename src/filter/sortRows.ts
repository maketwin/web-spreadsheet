import type { Store } from '../store/Store';
import type { Cell } from '../types';
import { remapFormulaRows } from '../util/cell';

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
export function sortRowsInPlace(store: Store, r1: number, c1: number, r2: number, c2: number, sortCol: number, direction: 'asc' | 'desc'): void {
  const rows: SortRow[] = [];
  for (let r = r1; r <= r2; r += 1) {
    const cells: Array<Cell | undefined> = [];
    for (let c = c1; c <= c2; c += 1) {
      const cell = store.getCell(r, c);
      cells.push(cell === undefined ? undefined : { ...cell });
    }
    rows.push({ index: r, cells });
  }

  const dir = direction === 'asc' ? 1 : -1;
  const offset = sortCol - c1;
  rows.sort((a, b) => {
    const av = a.cells[offset]?.text ?? '';
    const bv = b.cells[offset]?.text ?? '';
    if (av === '' || bv === '') {
      if (av === bv) return 0;
      return av === '' ? 1 : -1; // Excel keeps blanks last in either sort direction.
    }
    return dir * compareExcelValues(av, bv);
  });

  const permutation = new Map<number, number>();
  rows.forEach((row, i) => permutation.set(row.index, r1 + i));

  store.batch(() => {
    rows.forEach((row, i) => {
      const target = r1 + i;
      for (let c = c1; c <= c2; c += 1) {
        let cell = row.cells[c - c1];
        if (cell?.formula !== undefined) cell = { ...cell, formula: remapFormulaRows(cell.formula, permutation, c1, c2) };
        store.setCell(target, c, cell);
      }
    });
  });
}
