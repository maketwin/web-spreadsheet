import { num2alpha } from '../util/alphabet';
import { Range, type RangeAddress } from './Range';

export type SelectionKind = 'cell' | 'range' | 'row' | 'column' | 'sheet';

export interface Selection {
  readonly kind: SelectionKind;
  readonly range: RangeAddress;
  readonly anchor: { readonly r: number; readonly c: number };
  readonly active: { readonly r: number; readonly c: number };
}

export function cellSelection(r: number, c: number): Selection {
  const range = Range.single(r, c).toAddress();
  return { kind: 'cell', range, anchor: { r, c }, active: { r, c } };
}

export function rangeSelection(range: RangeAddress, anchor?: Selection['anchor'], active?: Selection['active']): Selection {
  const normalized = Range.normalize(range);
  const isSingle = normalized.r1 === normalized.r2 && normalized.c1 === normalized.c2;
  return {
    kind: isSingle ? 'cell' : 'range',
    range: normalized,
    anchor: anchor ?? { r: normalized.r1, c: normalized.c1 },
    active: active ?? { r: normalized.r2, c: normalized.c2 },
  };
}

export function columnSelection(c: number, totalRows: number, anchorColumn = c): Selection {
  const range = Range.normalize({ r1: 0, c1: anchorColumn, r2: totalRows - 1, c2: c });
  return { kind: 'column', range, anchor: { r: 0, c: anchorColumn }, active: { r: 0, c } };
}

export function rowSelection(r: number, totalCols: number, anchorRow = r): Selection {
  const range = Range.normalize({ r1: anchorRow, c1: 0, r2: r, c2: totalCols - 1 });
  return { kind: 'row', range, anchor: { r: anchorRow, c: 0 }, active: { r, c: 0 } };
}

export function sheetSelection(range: RangeAddress): Selection {
  const normalized = Range.normalize(range);
  return { kind: 'sheet', range: normalized, anchor: { r: normalized.r1, c: normalized.c1 }, active: { r: normalized.r2, c: normalized.c2 } };
}

export function extendSelection(selection: Selection, active: { readonly r: number; readonly c: number }): Selection {
  return rangeSelection({ r1: selection.anchor.r, c1: selection.anchor.c, r2: active.r, c2: active.c }, selection.anchor, active);
}

export function selectionLabel(selection: Selection | null): string {
  if (selection === null) return '-';
  const { range, kind } = selection;
  if (kind === 'column') return range.c1 === range.c2 ? `${num2alpha(range.c1)}:${num2alpha(range.c1)}` : `${num2alpha(range.c1)}:${num2alpha(range.c2)}`;
  if (kind === 'row') return range.r1 === range.r2 ? `${range.r1 + 1}:${range.r1 + 1}` : `${range.r1 + 1}:${range.r2 + 1}`;
  const start = `${num2alpha(range.c1)}${range.r1 + 1}`;
  const end = `${num2alpha(range.c2)}${range.r2 + 1}`;
  return range.r1 === range.r2 && range.c1 === range.c2 ? start : `${start}:${end}`;
}
