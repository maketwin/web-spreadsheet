import type { RunStyle, RichTextRun, Style } from '../types';

/**
 * Pure rich-text run operations. `Cell.richText` is canonical only together
 * with `Cell.text` (the flattened string); these helpers are the single place
 * that constructs or slices run arrays so the invariant "text === flatten(runs)"
 * cannot drift. Every operation returns a complete run array (full text,
 * possibly plain) — the caller decides storage with isRich/normalizeRuns:
 * plain cells never store runs.
 */

/** Resolved run appearance: cell style with the run's overrides applied. */
export interface ResolvedRunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  fontSize: number;
  fontFamily?: string | undefined;
  color?: string | undefined;
  vertAlign?: 'subscript' | 'superscript' | undefined;
}

/** Like Partial<RunStyle> but allows explicit `undefined` = "clear the override". */
export type RunStylePatch = { readonly [K in keyof RunStyle]?: RunStyle[K] | undefined };

export function flattenRuns(runs: readonly RichTextRun[]): string {
  return runs.map((run) => run.text).join('');
}

/** True when the array carries actual formatting (would survive a flatten→resplit round-trip). */
export function isRich(runs: readonly RichTextRun[] | undefined): runs is readonly RichTextRun[] {
  if (runs === undefined || runs.length === 0) return false;
  if (runs.length > 1) return true;
  const only = runs[0]!;
  return only.style !== undefined && Object.keys(only.style).length > 0;
}

/** Trim empty runs and merge runs with identical styles. */
export function mergeRuns(runs: readonly RichTextRun[] | undefined): RichTextRun[] {
  if (runs === undefined) return [];
  const merged: RichTextRun[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const prev = merged[merged.length - 1];
    if (prev !== undefined && sameRunStyle(prev.style, run.style)) prev.text += run.text;
    else merged.push({ text: run.text, ...(run.style !== undefined ? { style: { ...run.style } } : {}) });
  }
  return merged;
}

/** Storage-boundary form of mergeRuns: plain results collapse to undefined. */
export function normalizeRuns(runs: readonly RichTextRun[] | undefined): RichTextRun[] | undefined {
  const merged = mergeRuns(runs);
  return isRich(merged) ? merged : undefined;
}

export function sameRunStyle(a: RunStyle | undefined, b: RunStyle | undefined): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

/** Style in effect at a flat-text offset (the last run's style at/after the end). */
export function runStyleAt(runs: readonly RichTextRun[], offset: number): RunStyle | undefined {
  if (runs.length === 0) return undefined;
  let pos = 0;
  for (const run of runs) {
    pos += run.text.length;
    if (offset < pos) return run.style;
  }
  return runs[runs.length - 1]!.style;
}

/** Cell style ⊕ run overrides; renderer-facing resolved form. */
export function effectiveRunStyle(cellStyle: Style | undefined, run: RichTextRun): ResolvedRunStyle {
  const s = run.style ?? {};
  return {
    bold: s.bold ?? cellStyle?.bold === true,
    italic: s.italic ?? cellStyle?.italic === true,
    underline: s.underline ?? cellStyle?.underline === true,
    strike: s.strike === true,
    fontSize: s.fontSize ?? cellStyle?.fontSize ?? 11,
    fontFamily: s.fontFamily ?? cellStyle?.fontFamily,
    color: s.color ?? cellStyle?.color,
    vertAlign: s.vertAlign,
  };
}

/**
 * Whether EVERY character of flat range [start, end) effectively carries the
 * run attribute — run overrides first, then the cell style (Excel toggle
 * semantics: only when the whole selection has it does the next
 * click/shortcut turn it off).
 */
export function charsAllHave(runs: readonly RichTextRun[], start: number, end: number, key: 'bold' | 'italic' | 'underline', cellStyle?: Style | undefined): boolean {
  let pos = 0;
  let checked = 0;
  let all = true;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    const overlapLo = Math.max(pos, start);
    const overlapHi = Math.min(runEnd, end);
    if (overlapLo < overlapHi) {
      checked += overlapHi - overlapLo;
      if (!((run.style?.[key] ?? cellStyle?.[key] === true) === true)) all = false;
    }
    pos = runEnd;
    if (pos >= end && checked > 0) break;
  }
  return checked > 0 && all;
}

function styleAtOffset(runs: readonly RichTextRun[], offset: number): RunStyle | undefined {
  if (runs.length === 0) return undefined;
  return runStyleAt(runs, Math.max(0, Math.min(offset, flattenRuns(runs).length - 1)));
}

/**
 * Replace flat-text range [start, end) with `replacement`, which inherits the
 * style of the first replaced character. Offsets clamp to the text; an empty
 * replacement degrades to a delete.
 */
