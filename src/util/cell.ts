import type { Cell, CellValue } from '../types';

export type CellInput = string | Partial<Cell>;

export function normalizeCellInput(cell: CellInput): Cell {
  if (typeof cell === 'string') return cellFromText(undefined, cell);

  const text = cell.text ?? cell.formula ?? '';
  const next: Cell = { ...cell, text };
  const formula = formulaText(next);
  if (formula !== undefined) {
    delete next.value;
    next.formula = formula;
    return next;
  }

  delete next.formula;
  const value = valueFromText(text);
  if (value !== undefined) next.value = value;
  return next;
}

export function cellFromText(oldCell: Cell | undefined, text: string): Cell {
  const next: Cell = oldCell === undefined ? { text } : { ...oldCell, text };
  delete next.formula;
  delete next.value;
  // Excel: replacing a cell's content wholesale drops per-character formatting.
  delete next.richText;
  // Excel: editing a hyperlink cell's display text keeps the link; only
  // clearing the content (empty text) removes it. (Deleting the whole cell
  // goes through clearRange → setCell(undefined), which also drops it.)
  if (text === '') delete next.hyperlink;

  const formula = formulaText(next);
  if (formula !== undefined) {
    next.formula = formula;
    return next;
  }

  const value = valueFromText(text);
  if (value !== undefined) next.value = value;
  return next;
}

export function valueFromText(text: string): CellValue | undefined {
  if (text.trim() === '' || text.startsWith('=')) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function formulaText(cell: Cell | undefined): string | undefined {
  if (cell?.formula !== undefined) return cell.formula;
  return cell?.text.startsWith('=') === true ? cell.text : undefined;
}

export function cellId(r: number, c: number): string {
  return `${r},${c}`;
}

/** Inverse of {@link cellId}: parse "r,c" back to coordinates; null when malformed. */
export function cellIdCoords(id: string): { r: number; c: number } | null {
  const sep = id.indexOf(',');
  if (sep <= 0) return null;
  const r = Number(id.slice(0, sep));
  const c = Number(id.slice(sep + 1));
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  return { r, c };
}
