import { alpha2num, num2alpha } from '../util/alphabet';
import { TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';
import { shiftAxis, shiftRangeAxis } from '../util/rangeNotation';

/** One A1 reference or range (`B2`, `$A$1:C3`), anchored at the start of the text being tried. */
const REF_OR_RANGE_TOKEN = /^\$?[A-Za-z]{1,3}\$?[1-9]\d*(?::\$?[A-Za-z]{1,3}\$?[1-9]\d*)?/;

/**
 * Rewrite every reference token of a formula. Quoted spans — `"…"` string
 * literals and `'…'` sheet names — are copied verbatim, so the `A1` in
 * `"Item A1"` or in a sheet called `Q1` is never taken for a cell; a token
 * followed by `!` is a sheet name as well. `offset` is the token's position
 * in `formula`, for callers that look at the `!` scope before it.
 */
export function replaceRefTokens(formula: string, rewrite: (token: string, offset: number) => string): string {
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula.charAt(i);
    if (ch === '"' || ch === "'") {
      const end = quotedEnd(formula, i);
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '$' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
      const token = formula.slice(i).match(REF_OR_RANGE_TOKEN)?.[0];
      if (token !== undefined && isRefToken(formula, i, token)) {
        out += rewrite(token, i);
        i += token.length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Index just past the closing quote of the quoted span opening at `start` (a doubled quote is an escape). */
function quotedEnd(formula: string, start: number): number {
  const quote = formula[start];
  for (let i = start + 1; i < formula.length; i += 1) {
    if (formula[i] !== quote) continue;
    if (formula[i + 1] === quote) { i += 1; continue; }
    return i + 1;
  }
  return formula.length;
}

/**
 * A reference token in its own right: not glued to an identifier, number or
 * `.` (function names, scientific literals), not a call (`LOG10(`), and not
 * a sheet name (`Q1!B2`).
 */
function isRefToken(formula: string, offset: number, token: string): boolean {
  const prev = formula[offset - 1];
  if (prev !== undefined && /[\w$.]/.test(prev)) return false;
  const next = formula[offset + token.length];
  if (next !== undefined && /[\w(!]/.test(next)) return false;
  return true;
}

/**
 * Rewrite same-sheet A1 references pointing inside the sorted range through
 * the row permutation so moved formulas keep referencing the same logical
 * cells. For a range, every row between the endpoints is mapped (not just
 * the two corners) — endpoint-only remapping shrinks ranges when an interior
 * row sorts outside the new corner span (common when AutoFilter is on and
 * the user sorts by a formula/total column). Rows absent from the permutation
 * (hidden/pinned under a filter) keep their index. Corners are re-normalized
 * so B5:B3 becomes B3:B5. Cross-sheet refs and columns outside the sort
 * domain are left untouched.
 */
export interface RemapScope {
  /** When set, `SheetName!A1`-scoped tokens naming this sheet also remap. */
  readonly sheetName?: string;
  /** Other-sheet formulas: only tokens explicitly scoped to sheetName remap. */
  readonly scopedOnly?: boolean;
}

export function remapFormulaRows(formula: string, rows: ReadonlyMap<number, number>, c1: number, c2: number, scope?: RemapScope): string {
  return replaceRefTokens(formula, (token, offset) => {
    // A token glued to a preceding identifier, number, or '.' is part of a
    // function name or scientific literal. A '!' prefix marks a sheet scope:
    // remap only when it names the sorted sheet.
    const prev = formula[offset - 1];
    if (prev !== undefined && /[\w$.]/.test(prev)) return token;
    if (prev === '!') {
      const name = scopeNameBefore(formula, offset);
      if (scope?.sheetName === undefined || name !== scope.sheetName) return token;
    } else if (scope?.scopedOnly === true) return token;
    const parts = token.split(':');
    const start = parseRefToken(parts[0] ?? '');
    if (start === null) return token;
    const end = parts[1] !== undefined ? parseRefToken(parts[1]) : undefined;
    if (end === null || end === undefined) {
      if (!inSortDomain(start.c, c1, c2)) return token;
      const target = rows.get(start.r);
      if (target === undefined) return token;
      return rebuildRefTokenRow(parts[0] ?? '', target);
    }
    const startIn = inSortDomain(start.c, c1, c2);
    const endIn = inSortDomain(end.c, c1, c2);
    if (!startIn && !endIn) return token;
    const rLo = Math.min(start.r, end.r);
    const rHi = Math.max(start.r, end.r);
    let touched = false;
    for (let r = rLo; r <= rHi; r += 1) {
      if (rows.has(r)) { touched = true; break; }
    }
    if (!touched) return token;
    // Span must cover every image of the original rows (mapped or pinned).
    let mappedMin = Number.POSITIVE_INFINITY;
    let mappedMax = Number.NEGATIVE_INFINITY;
    for (let r = rLo; r <= rHi; r += 1) {
      const target = rows.get(r) ?? r;
      if (target < mappedMin) mappedMin = target;
      if (target > mappedMax) mappedMax = target;
    }
    let from = { ...start, r: mappedMin };
    let to = { ...end, r: mappedMax };
    if (to.r < from.r || (to.r === from.r && to.c < from.c)) {
      const swap = from;
      from = to;
      to = swap;
    }
    return `${rebuildRefTokenRow(parts[0] ?? '', from.r)}:${rebuildRefTokenRow(parts[1] ?? '', to.r)}`;
  });
}

/** Sheet name in the `Name!` / `'Name'!` scope immediately before `offset`. */
function scopeNameBefore(formula: string, offset: number): string | undefined {
  const before = formula.slice(0, offset);
  const match = before.match(/(?:'([^']+)'|([A-Za-z0-9_.\u4e00-\u9fa5]+))!$/);
  return match?.[1] ?? match?.[2];
}

/** Scope for insert/delete reference rewriting: which sheet's rows/cols moved. */
export interface ShiftScope {
  /** Name of the sheet where rows/cols were inserted or deleted. */
  readonly sheetName: string;
  /** True for formulas living on OTHER sheets: only `SheetName!`-scoped tokens shift. */
  readonly scopedOnly?: boolean;
}

/**
 * Rewrite references for a row insert (count > 0) or delete (count < 0) at
 * 0-based `start`, Excel semantics: refs below an insert shift down; ranges
 * spanning an insert grow at shifted endpoints only; deleted refs become
 * #REF!; ranges shrink with deleted endpoints clamping into the zone, and a
 * fully-deleted range becomes #REF!. Tokens scoped to another sheet and
 * (with scopedOnly) unscoped tokens in other sheets' formulas stay put.
 */
export function shiftFormulaRows(formula: string, start: number, count: number, scope?: ShiftScope): string {
  return replaceRefTokens(formula, (token, offset) => {
    if (!tokenInShiftScope(formula, offset, scope)) return token;
    const clamp = (i: number): number => Math.min(i, TOTAL_ROWS - 1); // fixed grid: Excel clamps refs at the edge
    const parts = token.split(':');
    if (parts.length === 1) {
      const ref = parseRefToken(token);
      if (ref === null) return token;
      const mapped = shiftAxis(ref.r, start, count);
      return mapped < 0 ? '#REF!' : rebuildRefTokenRow(token, clamp(mapped));
    }
    const head = parseRefToken(parts[0] ?? '');
    const tail = parseRefToken(parts[1] ?? '');
    if (head === null || tail === null) return token;
    const shifted = shiftRangeAxis(head.r, tail.r, start, count);
    if (shifted === '#REF!') return '#REF!';
    const [lo, hi] = shifted;
    return `${rebuildRefTokenRow(parts[0] ?? '', clamp(lo))}:${rebuildRefTokenRow(parts[1] ?? '', clamp(hi))}`;
  });
}

/** Column counterpart of {@link shiftFormulaRows}. */
export function shiftFormulaCols(formula: string, start: number, count: number, scope?: ShiftScope): string {
  return replaceRefTokens(formula, (token, offset) => {
    if (!tokenInShiftScope(formula, offset, scope)) return token;
    const clamp = (i: number): number => Math.min(i, TOTAL_COLS - 1); // fixed grid: Excel clamps refs at the edge
    const parts = token.split(':');
    if (parts.length === 1) {
      const ref = parseRefToken(token);
      if (ref === null) return token;
      const mapped = shiftAxis(ref.c, start, count);
      return mapped < 0 ? '#REF!' : rebuildRefTokenCol(token, clamp(mapped));
    }
    const head = parseRefToken(parts[0] ?? '');
    const tail = parseRefToken(parts[1] ?? '');
    if (head === null || tail === null) return token;
    const shifted = shiftRangeAxis(head.c, tail.c, start, count);
    if (shifted === '#REF!') return '#REF!';
    const [lo, hi] = shifted;
    return `${rebuildRefTokenCol(parts[0] ?? '', clamp(lo))}:${rebuildRefTokenCol(parts[1] ?? '', clamp(hi))}`;
  });
}

function tokenInShiftScope(formula: string, offset: number, scope: ShiftScope | undefined): boolean {
  const prev = formula[offset - 1];
  if (prev !== undefined && /[\w$.]/.test(prev)) return false;
  if (prev === '!') return scopeNameBefore(formula, offset) === scope?.sheetName;
  return scope?.scopedOnly !== true;
}

function rebuildRefTokenRow(token: string, r0: number): string {
  return token.replace(/[1-9]\d*$/, String(r0 + 1));
}

function rebuildRefTokenCol(token: string, c0: number): string {
  return token.replace(/^(\$?)[A-Za-z]+/, (_, dollar: string) => `${dollar}${num2alpha(c0)}`);
}

function inSortDomain(col: number, c1: number, c2: number): boolean {
  return col >= c1 && col <= c2;
}

function parseRefToken(token: string): { readonly r: number; readonly c: number } | null {
  const match = token.match(/^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/);
  if (match === null || match[2] === undefined || match[4] === undefined) return null;
  return { r: Number(match[4]) - 1, c: alpha2num(match[2].toUpperCase()) };
}

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
