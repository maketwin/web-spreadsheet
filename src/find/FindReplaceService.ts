import type { CellAddress } from '../renderer/coordinate';
import type { Store, SheetInfo } from '../store/Store';
import type { CommandManager } from '../commands/CommandManager';
import type { CellPatch } from '../commands/impl/SetRangeValues';
import { executeRange } from '../util/rangeValues';
import { formulaText } from '../util/cell';
import { flattenRuns, isRich, replaceInRuns } from '../util/richText';
import type { RichTextRun } from '../types';

/** Search scope: active sheet only, or every sheet starting from the active one (Excel "Within"). */
export type FindScope = 'sheet' | 'workbook';

export interface FindOptions {
  readonly findText: string;
  readonly replaceText?: string;
  readonly caseSensitive?: boolean;
  /** Cell must equal the find text exactly (Excel "Match entire cell contents"). */
  readonly matchEntireCell?: boolean;
  /** findText is a regular expression; replacement supports $1 group references. */
  readonly useRegex?: boolean;
  readonly scope?: FindScope;
}

export interface FindMatch {
  readonly sheetId: string;
  readonly sheetName: string;
  readonly r: number;
  readonly c: number;
  readonly text: string;
}

export interface FindResult {
  readonly matches: readonly FindMatch[];
  readonly current: number;
  readonly currentCell: FindMatch | null;
}

export interface ReplaceAllResult {
  /** Occurrences replaced (a cell with three hits counts three, like Excel). */
  readonly replacements: number;
  /** Distinct cells touched. */
  readonly cells: number;
}

/** Invalid regex in FindOptions.useRegex mode. */
export class InvalidFindPatternError extends Error {
  public constructor(pattern: string) {
    super(`无效的正则表达式: ${pattern}`);
    this.name = 'InvalidFindPatternError';
  }
}

interface CompiledMatcher {
  /** Does this cell text match? */
  readonly test: (text: string) => boolean;
  /** Non-overlapping occurrence count in one cell text. */
  readonly countIn: (text: string) => number;
  /** Replace every occurrence inside one cell text. */
  readonly replaceIn: (text: string) => string;
  /** Every occurrence as a flat-text range; `replacement` is pre-expanded ($1 etc.) per hit. */
  readonly rangesIn: (text: string) => ReadonlyArray<{ readonly start: number; readonly end: number; readonly replacement: string }>;
}

/** A matcher result over a cell with no hits. */
const NO_RANGES: ReadonlyArray<{ readonly start: number; readonly end: number; readonly replacement: string }> = [];

