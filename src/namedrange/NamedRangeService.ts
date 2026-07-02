import type { Store } from '../store/Store';
import type { NamedRangeDef } from './types';
import { xy2expr } from '../util/alphabet';

/** Parse internal range format "r1,c1:r2,c2" into coordinates. */
function parseInternalRange(range: string): { r1: number; c1: number; r2: number; c2: number } | undefined {
  const parts = range.split(':');
  const startParts = parts[0]?.split(',').map(Number);
  const endParts = parts[1]?.split(',').map(Number);
  if (startParts === undefined || startParts.length < 2) return undefined;
  const r1 = startParts[0] ?? 0;
  const c1 = startParts[1] ?? 0;
  const r2 = endParts?.[0] ?? r1;
  const c2 = endParts?.[1] ?? c1;
  return { r1, c1, r2, c2 };
}

/** Service for managing named ranges. */
export class NamedRangeService {
  public add(store: Store, name: string, range: string, sheetId?: string): void {
    const def: NamedRangeDef = { range, ...(sheetId !== undefined ? { sheetId } : {}) };
    store.setNamedRange(name, def, sheetId);
  }

  public remove(store: Store, name: string, sheetId?: string): void {
    store.removeNamedRange(name, sheetId);
  }

  public lookup(store: Store, name: string, sheetId?: string): NamedRangeDef | undefined {
    return store.getNamedRange(name, sheetId);
  }

  /** Resolve a name to an A1-style range string, e.g. "A1:B5". */
  public resolveToA1(store: Store, name: string, sheetId?: string): string | undefined {
    const def = this.lookup(store, name, sheetId);
    if (def === undefined) return undefined;
    const coords = parseInternalRange(def.range);
    if (coords === undefined) return undefined;
    return `${xy2expr(coords.c1, coords.r1)}:${xy2expr(coords.c2, coords.r2)}`;
  }

  /** List all named ranges. */
  public list(store: Store, sheetId?: string): readonly [string, NamedRangeDef][] {
    return store.getNamedRanges(sheetId);
  }

  /** Replace named range references in a formula string with internal range format. */
  public resolveFormula(store: Store, formula: string, sheetId?: string): string {
    const ranges = this.list(store, sheetId);
    let result = formula;
    for (const [name, def] of ranges) {
      const coords = parseInternalRange(def.range);
      if (coords === undefined) continue;
      const rangeStr = `${coords.r1},${coords.c1}:${coords.r2},${coords.c2}`;
      const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
      result = result.replace(regex, rangeStr);
    }
    return result;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