export function replaceRangeInRuns(runs: readonly RichTextRun[], start: number, end: number, replacement: string): RichTextRun[] {
  const flat = flattenRuns(runs);
  const lo = Math.max(0, Math.min(start, flat.length));
  const hi = Math.max(lo, Math.min(end, flat.length));
  const inherited = styleAtOffset(runs, lo);
  const middle: RichTextRun[] = replacement === '' ? [] : [{ text: replacement, ...(inherited !== undefined ? { style: { ...inherited } } : {}) }];
  return mergeRuns([...sliceRuns(runs, 0, lo), ...middle, ...sliceRuns(runs, hi, flat.length)]);
}

/** Apply `ranges` (flat-text, non-overlapping, any order), splicing each range's replacement (else `replacement`) at it. */
export function replaceInRuns(
  runs: readonly RichTextRun[],
  ranges: ReadonlyArray<{ readonly start: number; readonly end: number; readonly replacement?: string }>,
  replacement = '',
): RichTextRun[] {
  const ordered = [...ranges].sort((a, b) => a.start - b.start);
  let result: RichTextRun[] = [...runs];
  let shift = 0;
  for (const range of ordered) {
    const repl = range.replacement ?? replacement;
    result = replaceRangeInRuns(result, range.start + shift, range.end + shift, repl);
    shift += repl.length - (range.end - range.start);
  }
  return result;
}

/** Insert text at a flat offset; the new text takes the style at the insertion point unless given. */
export function insertAtRuns(runs: readonly RichTextRun[], offset: number, text: string, style?: RunStyle): RichTextRun[] {
  if (text === '') return [...runs];
  const inherited = style ?? styleAtOffset(runs, offset);
  return mergeRuns([...sliceRuns(runs, 0, offset), { text, ...(inherited !== undefined ? { style: { ...inherited } } : {}) }, ...sliceRuns(runs, offset, flattenRuns(runs).length)]);
}

/** Remove flat-text range [start, end). */
export function deleteRangeRuns(runs: readonly RichTextRun[], start: number, end: number): RichTextRun[] {
  const flat = flattenRuns(runs);
  const lo = Math.max(0, Math.min(start, flat.length));
  const hi = Math.max(lo, Math.min(end, flat.length));
  return mergeRuns([...sliceRuns(runs, 0, lo), ...sliceRuns(runs, hi, flat.length)]);
}

/**
 * Apply a style patch to flat range [start, end): runs partially covered are
 * split at the boundaries, covered slices get the patch merged in. Explicit
 * `false` forces the attribute off (independent of the cell style); `undefined`
 * clears the override so the cell style shows through again. This is the
 * model-level form of "select some characters and click Bold".
 */
export function applyRunStyle(runs: readonly RichTextRun[], start: number, end: number, patch: RunStylePatch): RichTextRun[] {
  const total = flattenRuns(runs).length;
  const lo = Math.max(0, Math.min(start, total));
  const hi = Math.max(lo, Math.min(end, total));
  const out: RichTextRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    const overlapLo = Math.max(pos, lo);
    const overlapHi = Math.min(runEnd, hi);
    if (overlapLo < overlapHi) {
      if (pos < overlapLo) out.push({ text: run.text.slice(0, overlapLo - pos), ...(run.style !== undefined ? { style: { ...run.style } } : {}) });
      const merged: RunStyle = { ...(run.style ?? {}) };
      for (const [key, value] of Object.entries(patch) as Array<[keyof RunStyle, RunStyle[keyof RunStyle]]>) {
        if (value === undefined) delete merged[key];
        else (merged as Record<string, unknown>)[key] = value;
      }
      out.push({ text: run.text.slice(overlapLo - pos, overlapHi - pos), style: merged });
      if (runEnd > overlapHi) out.push({ text: run.text.slice(overlapHi - pos), ...(run.style !== undefined ? { style: { ...run.style } } : {}) });
    } else {
      out.push({ text: run.text, ...(run.style !== undefined ? { style: { ...run.style } } : {}) });
    }
    pos = runEnd;
  }
  return mergeRuns(out);
}

/** Resplit plain text into run form (undefined when unstyled, for storage). */
export function runsFromText(text: string): RichTextRun[] | undefined {
  return normalizeRuns([{ text }]);
}

/** Runs for flat range [start, end), styles preserved. */
function sliceRuns(runs: readonly RichTextRun[], start: number, end: number): RichTextRun[] {
  const out: RichTextRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    const overlapLo = Math.max(pos, start);
    const overlapHi = Math.min(runEnd, end);
    if (overlapLo < overlapHi) out.push({ text: run.text.slice(overlapLo - pos, overlapHi - pos), ...(run.style !== undefined ? { style: { ...run.style } } : {}) });
    pos = runEnd;
  }
  return out;
}
