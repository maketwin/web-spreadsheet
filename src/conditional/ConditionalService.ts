import type { Store } from '../store/Store';
import type { Cell, Style } from '../types';
import { evaluate, EXCEL_ERRORS } from '../formula/evaluator';
import { FormulaParser } from '../formula/parser';
import type { ConditionalOverlay, ConditionalRule } from './ConditionalRule';

export class ConditionalService {
  private parser = new FormulaParser();
  /** Rule formulas re-parse per visible cell per paint — cache the ASTs. */
  private astCache = new Map<string, ReturnType<FormulaParser['parse']>>();

  private parseCached(formula: string): ReturnType<FormulaParser['parse']> {
    if (!this.astCache.has(formula)) this.astCache.set(formula, this.parser.parse(formula));
    return this.astCache.get(formula) ?? null;
  }

  /** Compute the conditional overlay for a cell at (r, c) on `sheetId` (default: active sheet). */
  computeOverlay(store: Store, r: number, c: number, sheetId?: string): ConditionalOverlay {
    const rules = store.getConditionalRules(sheetId);
    let style: Partial<Style> | undefined;
    let dataBar: ConditionalOverlay['dataBar'];

    for (const [, ruleList] of rules) {
      for (const rule of ruleList) {
        const overlay = this.applyRule(store, r, c, rule, sheetId);
        if (overlay.style !== undefined) style = { ...style, ...overlay.style };
        if (overlay.dataBar !== undefined) dataBar = overlay.dataBar;
      }
    }

    return { style, dataBar };
  }

  private applyRule(store: Store, r: number, c: number, rule: ConditionalRule, sheetId?: string): ConditionalOverlay {
    if (rule.type === 'dataBar') return this.applyDataBar(store, r, c, rule, sheetId);
    if (rule.type === 'colorScale') return this.applyColorScale(store, r, c, rule, sheetId);
    return this.applyFormula(store, rule, sheetId);
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

  private applyFormula(store: Store, rule: ConditionalRule & { type: 'formula' }, sheetId?: string): ConditionalOverlay {
    const ast = this.parseCached(rule.formula);
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