function compileMatcher(options: FindOptions): CompiledMatcher {
  const find = options.findText;
  if (find.length === 0) {
    return { test: () => false, countIn: () => 0, replaceIn: (t) => t, rangesIn: () => NO_RANGES };
  }
  if (options.useRegex === true) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(find, options.caseSensitive === true ? 'g' : 'gi');
    } catch {
      throw new InvalidFindPatternError(find);
    }
    // Fresh instance per call — a shared /g regex carries lastIndex state.
    const global = (): RegExp => new RegExp(pattern.source, pattern.flags);
    const replacement = options.replaceText ?? '';
    const rangesIn = (text: string): ReadonlyArray<{ readonly start: number; readonly end: number; readonly replacement: string }> => {
      const re = global();
      const ranges: Array<{ start: number; end: number; replacement: string }> = [];
      let m = re.exec(text);
      while (m !== null) {
        if (m[0].length === 0) re.lastIndex += 1; // zero-width match: advance
        else ranges.push({ start: m.index, end: m.index + m[0].length, replacement: expandReplacement(m[0], pattern, replacement) });
        m = re.exec(text);
      }
      return ranges;
    };
    return {
      test: (text) => rangesIn(text).length > 0,
      countIn: (text) => rangesIn(text).length,
      replaceIn: (text) => text.replace(global(), replacement),
      rangesIn,
    };
  }
  if (options.matchEntireCell === true) {
    const target = options.caseSensitive === true ? find : find.toLowerCase();
    const equals = (text: string): boolean => (options.caseSensitive === true ? text : text.toLowerCase()) === target;
    const replacement = options.replaceText ?? '';
    return {
      test: equals,
      countIn: (text) => (equals(text) ? 1 : 0),
      replaceIn: (text) => (equals(text) ? replacement : text),
      rangesIn: (text) => (equals(text) ? [{ start: 0, end: text.length, replacement }] : NO_RANGES),
    };
  }
  // Substring contains; case-insensitive via lowercased indexOf.
  const needle = options.caseSensitive === true ? find : find.toLowerCase();
  const lower = (text: string): string => (options.caseSensitive === true ? text : text.toLowerCase());
  const indexOf = (text: string, from: number): number => lower(text).indexOf(needle, from);
  const replacement = options.replaceText ?? '';
  const rangesIn = (text: string): ReadonlyArray<{ readonly start: number; readonly end: number; readonly replacement: string }> => {
    const ranges: Array<{ start: number; end: number; replacement: string }> = [];
    let i = indexOf(text, 0);
    while (i >= 0) {
      ranges.push({ start: i, end: i + needle.length, replacement });
      i = indexOf(text, i + needle.length);
    }
    return ranges;
  };
  return {
    test: (text) => indexOf(text, 0) >= 0,
    countIn: (text) => rangesIn(text).length,
    replaceIn: (text) => {
      let out = '';
      let cursor = 0;
      for (;;) {
        const idx = indexOf(text, cursor);
        if (idx < 0) return out + text.slice(cursor);
        out += text.slice(cursor, idx) + replacement;
        cursor = idx + needle.length;
      }
    },
    rangesIn,
  };
}

/** Expand `$1`/`$&`-style references against one match (String.replace semantics). */
function expandReplacement(matchText: string, pattern: RegExp, replacement: string): string {
  if (!/\$/.test(replacement)) return replacement;
  const single = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  return matchText.replace(single, replacement);
}

/** Sheets to search, workbook order rotated so the active sheet comes first (Excel starts there). */function searchSheets(store: Store, scope: FindScope): readonly SheetInfo[] {
  const sheets = store.getSheets();
  if (scope === 'sheet') {
    const active = sheets.find((s) => s.id === store.getActiveSheetId());
    return active !== undefined ? [active] : sheets.slice(0, 1);
  }
  const activeIndex = sheets.findIndex((s) => s.id === store.getActiveSheetId());
  if (activeIndex <= 0) return sheets;
  return [...sheets.slice(activeIndex), ...sheets.slice(0, activeIndex)];
}

/** Parse a "r,c" cell-map key back to coordinates. */
function keyCoords(key: string): readonly [number, number] {
  const sep = key.indexOf(',');
  return [Number(key.slice(0, sep)), Number(key.slice(sep + 1))];
}

/** Searchable source text of a cell: formula source first, then plain text (Excel "Look in: Formulas"). */
function cellSource(cell: { text: string; formula?: string }): string {
  return formulaText(cell) ?? cell.text;
}

/**
 * Patch replacing the given flat-text ranges in one cell. Rich text cells
 * splice at the run level so untouched slices keep their formatting; the
 * replacement inherits the style of the first hit character (Excel behavior).
 */
function replacePatch(cell: { text: string; formula?: string; richText?: readonly RichTextRun[] }, ranges: ReadonlyArray<{ readonly start: number; readonly end: number; readonly replacement: string }>): CellPatch {
  if (cell.formula === undefined && isRich(cell.richText)) {
    const nextRuns = replaceInRuns(cell.richText, ranges);
    const nextText = flattenRuns(nextRuns);
    return isRich(nextRuns) ? { text: nextText, richText: nextRuns } : { text: nextText };
  }
  let next = '';
  let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    next += cell.text.slice(cursor, range.start) + range.replacement;
    cursor = range.end;
  }
  next += cell.text.slice(cursor);
  return { text: next };
}

