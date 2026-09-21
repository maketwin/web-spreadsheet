/**
 * Excel "General" horizontal alignment:
 * - explicit style.align always wins
 * - finite numbers (and boolean TRUE/FALSE → center) when unset
 * - everything else (text, formula view) → left
 */

export type HAlign = 'left' | 'center' | 'right';

/** Excel indent level → pixels: one level ≈ 0.9× the (zoomed) font size, levels clamped to 0..15. */
export function indentPixels(style: { readonly indent?: number } | undefined, fontSize: number): number {
  return Math.max(0, Math.min(15, style?.indent ?? 0)) * Math.round(fontSize * 0.9);
}

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
