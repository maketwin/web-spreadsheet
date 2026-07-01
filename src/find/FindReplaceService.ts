import type { CellAddress } from '../renderer/coordinate';
import type { Store } from '../store/Store';

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

  public replaceCurrent(store: Store, options: FindOptions): FindResult {
    if (this.currentIndex < 0 || this.currentIndex >= this.matches.length) {
      return { matches: this.matches, current: this.currentIndex, currentCell: null };
    }
    const match = this.matches[this.currentIndex];
    if (match !== undefined && options.replaceText !== undefined) {
      store.setCell(match.r, match.c, { text: options.replaceText });
    }
    return this.find(store, options, match !== undefined ? { r: match.r, c: match.c } : null);
  }

  public replaceAll(store: Store, options: FindOptions): number {
    const allMatches = this.searchAll(store, options);
    let count = 0;
    for (const match of allMatches) {
      if (options.replaceText !== undefined) {
        store.setCell(match.r, match.c, { text: options.replaceText });
        count += 1;
      }
    }
    this.matches = [];
    this.currentIndex = -1;
    return count;
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