interface CellWrite {
  readonly sheetId: string;
  readonly r: number;
  readonly c: number;
  readonly patch: CellPatch;
}

export class FindReplaceService {
  private matches: FindMatch[] = [];
  private currentIndex = -1;

  public find(store: Store, options: FindOptions, startFrom?: CellAddress | null): FindResult {
    this.matches = this.searchAll(store, options);
    this.currentIndex = -1;

    if (this.matches.length === 0) {
      return { matches: [], current: -1, currentCell: null };
    }
    const activeSheetId = store.getActiveSheetId();
    if (startFrom !== undefined && startFrom !== null) {
      this.currentIndex = this.findNextIndex(startFrom, activeSheetId);
    } else {
      this.currentIndex = 0;
    }
    return this.snapshot();
  }

  public findNext(): FindResult {
    if (this.matches.length === 0) {
      return { matches: [], current: -1, currentCell: null };
    }
    this.currentIndex = (this.currentIndex + 1) % this.matches.length;
    return this.snapshot();
  }

  public findPrevious(): FindResult {
    if (this.matches.length === 0) {
      return { matches: [], current: -1, currentCell: null };
    }
    this.currentIndex = this.currentIndex <= 0 ? this.matches.length - 1 : this.currentIndex - 1;
    return this.snapshot();
  }

  /** Replace inside the current match's cell, then re-scan and land on the next match after it. */
  public replaceCurrent(store: Store, options: FindOptions, cmdManager?: CommandManager): { result: FindResult; replaced: boolean } {
    const match = this.matches[this.currentIndex];
    if (match === undefined) {
      return { result: this.snapshot(), replaced: false };
    }
    let replaced = false;
    if (options.replaceText !== undefined) {
      const patch = this.replacementPatch(store, match, options);
      if (patch !== undefined) {
        this.applyWrites(store, cmdManager, [{ sheetId: match.sheetId, r: match.r, c: match.c, patch }]);
        replaced = true;
      }
    }
    const result = this.find(store, options, { r: match.r, c: match.c });
    return { result, replaced };
  }

  public replaceAll(store: Store, options: FindOptions, cmdManager?: CommandManager): ReplaceAllResult {
    const matcher = compileMatcher(options);
    let replacements = 0;
    let cells = 0;
    const writes: CellWrite[] = [];
    for (const sheet of searchSheets(store, options.scope ?? 'sheet')) {
      for (const [key, cell] of store.getCells(sheet.id)) {
        const source = cellSource(cell);
        const ranges = matcher.rangesIn(source);
        if (ranges.length <= 0) continue;
        const [r, c] = keyCoords(key);
        if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
        replacements += ranges.length;
        cells += 1;
        writes.push({ sheetId: sheet.id, r, c, patch: replacePatch(cell, ranges) });
      }
    }
    if (writes.length > 0) this.applyWrites(store, cmdManager, writes);
    this.matches = [];
    this.currentIndex = -1;
    return { replacements, cells };
  }

