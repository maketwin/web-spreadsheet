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
    const parts = expr.split(':');
    if (parts.length !== 2) return null;
    const start = parts[0];
    const end = parts[1];
    if (start === undefined || end === undefined) return null;
    const startCell = this.parseCell(start.trim());
    const endCell = this.parseCell(end.trim());
    if (!startCell || !endCell) return null;

    return { type: 'range', x1: startCell.x, y1: startCell.y, x2: endCell.x, y2: endCell.y };
  }

  private parseCell(expr: string): Extract<AstNode, { type: 'cell' }> | null {
    const match = expr.match(/^([A-Za-z]+)(\d+)$/);
    const col = match?.[1];
    const row = match?.[2];
    if (col === undefined || row === undefined) return null;

    return { type: 'cell', x: columnToIndex(col), y: Number(row) - 1 };
  }
}

function columnToIndex(col: string): number {
  let result = 0;
  for (let i = 0; i < col.length; i += 1) {
    result = result * 26 + (col.toUpperCase().charCodeAt(i) - 64);
  }
  return result - 1;
}
