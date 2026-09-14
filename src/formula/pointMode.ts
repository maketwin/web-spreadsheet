/**
 * Excel formula "point mode" helpers: while typing a formula, arrow keys and
 * mouse clicks insert/adjust cell references instead of committing or moving
 * the selection.
 */

/** True when the text before the caret is a formula awaiting an operand. */
export function isPointTrigger(head: string): boolean {
  if (!head.startsWith('=')) return false;
  const t = head.trimEnd();
  return t === '=' || /[+\-*/^&=<>(,:;]$/.test(t);
}

// Lookbehind keeps us from matching the "et1" inside "Sheet1".
const TRAILING_REF = /(?<![A-Za-z0-9_$!])\$?[A-Za-z]{1,3}\$?\d{1,7}$/;

/** True when the head text ends with a (possibly partial) cell reference. */
export function endsWithRef(head: string): boolean {
  return TRAILING_REF.test(head);
}

/** Insert `ref` at the end of `head`; with `replace`, swap a trailing reference instead. */
export function upsertRef(head: string, ref: string, replace: boolean): string {
  if (replace) return head.replace(TRAILING_REF, ref);
  return head + ref;
}

export interface RefSpan { readonly start: number; readonly end: number; readonly text: string }

const REF_RE = /(?<![A-Za-z0-9_$!])\$?[A-Za-z]{1,3}\$?\d{1,7}(?![\d(])/g;

/** Reference token containing the caret, or ending exactly at it (Excel F4 target). */
export function refAtCaret(value: string, caret: number): RefSpan | undefined {
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(value)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (caret >= start && caret <= end) return { start, end, text: m[0] };
  }
  return undefined;
}

/** Excel F4 dollar cycling: A1 → $A$1 → A$1 → $A1 → A1. */
export function cycleDollars(ref: string): string {
  const m = /^(?<cd>\$?)(?<col>[A-Za-z]{1,3})(?<rd>\$?)(?<row>\d{1,7})$/.exec(ref);
  if (m === null || m.groups === undefined) return ref;
  const { cd, col, rd, row } = m.groups as { cd: string; col: string; rd: string; row: string };
  if (cd === '' && rd === '') return `$${col}$${row}`;
  if (cd === '$' && rd === '$') return `${col}$${row}`;
  if (cd === '' && rd === '$') return `$${col}${row}`;
  return `${col}${row}`;
}
