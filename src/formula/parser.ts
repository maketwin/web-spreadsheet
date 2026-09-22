import type { AstNode } from './types';

/** True when the whole expression is wrapped in one balanced pair of parens. */
function isWrappedInParens(expr: string): boolean {
  if (!expr.startsWith('(') || !expr.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < expr.length; i += 1) {
    if (expr[i] === '(') depth += 1;
    else if (expr[i] === ')') depth -= 1;
    if (depth === 0 && i < expr.length - 1) return false; // closes before the end
  }
  return depth === 0;
}

const TWO_CHAR_OPS = new Set(['>=', '<=', '<>']);
const SINGLE_CHAR_OPS = new Set(['&', '=', '+', '-', '*', '/', '>', '<', '^']);

/** Excel operator precedence: higher binds tighter. Unary sign binds above ^ (Excel: -2^2 = 4). */
const OP_PRECEDENCE: Record<string, number> = {
  '^': 5,
  '*': 4, '/': 4,
  '+': 3, '-': 3,
  '&': 2,
  '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
};

interface TopLevelSplit {
  /** Operand texts; ops[i] sits between atoms[i] and atoms[i+1]. */
  readonly atoms: readonly string[];
  readonly ops: readonly string[];
}

/** Characters after which a +/- is a unary sign rather than a binary operator. */
const SIGN_CONTEXT_CHARS = new Set(['+', '-', '*', '/', '&', '=', '<', '>', '^', '(', ',']);

/** True when the +/- at `i` directly follows an operator, '(', ',', or the start. */
function isSignPosition(expr: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(expr[j] ?? '')) j -= 1;
  if (j < 0) return true;
  return SIGN_CONTEXT_CHARS.has(expr[j] ?? '');
}

/**
 * Split an expression on top-level binary operators. Parenthesized and
 * double-quoted regions are opaque; the sign of a scientific-notation
 * literal (1E-5) is part of the number. Returns null when the expression
 * contains no top-level operator.
 */
function splitTopLevelOps(expr: string): TopLevelSplit | null {
  const atoms: string[] = [];
  const ops: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (inString) {
      if (ch === '"') {
        if (expr[i + 1] === '"') i += 1; // "" escape inside a literal
        else inString = false;
      }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '(') { depth += 1; continue; }
    if (ch === ')') { depth -= 1; continue; }
    if (depth !== 0 || i === 0) continue;
    const prev = expr[i - 1];
    if ((ch === '-' || ch === '+') && (prev === 'e' || prev === 'E') && /\d/.test(expr[i - 2] ?? '')) continue;
    // A +/- whose previous non-space character is an operator, '(', or ','
    // is a unary sign (e.g. `2*-3`, `SUM(-A1, -2)`), not a binary split.
    if ((ch === '-' || ch === '+') && isSignPosition(expr, i)) continue;
    const two = expr.slice(i, i + 2);
    const op = TWO_CHAR_OPS.has(two) ? two : (SINGLE_CHAR_OPS.has(ch ?? '') ? ch : undefined);
    if (op === undefined) continue;
    atoms.push(expr.slice(start, i));
    ops.push(op);
    i += op.length - 1;
    start = i + 1;
  }
  if (ops.length === 0) return null;
  atoms.push(expr.slice(start));
  return { atoms, ops };
}

export class FormulaParser {
  parse(input: string): AstNode | null {
    if (!input.startsWith('=')) return null;
    return this.parseExpression(input.slice(1).trim());
  }

  private parseExpression(expr: string): AstNode {
    // Parenthesized group: unwrap and parse the inner expression.
    if (isWrappedInParens(expr)) return this.parseExpression(expr.slice(1, -1).trim());

    const binary = this.parseBinary(expr);
    if (binary) return binary;

    // Leading sign with no binary operator left: unary node. The sign is
    // otherwise kept glued to its atom so it binds tighter than any binary
    // operator (Excel: -2^2 = (-2)^2, -A1+1 = (-A1)+1).
    if (expr.startsWith('-') || expr.startsWith('+')) {
      return { type: 'unary', op: expr[0] as '-' | '+', operand: this.parseExpression(expr.slice(1).trim()) };
    }

    const func = this.parseFunction(expr);
    if (func) return func;

    return this.parseAtom(expr);
  }

