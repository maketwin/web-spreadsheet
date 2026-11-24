import type { Store } from '../store/Store';
import type { Cell, Style } from '../types';
import { evaluate, EXCEL_ERRORS } from '../formula/evaluator';
import { FormulaParser } from '../formula/parser';
import { shiftFormula } from '../util/formulaRefs';
import type { ConditionalOverlay, ConditionalRule } from './ConditionalRule';

/**
 * Size limit of the per-service rule-formula AST cache, same policy (and
 * magnitude) as the formula engine's own MAX_CACHED_FORMULAS. Kept above one
 * full grid (1000×26), so scrolling a single rule end to end fills the cache
 * without ever thrashing it.
 */
export const MAX_CACHED_RULE_FORMULAS = 40_000;

export class ConditionalService {
  private parser = new FormulaParser();
  /** Rule formulas re-parse per visible cell per paint — cache the ASTs. */
  private astCache = new Map<string, ReturnType<FormulaParser['parse']>>();
  /**
   * Icon-set percent thresholds need the range min/max; recomputing them per
   * visible cell per paint is O(range) each — cache per range and drop the
   * whole cache whenever the store's revision moves past the one it was
   * filled at (no subscription needed: every event delivery bumps it).
   */
  private iconStats = new Map<string, { min: number; max: number }>();
  private iconStatsStore: Store | null = null;
  private iconStatsRevision = -1;

  /** Cap override for tests; production services use MAX_CACHED_RULE_FORMULAS. */
  private readonly maxCachedFormulas: number;

  public constructor(maxCachedFormulas: number = MAX_CACHED_RULE_FORMULAS) {
    this.maxCachedFormulas = maxCachedFormulas;
  }

  private parseCached(formula: string): ReturnType<FormulaParser['parse']> {
    if (!this.astCache.has(formula)) {
      // Shifted rule formulas are one entry per visited cell — clear in one
      // go instead of evicting entry by entry (mirrors the formula engine).
      if (this.astCache.size >= this.maxCachedFormulas) this.astCache.clear();
      this.astCache.set(formula, this.parser.parse(formula));
    }
    return this.astCache.get(formula) ?? null;
  }

  /** Compute the conditional overlay for a cell at (r, c) on `sheetId` (default: active sheet). */
  computeOverlay(store: Store, r: number, c: number, sheetId?: string): ConditionalOverlay {
    const rules = store.getConditionalRules(sheetId);
    let style: Partial<Style> | undefined;
    let dataBar: ConditionalOverlay['dataBar'];
    let icon: ConditionalOverlay['icon'];

    // Excel: a rule only paints cells inside the range it was created for.
    for (const [key, ruleList] of rules) {
      const range = parseRangeKey(key);
      if (range === null) continue;
      if (r < range.r1 || r > range.r2 || c < range.c1 || c > range.c2) continue;
      for (const rule of ruleList) {
        if (rule.disabled === true) continue;
        const overlay = this.applyRule(store, r, c, rule, range, key, sheetId);
        if (overlay.style !== undefined) style = { ...style, ...overlay.style };
        if (overlay.dataBar !== undefined) dataBar = overlay.dataBar;
        if (overlay.icon !== undefined) icon = overlay.icon;
      }
    }

    return { style, dataBar, icon };
  }

  private applyRule(store: Store, r: number, c: number, rule: ConditionalRule, range: { r1: number; c1: number; r2: number; c2: number }, rangeKey: string, sheetId?: string): ConditionalOverlay {
    if (rule.type === 'dataBar') return this.applyDataBar(store, r, c, rule, sheetId);
    if (rule.type === 'colorScale') return this.applyColorScale(store, r, c, rule, sheetId);
    if (rule.type === 'cellValue') return this.applyCellValue(store, r, c, rule, sheetId);
    if (rule.type === 'iconSet') return this.applyIconSet(store, r, c, rule, range, rangeKey, sheetId);
    return this.applyFormula(store, rule, range, r, c, sheetId);
  }

