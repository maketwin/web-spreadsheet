import type { AstNode } from './types';

export class FormulaParser {
  parse(input: string): AstNode | null {
    if (!input.startsWith('=')) return null;
    return this.parseExpression(input.slice(1).trim());
  }

  private parseExpression(expr: string): AstNode {
    const binary = this.parseBinary(expr);
    if (binary) return binary;

    const func = this.parseFunction(expr);
    if (func) return func;

    return this.parseAtom(expr);
  }

  private parseBinary(expr: string): AstNode | null {
    for (const op of ['+', '-', '*', '/']) {
      const index = expr.indexOf(op, 1);
      if (index <= 0) continue;
      return {
        type: 'binary',
        op,
        left: this.parseAtom(expr.slice(0, index).trim()),
        right: this.parseAtom(expr.slice(index + 1).trim()),
      };
    }
    return null;
  }

  private parseFunction(expr: string): AstNode | null {
    const match = expr.match(/^([A-Za-z][A-Za-z0-9_]*)\((.*)\)$/);
    const name = match?.[1];
    const argsText = match?.[2];
    if (name === undefined || argsText === undefined) return null;

    const args = argsText.trim() === '' ? [] : argsText.split(',').map((arg) => this.parseAtom(arg.trim()));
    return { type: 'func', name: name.toUpperCase(), args };
  }

  private parseAtom(expr: string): AstNode {
    const range = this.parseRange(expr);
    if (range) return range;

    const cell = this.parseCell(expr);
    if (cell) return cell;

    const numeric = Number(expr);
    if (expr !== '' && Number.isFinite(numeric)) return { type: 'number', value: numeric };

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
    const match = scoped.ref.match(/^([A-Za-z]+)(\d+)$/);
    const col = match?.[1];
    const row = match?.[2];
    if (col === undefined || row === undefined) return null;

    const cell: Extract<AstNode, { type: 'cell' }> = { type: 'cell', x: columnToIndex(col), y: Number(row) - 1 };
    if (scoped.sheetName !== undefined) return { ...cell, sheetName: scoped.sheetName };
    return cell;
  }
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