  public getMatches(): readonly FindMatch[] {
    return this.matches;
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  /** Jump the cursor to a match (result-list click); ignored when out of range. */
  public setCurrentIndex(index: number): void {
    if (index >= 0 && index < this.matches.length) this.currentIndex = index;
  }

  /**
   * Write patches through SetRangeValues commands, grouped per target sheet:
   * the sheet is activated for its group (executeRange writes to the active
   * sheet; SetRangeValues records the execution sheet so undo/redo stay
   * correct), a dense group lands as ONE command (single undo), a scattered
   * group falls back to one command per cell. Unmatched cells inside a
   * bounding box pass as `undefined` and are never touched.
   */
  private applyWrites(store: Store, cmdManager: CommandManager | undefined, writes: readonly CellWrite[]): void {
    if (writes.length === 0) return;
    const originalSheet = store.getActiveSheetId();
    const bySheet = new Map<string, CellWrite[]>();
    for (const w of writes) {
      const list = bySheet.get(w.sheetId);
      if (list === undefined) bySheet.set(w.sheetId, [w]);
      else list.push(w);
    }
    for (const [sheetId, list] of bySheet) {
      if (store.getActiveSheetId() !== sheetId) store.activateSheet(sheetId);
      let r1 = Infinity; let c1 = Infinity; let r2 = -1; let c2 = -1;
      for (const w of list) {
        r1 = Math.min(r1, w.r); c1 = Math.min(c1, w.c);
        r2 = Math.max(r2, w.r); c2 = Math.max(c2, w.c);
      }
      const boxArea = (r2 - r1 + 1) * (c2 - c1 + 1);
      if (boxArea <= list.length * 4 + 16) {
        const patchAt = new Map(list.map((w) => [`${w.r},${w.c}`, w.patch]));
        const values: Array<Array<CellPatch | undefined>> = [];
        for (let r = r1; r <= r2; r += 1) {
          const row: Array<CellPatch | undefined> = [];
          for (let c = c1; c <= c2; c += 1) row.push(patchAt.get(`${r},${c}`));
          values.push(row);
        }
        executeRange(store, cmdManager, r1, c1, values);
      } else {
        for (const w of list) executeRange(store, cmdManager, w.r, w.c, [[w.patch]]);
      }
    }
    if (store.getActiveSheetId() !== originalSheet) store.activateSheet(originalSheet);
  }

  /**
   * Rewrites the matched text in one cell. Excel's "Look in: Formulas": a
   * formula cell is rewritten in its formula source (and recalculates), a
   * plain cell in its text. Undefined when the rewrite changes nothing.
   */
  private replacementPatch(store: Store, match: FindMatch, options: FindOptions): CellPatch | undefined {
    if (options.replaceText === undefined) return undefined;
    const cell = store.getCell(match.r, match.c, match.sheetId);
    if (cell === undefined) return undefined;
    const matcher = compileMatcher(options);
    const ranges = matcher.rangesIn(cellSource(cell));
    if (ranges.length === 0) return undefined;
    return replacePatch(cell, ranges);
  }

  private searchAll(store: Store, options: FindOptions): FindMatch[] {
    const results: FindMatch[] = [];
    if (options.findText.length === 0) return results;
    const matcher = compileMatcher(options);
    for (const sheet of searchSheets(store, options.scope ?? 'sheet')) {
      for (const [key, cell] of store.getCells(sheet.id)) {
        if (!matcher.test(cellSource(cell))) continue;
        const [r, c] = keyCoords(key);
        if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
        results.push({ sheetId: sheet.id, sheetName: sheet.name, r, c, text: cellSource(cell) });
      }
    }
    // searchSheets is already workbook-rotated; sort within each sheet group
    // by r then c so navigation runs left-to-right, top-to-bottom (Excel order).
    results.sort((a, b) => {
      if (a.sheetId !== b.sheetId) return 0; // stable sort keeps sheet-group order
      return a.r !== b.r ? a.r - b.r : a.c - b.c;
    });
    return results;
  }

  /** First match strictly after the cursor cell within its sheet, else the first match overall. */
  private findNextIndex(startFrom: CellAddress, activeSheetId: string): number {
    for (let i = 0; i < this.matches.length; i += 1) {
      const m = this.matches[i];
      if (m === undefined || m.sheetId !== activeSheetId) continue;
      if (m.r > startFrom.r || (m.r === startFrom.r && m.c > startFrom.c)) return i;
    }
    return 0;
  }

  private snapshot(): FindResult {
    const match = this.matches[this.currentIndex];
    return {
      matches: this.matches,
      current: this.currentIndex,
      currentCell: match !== undefined ? match : null,
    };
  }
}
