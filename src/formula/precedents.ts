import { cellId } from '../util/cell';
import { TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';
import { FormulaParser } from './parser';
import type { AstNode } from './types';

/** Area a named range expands to when collecting formula precedents. */
export interface NamedDepArea {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
  readonly sheetName?: string;
}

/**
 * Ranges larger than this many cells register as ONE rectangular dependency
 * instead of one edge per cell: on the Excel-sized grid a whole-column SUM
 * would otherwise create 1,048,576 graph edges. The engine's rectangle index
 * marks the owner dirty when any cell inside changes; the formulas that
 * already live inside the rectangle still get exact per-cell edges, so ring
 * detection and the topological order are unchanged.
 */
export const RANGE_DEP_CELLS = 256;

/** A range dependency kept as a rectangle (sheet unresolved at this layer). */
export interface RectDep {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
  readonly sheetName?: string;
}

/** The precedents of one formula: exact cell ids plus rectangle dependencies. */
export interface AstDeps {
  readonly cells: string[];
  readonly rects: readonly RectDep[];
}

/**
 * Precedent cell ids (`"r,c"`, or `"Sheet:r,c"`). Walks the parser AST so
 * `$A$1` and quoted sheet names are included — a cell-ref regex drops both.
 * Ranges above {@link RANGE_DEP_CELLS} are left out (they come back as
 * rectangles from {@link depsOfAst} instead).
 */
export function formulaDependencies(formula: string, expandName?: (name: string) => NamedDepArea | undefined): string[] {
  return formulaDeps(formula, expandName).cells;
}

/** Precedent cell ids of an already parsed formula — {@link formulaDependencies} without the parse. */
export function dependenciesOfAst(ast: AstNode, expandName?: (name: string) => NamedDepArea | undefined): string[] {
  return depsOfAst(ast, expandName).cells;
}

/** {@link formulaDependencies} plus the rectangle dependencies for large ranges. */
export function formulaDeps(formula: string, expandName?: (name: string) => NamedDepArea | undefined): AstDeps {
  const ast = new FormulaParser().parse(formula);
  if (ast === null) return { cells: [], rects: [] };
  return depsOfAst(ast, expandName);
}

/** Precedents of an already parsed formula — {@link formulaDeps} without the parse. */
export function depsOfAst(ast: AstNode, expandName?: (name: string) => NamedDepArea | undefined): AstDeps {
  const cells = new Set<string>();
  const rects: RectDep[] = [];
  collectDeps(ast, cells, rects, expandName);
  return { cells: [...cells], rects };
}

function collectDeps(node: AstNode, deps: Set<string>, rects: RectDep[], expandName: ((name: string) => NamedDepArea | undefined) | undefined): void {
  switch (node.type) {
    case 'cell':
      addDep(deps, node.y, node.x, node.sheetName);
      return;
    case 'range': {
      const r1 = Math.min(node.y1, node.y2);
      const r2 = Math.max(node.y1, node.y2);
      const c1 = Math.min(node.x1, node.x2);
      const c2 = Math.max(node.x1, node.x2);
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > RANGE_DEP_CELLS) {
        rects.push(node.sheetName !== undefined ? { r1, c1, r2, c2, sheetName: node.sheetName } : { r1, c1, r2, c2 });
        return;
      }
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) addDep(deps, r, c, node.sheetName);
      }
      return;
    }
    case 'name': {
      if (node.value.toUpperCase() === 'TRUE' || node.value.toUpperCase() === 'FALSE') return;
      const area = expandName?.(node.value);
      if (area === undefined) return;
      const r1 = Math.min(area.r1, area.r2);
      const r2 = Math.max(area.r1, area.r2);
      const c1 = Math.min(area.c1, area.c2);
      const c2 = Math.max(area.c1, area.c2);
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > RANGE_DEP_CELLS) {
        rects.push(area.sheetName !== undefined ? { r1, c1, r2, c2, sheetName: area.sheetName } : { r1, c1, r2, c2 });
        return;
      }
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) addDep(deps, r, c, area.sheetName);
      }
      return;
    }
    case 'func': {
      // INDIRECT("B2") names its target only at run time; a literal argument
      // is still a known precedent, so the formula recalculates when it changes.
      if (node.name.toUpperCase() === 'INDIRECT') addIndirectLiteralDeps(node.args[0], deps, rects);
      node.args.forEach((arg) => collectDeps(arg, deps, rects, expandName));
      return;
    }
    case 'binary':
      collectDeps(node.left, deps, rects, expandName);
      collectDeps(node.right, deps, rects, expandName);
      return;
    case 'unary':
      collectDeps(node.operand, deps, rects, expandName);
      return;
    default:
      return;
  }
}

