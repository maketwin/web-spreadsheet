/**
 * Excel: when a numeric (or date-formatted) value does not fit the column,
 * the cell shows a run of "#" characters instead of clipping/overflowing.
 * Text and formulas overflow into adjacent empty cells instead.
 */

/** True when Excel would hash-fill on overflow (numbers / date-like formats). */
export function usesHashOverflow(
  value: unknown,
  showFormula: boolean,
  formula: string | undefined,
  numberFormat: string | undefined,
): boolean {
  if (showFormula && formula !== undefined) return false;
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  if (numberFormat === undefined) return false;
  const nf = numberFormat.toLowerCase();
  return nf.includes('y') || nf.includes('d') || nf.includes('h') || nf.includes('m') || nf.includes('s');
}

/** Enough "#" characters to fill `maxWidth` at the current font metrics. */
export function hashFillText(measure: (text: string) => number, maxWidth: number): string {
  if (maxWidth <= 0) return '#';
  const unit = measure('#');
  if (unit <= 0) return '#';
  const n = Math.max(1, Math.floor(maxWidth / unit));
  return '#'.repeat(n);
}