  private parseBinary(expr: string): AstNode | null {
    const split = splitTopLevelOps(expr);
    if (split === null) return null;
    const { atoms, ops } = split;
    // Classic precedence climbing: ops[i] sits between atoms[i] and atoms[i+1].
    let ai = 0;
    let oi = 0;
    const climb = (minPrec: number): AstNode => {
      let left = this.parseExpression((atoms[ai] ?? '').trim());
      ai += 1;
      for (;;) {
        const op = ops[oi];
        if (op === undefined) return left;
        const prec = OP_PRECEDENCE[op];
        if (prec === undefined || prec < minPrec) return left;
        oi += 1;
        left = { type: 'binary', op, left, right: climb(prec + 1) };
      }
    };
    return climb(1);
  }

  private parseFunction(expr: string): AstNode | null {
    // Dotted function names (RANK.EQ / STDEV.P) parse as functions too.
    const match = expr.match(/^([A-Za-z][A-Za-z0-9_.]*)\((.*)\)$/);
    const name = match?.[1];
    const argsText = match?.[2];
    if (name === undefined || argsText === undefined) return null;

    const args = argsText.trim() === '' ? [] : splitArgs(argsText).map((arg) => this.parseExpression(arg.trim()));
    return { type: 'func', name: name.toUpperCase(), args };
  }

  private parseAtom(expr: string): AstNode {
    // Excel string literal: "..." with "" as an escaped quote.
    if (expr.startsWith('"') && expr.endsWith('"') && expr.length >= 2) {
      return { type: 'string', value: expr.slice(1, -1).replace(/""/g, '"') };
    }

    const range = this.parseRange(expr);
    if (range) return range;

    const cell = this.parseCell(expr);
    if (cell) return cell;

    const numeric = Number(expr);
    if (expr !== '' && Number.isFinite(numeric)) return { type: 'number', value: numeric };

    // Named range: identifier that is not a cell ref or function call
    if (/^[A-Za-z_]\w*$/.test(expr)) {
      return { type: 'name', value: expr };
    }

    return { type: 'string', value: expr };
  }

  private parseRange(expr: string): AstNode | null {
    const scoped = splitSheetScope(expr);
    const parts = scoped.ref.split(':');
    if (parts.length !== 2) return null;
    const start = parts[0];
    const end = parts[1];
    if (start === undefined || end === undefined) return null;
    const startCell = this.parseCell(start.trim(), scoped.sheetName);
    const endCell = this.parseCell(end.trim(), scoped.sheetName);
    if (!startCell || !endCell) return null;

    const range: Extract<AstNode, { type: 'range' }> = { type: 'range', x1: startCell.x, y1: startCell.y, x2: endCell.x, y2: endCell.y };
    if (scoped.sheetName !== undefined) return { ...range, sheetName: scoped.sheetName };
    return range;
  }

  private parseCell(expr: string, sheetName?: string): Extract<AstNode, { type: 'cell' }> | null {
    const scoped = sheetName === undefined ? splitSheetScope(expr) : { sheetName, ref: expr };
    // Excel absolute references: $ anchors are accepted (and preserved by
    // shift/remap operations); they do not change evaluation semantics.
    const match = scoped.ref.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/);
    const col = match?.[2];
    const row = match?.[4];
    if (col === undefined || row === undefined) return null;

    const cell: Extract<AstNode, { type: 'cell' }> = { type: 'cell', x: columnToIndex(col), y: Number(row) - 1 };
    if (scoped.sheetName !== undefined) return { ...cell, sheetName: scoped.sheetName };
    return cell;
  }
}


/** Split function arguments on top-level commas (nested calls keep theirs). */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '"') {
        if (text[i + 1] === '"') i += 1;
        else inString = false;
      }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) { args.push(text.slice(start, i)); start = i + 1; }
  }
  args.push(text.slice(start));
  return args;
}

function splitSheetScope(expr: string): { sheetName?: string; ref: string } {
  const bang = expr.indexOf('!');
  if (bang <= 0) return { ref: expr };
  const name = expr.slice(0, bang).trim().replace(/^'|'$/g, '');
  const ref = expr.slice(bang + 1).trim();
  if (name.length === 0) return { ref };
  return { sheetName: name, ref };
}

function columnToIndex(col: string): number {
  let result = 0;
  for (let i = 0; i < col.length; i += 1) {
    result = result * 26 + (col.toUpperCase().charCodeAt(i) - 64);
  }
  return result - 1;
}
