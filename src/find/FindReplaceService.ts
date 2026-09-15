import type { CellAddress } from '../renderer/coordinate';
import type { Store } from '../store/Store';
import type { CommandManager } from '../commands/CommandManager';
import type { CellPatch } from '../commands/impl/SetRangeValues';
import { executeRange } from '../util/rangeValues';
import { formulaText } from '../util/cell';

/** Replace every occurrence of the find text inside `text` (case-aware), leaving the rest of the cell intact (Excel). */
export function replaceMatch(text: string, options: FindOptions): string {
  const replacement = options.replaceText ?? '';
  const find = options.findText;
  if (find.length === 0) return text;
  if (options.caseSensitive === true) {
    return text.split(find).join(replacement);
  }
  const lowerText = text.toLowerCase();
  const lowerFind = find.toLowerCase();
  let out = '';
  let i = 0;
  while (i <= text.length) {
    const idx = lowerText.indexOf(lowerFind, i);
    if (idx < 0) { out += text.slice(i); break; }
    out += text.slice(i, idx) + replacement;
    i = idx + find.length;
  }
  return out;
}

export interface FindMatch {
  readonly r: number;
  readonly c: number;
  readonly text: string;
}

export interface FindResult {
  readonly matches: readonly FindMatch[];
  readonly current: number;
  readonly currentCell: CellAddress | null;
}

export interface FindOptions {
  readonly findText: string;
  readonly replaceText?: string;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
}

/** Search all cells in the store for matching text. */
/** Parse a "r,c" patch map key back to coordinates. */
function patchKeyCoords(key: string): readonly [number, number] {
  const sep = key.indexOf(',');
  return [Number(key.slice(0, sep)), Number(key.slice(sep + 1))];
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

    if (startFrom !== undefined && startFrom !== null) {
      this.currentIndex = this.findNextIndex(startFrom);
    } else {
      this.currentIndex = 0;
    }

    const match = this.matches[this.currentIndex];
    return {
      matches: this.matches,
      current: this.currentIndex,
      currentCell: match !== undefined ? { r: match.r, c: match.c } : null,
    };
  }

  public findNext(): FindResult {
    if (this.matches.length === 0) {
      return { matches: [], current: -1, currentCell: null };
    }
    this.currentIndex = (this.currentIndex + 1) % this.matches.length;
    const match = this.matches[this.currentIndex];
    return {
      matches: this.matches,
      current: this.currentIndex,
      currentCell: match !== undefined ? { r: match.r, c: match.c } : null,
    };
  }

  public replaceCurrent(store: Store, options: FindOptions, cmdManager?: CommandManager): FindResult {
    if (this.currentIndex < 0 || this.currentIndex >= this.matches.length) {
      return { matches: this.matches, current: this.currentIndex, currentCell: null };
    }
    const match = this.matches[this.currentIndex];
    if (match !== undefined && options.replaceText !== undefined) {
      const patch = this.replacementPatch(store, match.r, match.c, options);
      if (patch !== undefined) executeRange(store, cmdManager, match.r, match.c, [[patch]]);
    }
    return this.find(store, options, match !== undefined ? { r: match.r, c: match.c } : null);
  }

  public replaceAll(store: Store, options: FindOptions, cmdManager?: CommandManager): number {
    const allMatches = this.searchAll(store, options);
    let count = 0;
    const patches = new Map<string, CellPatch>();
    for (const match of allMatches) {
      if (options.replaceText === undefined) continue;
      const patch = this.replacementPatch(store, match.r, match.c, options);
      if (patch !== undefined) { patches.set(`${match.r},${match.c}`, patch); count += 1; }
    }
    if (patches.size > 0) this.applyScattered(store, cmdManager, patches);
    this.matches = [];
    this.currentIndex = -1;
    return count;
  }

  /**
   * Excel's Replace All is one undo step. Matches usually sit in a compact
   * block, so a single bounding-box SetRangeValues covers it; scattered
   * matches (huge box) fall back to per-cell patches — still undoable, just
   * not one step.
   */
  private applyScattered(store: Store, cmdManager: CommandManager | undefined, patches: Map<string, CellPatch>): void {
    let r1 = Infinity; let c1 = Infinity; let r2 = -1; let c2 = -1;
    for (const key of patches.keys()) {
      const [r, c] = patchKeyCoords(key);
      r1 = Math.min(r1, r); c1 = Math.min(c1, c); r2 = Math.max(r2, r); c2 = Math.max(c2, c);
    }
    const boxArea = (r2 - r1 + 1) * (c2 - c1 + 1);
    if (boxArea > patches.size * 4 + 16) {
      for (const [key, patch] of patches) {
        const [r, c] = patchKeyCoords(key);
        executeRange(store, cmdManager, r, c, [[patch]]);
      }
      return;
    }
    const values: CellPatch[][] = [];
    for (let r = r1; r <= r2; r += 1) {
      const row: CellPatch[] = [];
      for (let c = c1; c <= c2; c += 1) {
        const patch = patches.get(`${r},${c}`);
        row.push(patch ?? this.identityPatch(store, r, c));
      }
      values.push(row);
    }
    executeRange(store, cmdManager, r1, c1, values);
  }

  /** Patch for an untouched cell inside a Replace All bounding box: keep it byte-identical. */
  private identityPatch(store: Store, r: number, c: number): CellPatch {
    const cell = store.getCell(r, c);
    if (cell === undefined) return { text: '' };
    const formula = formulaText(cell);
    if (formula !== undefined) return { text: cell.text, formula };
    return { text: cell.text };
  }

  /**
   * Patch rewriting the matched substring in one cell. Excel's default
   * "Look in: Formulas": a formula cell is rewritten in its formula source, a
   * plain cell in its text. Undefined when the rewrite changes nothing.
   */
  private replacementPatch(store: Store, r: number, c: number, options: FindOptions): CellPatch | undefined {
    if (options.replaceText === undefined) return undefined;
    const cell = store.getCell(r, c);
    const source = formulaText(cell) ?? cell?.text ?? '';
    const next = replaceMatch(source, options);
    if (next === source) return undefined;
    return { text: next };
  }

  public getMatches(): readonly FindMatch[] {
    return this.matches;
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  private searchAll(store: Store, options: FindOptions): FindMatch[] {
    const results: FindMatch[] = [];
    if (options.findText.length === 0) return results;

    const cells = store.getCells();
    for (const [key, cell] of cells) {
      const text = cell.text;
      if (this.matchText(text, options)) {
        const parts = key.split(',');
        const r = Number(parts[0]);
        const c = Number(parts[1]);
        if (!Number.isNaN(r) && !Number.isNaN(c)) {
          results.push({ r, c, text });
        }
      }
    }

    results.sort((a, b) => a.r !== b.r ? a.r - b.r : a.c - b.c);
    return results;
  }

  private matchText(text: string, options: FindOptions): boolean {
    const target = options.caseSensitive === true ? text : text.toLowerCase();
    const find = options.caseSensitive === true ? options.findText : options.findText.toLowerCase();
    if (options.wholeWord === true) {
      return target === find;
    }
    return target.includes(find);
  }

  private findNextIndex(startFrom: CellAddress): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.matches.length; i += 1) {
      const m = this.matches[i];
      if (m === undefined) continue;
      const after = m.r > startFrom.r || (m.r === startFrom.r && m.c > startFrom.c);
      if (after) {
        const dist = (m.r - startFrom.r) * 10000 + (m.c - startFrom.c);
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
    }
    return best >= 0 ? best : 0;
  }
}