  /** Cached numeric min/max of a rule range; invalidated when the store changes. */
  private rangeStats(store: Store, range: { r1: number; c1: number; r2: number; c2: number }, rangeKey: string, sheetId?: string): { min: number; max: number } | null {
    if (this.iconStatsStore !== store || this.iconStatsRevision !== store.revision) {
      this.iconStatsStore = store;
      this.iconStatsRevision = store.revision;
      this.iconStats.clear();
    }
    const cacheKey = `${sheetId ?? ''}|${rangeKey}`;
    const hit = this.iconStats.get(cacheKey);
    if (hit !== undefined) return hit;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let rr = range.r1; rr <= range.r2; rr += 1) {
      for (let cc = range.c1; cc <= range.c2; cc += 1) {
        const n = cellNumericValue(store.getCell(rr, cc, sheetId));
        if (n === null) continue;
        if (n < min) min = n;
        if (n > max) max = n;
      }
    }
    if (min > max) return null;
    const stats = { min, max };
    this.iconStats.set(cacheKey, stats);
    return stats;
  }

  /** Excel icon set: value >= hi → top icon, >= lo → middle, else bottom. */
  private applyIconSet(store: Store, r: number, c: number, rule: ConditionalRule & { type: 'iconSet' }, range: { r1: number; c1: number; r2: number; c2: number }, rangeKey: string, sheetId?: string): ConditionalOverlay {
    const value = cellNumericValue(store.getCell(r, c, sheetId));
    if (value === null) return {};
    const [hiIn, loIn] = rule.thresholds ?? [67, 33];
    let hi = hiIn;
    let lo = loIn;
    if ((rule.basis ?? 'percent') === 'percent') {
      const stats = this.rangeStats(store, range, rangeKey, sheetId);
      if (stats === null) return {};
      hi = stats.min + (hiIn / 100) * (stats.max - stats.min);
      lo = stats.min + (loIn / 100) * (stats.max - stats.min);
    }
    const level = value >= hi ? 0 : value >= lo ? 1 : 2;
    return { icon: { icons: rule.icons, level } };
  }

  private applyCellValue(store: Store, r: number, c: number, rule: ConditionalRule & { type: 'cellValue' }, sheetId?: string): ConditionalOverlay {
    const cell = store.getCell(r, c, sheetId);
    if (cell === undefined) return {};
    // Excel: a blank cell matches no cell-value comparison (it is not 0 and
    // not ''); only `contains`, which tests the text as-is, keeps its result.
    const blank = (cell.value === undefined || cell.value === null) && cell.text === '';
    if (blank && rule.operator !== 'contains') return {};
    const raw = cell.value ?? cell.text;
    if (matchCellValue(raw, rule.operator, rule.value, rule.value2)) return { style: rule.style };
    return {};
  }

  private applyDataBar(store: Store, r: number, c: number, rule: ConditionalRule & { type: 'dataBar' }, sheetId?: string): ConditionalOverlay {
    const value = cellNumericValue(store.getCell(r, c, sheetId));
    if (value === null) return {};
    return { dataBar: { ratio: barRatio(value, rule.min, rule.max), color: rule.color } };
  }

  private applyColorScale(store: Store, r: number, c: number, rule: ConditionalRule & { type: 'colorScale' }, sheetId?: string): ConditionalOverlay {
    const value = cellNumericValue(store.getCell(r, c, sheetId));
    if (value === null) return {};
    const bgcolor = interpolateColor(rule.minColor, rule.maxColor, barRatio(value, rule.min, rule.max));
    return { style: { bgcolor } };
  }

  /**
   * Excel: the formula is written relative to the rule range's top-left cell,
   * so the cell at (r, c) evaluates the formula shifted by its offset from
   * that anchor. `$`-anchored references stay put; a relative reference pushed
   * off the grid becomes `#REF!`, which — like any error result — never
   * counts as a hit.
   */
  private applyFormula(store: Store, rule: ConditionalRule & { type: 'formula' }, range: { r1: number; c1: number; r2: number; c2: number }, r: number, c: number, sheetId?: string): ConditionalOverlay {
    const dr = r - range.r1;
    const dc = c - range.c1;
    // The cache key is the shifted text: every cell of the range parses its
    // variant once, and repaints reuse the cached ASTs.
    const ast = this.parseCached(dr === 0 && dc === 0 ? rule.formula : shiftFormula(rule.formula, dr, dc));
    if (ast === null) return {};
    try {
      const result = evaluate(ast, (x, y, sheetName) =>
        sheetName === undefined
          ? cellValue(store.getCell(y, x, sheetId))
          : cellValue(store.getCellBySheetName(sheetName, y, x)),
      );
      // An error literal (#NAME?, #REF!, …) is not a truthy rule hit.
      if (typeof result === 'string' && EXCEL_ERRORS.has(result)) return {};
      if (isTruthy(result)) return { style: rule.style };
    } catch { /* formula error → no overlay */ }
    return {};
  }
}

/** 0..1 bar position; a degenerate min===max rule shows a full bar, never NaN. */
function barRatio(value: number, min: number, max: number): number {
  if (!(max > min)) return clamp01(value >= max ? 1 : 0);
  return clamp01((value - min) / (max - min));
}

/** Parse the `r1,c1:r2,c2` range key SetConditionalFormat stores rules under. */
function parseRangeKey(key: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const [lo, hi] = key.split(':');
  if (lo === undefined || hi === undefined) return null;
  const nums = [...lo.split(','), ...hi.split(',')].map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isInteger(n))) return null;
  const r1 = nums[0] ?? 0;
  const c1 = nums[1] ?? 0;
  const r2 = nums[2] ?? 0;
  const c2 = nums[3] ?? 0;
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}

function cellNumericValue(cell: Cell | undefined): number | null {
  if (cell === undefined) return null;
  const v = cell.value ?? Number(cell.text);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cellValue(cell: Cell | undefined): string | number | boolean | null {
  if (cell === undefined) return null;
  const v = cell.value;
  if (v === undefined || v === null) return cell.text;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return false;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function interpolateColor(min: string, max: string, t: number): string {
  const a = parseHex(min);
  const b = parseHex(max);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

function parseHex(color: string): { r: number; g: number; b: number } {
  const c = color.replace('#', '');
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

function hex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function matchCellValue(raw: unknown, op: string, value: string | number, value2?: string | number): boolean {
  if (op === 'contains') return String(raw ?? '').toLowerCase().includes(String(value).toLowerCase());
  const n = typeof raw === 'number' ? raw : Number(raw);
  const a = typeof value === 'number' ? value : Number(value);
  const bothNum = Number.isFinite(n) && Number.isFinite(a);
  if (op === 'between') {
    const b = typeof value2 === 'number' ? value2 : Number(value2);
    if (!bothNum || !Number.isFinite(b)) return false;
    return n >= Math.min(a, b) && n <= Math.max(a, b);
  }
  if (bothNum) {
    switch (op) {
      case 'gt': return n > a;
      case 'gte': return n >= a;
      case 'lt': return n < a;
      case 'lte': return n <= a;
      case 'eq': return n === a;
      case 'neq': return n !== a;
      default: return false;
    }
  }
  const ls = String(raw ?? '').toLowerCase();
  const rs = String(value).toLowerCase();
  if (op === 'eq') return ls === rs;
  if (op === 'neq') return ls !== rs;
  return false;
}
