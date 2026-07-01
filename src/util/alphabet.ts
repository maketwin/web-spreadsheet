const A_CODE = 65;
const ALPHABET_SIZE = 26;

export function num2alpha(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid column index: ${n}`);
  }

  let result = '';
  let num = n;
  while (num >= 0) {
    result = String.fromCharCode(A_CODE + (num % ALPHABET_SIZE)) + result;
    num = Math.floor(num / ALPHABET_SIZE) - 1;
  }
  return result;
}

export function alpha2num(s: string): number {
  if (!/^[A-Z]+$/.test(s)) {
    throw new Error(`Invalid column alpha: ${s}`);
  }

  let result = 0;
  for (let i = 0; i < s.length; i += 1) {
    result = result * ALPHABET_SIZE + (s.charCodeAt(i) - A_CODE + 1);
  }
  return result - 1;
}

export function expr2xy(expr: string): { x: number; y: number } {
  const match = expr.match(/^([A-Z]+)([1-9]\d*)$/);
  if (match === null) {
    throw new Error(`Invalid cell expr: ${expr}`);
  }

  const col = match[1];
  const row = match[2];
  if (col === undefined || row === undefined) {
    throw new Error(`Invalid cell expr: ${expr}`);
  }

  return { x: alpha2num(col), y: Number.parseInt(row, 10) - 1 };
}

export function xy2expr(x: number, y: number): string {
  if (!Number.isInteger(y) || y < 0) {
    throw new Error(`Invalid row index: ${y}`);
  }

  return `${num2alpha(x)}${y + 1}`;
}
