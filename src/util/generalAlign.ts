/**
 * Excel "General" horizontal alignment:
 * - explicit style.align always wins
 * - finite numbers (and boolean TRUE/FALSE → center) when unset
 * - everything else (text, formula view) → left
 */

export type HAlign = 'left' | 'center' | 'right';

export function resolveCellAlign(
  styleAlign: HAlign | undefined,
  value: unknown,
  opts?: { readonly showFormula?: boolean; readonly formula?: string | undefined },
): HAlign {
  if (styleAlign !== undefined) return styleAlign;
  if (opts?.showFormula === true && opts.formula !== undefined) return 'left';
  if (typeof value === 'boolean') return 'center';
  if (typeof value === 'number' && Number.isFinite(value)) return 'right';
  return 'left';
}