function addDep(deps: Set<string>, r: number, c: number, sheetName: string | undefined): void {
  const id = cellId(r, c);
  deps.add(sheetName !== undefined ? `${sheetName}:${id}` : id);
}

/** `A1`, `A1:B2`, `A:A`, `3:5` — each optionally `Sheet!`-scoped, `[$]` anchors allowed. */
const INDIRECT_TARGET = /^\s*(?:(?:'((?:[^']|'')+)'|([^!]+))!)?\s*(\$?[A-Za-z]{0,3}\$?(?:[1-9]\d*)?)(?:\s*:\s*(\$?[A-Za-z]{0,3}\$?(?:[1-9]\d*)?))?\s*$/u;

/**
 * One half of an A1 reference: column letters and/or a row number, each
 * optional but at least one present (`A`, `$3`, `B2`). Undefined when the
 * token is not a reference half at all.
 */
export function parseRefHalf(token: string): { col: number | undefined; row: number | undefined } | null {
  const match = token.match(/^\$?([A-Za-z]{1,3})?\$?([1-9]\d*)?$/u);
  const colText = match?.[1];
  const rowText = match?.[2];
  if (colText === undefined && rowText === undefined) return null;
  let col: number | undefined;
  if (colText !== undefined) {
    col = 0;
    for (const ch of colText.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
    col -= 1;
  }
  return { col, row: rowText !== undefined ? Number(rowText) - 1 : undefined };
}

/**
 * Normalises two reference halves into a rectangle. A dimension defined on
 * both halves spans them; missing on one half it opens toward that edge
 * (`B2:B` → B2:B<last row>, `B1:1` → B1:<last column>1); missing on both it
 * spans the whole grid (`A:A`, `3:5`).
 */
export function halvesToRect(
  from: { col: number | undefined; row: number | undefined },
  to: { col: number | undefined; row: number | undefined },
): { r1: number; c1: number; r2: number; c2: number } | null {
  const span = (a: number | undefined, b: number | undefined, max: number, fromFirst: boolean): [number, number] => {
    if (a !== undefined && b !== undefined) return [Math.min(a, b), Math.max(a, b)];
    if (a !== undefined) return fromFirst ? [a, max] : [0, a];
    if (b !== undefined) return fromFirst ? [0, b] : [b, max];
    return [0, max];
  };
  const [c1, c2] = span(from.col, to.col, TOTAL_COLS - 1, true);
  const [r1, r2] = span(from.row, to.row, TOTAL_ROWS - 1, true);
  return { r1, c1, r2, c2 };
}

function addIndirectLiteralDeps(arg: AstNode | undefined, deps: Set<string>, rects: RectDep[]): void {
  if (arg === undefined || arg.type !== 'string') return;
  const match = arg.value.match(INDIRECT_TARGET);
  const start = match?.[3];
  if (start === undefined) return;
  const sheetName = match?.[1]?.replaceAll("''", "'") ?? match?.[2];
  const bare = (token: string): string => token.replaceAll('$', '');
  const from = parseRefHalf(bare(start));
  const endToken = match?.[4];
  const to = endToken !== undefined ? parseRefHalf(bare(endToken)) : from;
  if (from === null || to === null) return;
  // A lone half must be a whole cell; only a `:` range may miss a dimension.
  if (endToken === undefined && (from.col === undefined || from.row === undefined)) return;
  const rect = halvesToRect(from, to);
  if (rect === null) return;
  if ((rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1) > RANGE_DEP_CELLS) {
    rects.push(sheetName !== undefined ? { ...rect, sheetName } : rect);
    return;
  }
  for (let r = rect.r1; r <= rect.r2; r += 1) {
    for (let c = rect.c1; c <= rect.c2; c += 1) addDep(deps, r, c, sheetName);
  }
}
