import { alpha2num, num2alpha } from './alphabet';
import { replaceRefTokens } from './cell';
import { TOTAL_COLS, TOTAL_ROWS } from './gridSize';

/**
 * Move a formula's relative references by (dr, dc) — fill, copy and paste,
 * and anything else that evaluates one formula across a range (conditional
 * formats, validation): there (dr, dc) is the cell's offset from the range's
 * top-left cell. A relative reference pushed off the grid is dead and becomes
 * `#REF!` (Excel semantics), instead of silently pointing where it used to.
 * Reference tokens are found with the shared scanner (string literals and
 * sheet names are skipped); `$` anchors are preserved.
 */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  return replaceRefTokens(formula, (token) => {
    const parts = token.split(':').map((part) => moveRef(part, dr, dc));
    return parts.includes('#REF!') ? '#REF!' : parts.join(':');
  });
}

function moveRef(ref: string, dr: number, dc: number): string {
  const match = ref.match(/^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/);
  const colAbs = match?.[1];
  const col = match?.[2];
  const rowAbs = match?.[3];
  const row = match?.[4];
  if (colAbs === undefined || col === undefined || rowAbs === undefined || row === undefined) return ref;
  const newCol = alpha2num(col.toUpperCase()) + (colAbs === '$' ? 0 : dc);
  const newRow = Number(row) - 1 + (rowAbs === '$' ? 0 : dr);
  if (newCol < 0 || newCol >= TOTAL_COLS || newRow < 0 || newRow >= TOTAL_ROWS) return '#REF!';
  const moved = colAbs === '$' ? col : num2alpha(newCol);
  return `${colAbs}${col === col.toLowerCase() ? moved.toLowerCase() : moved}${rowAbs}${newRow + 1}`;
}
