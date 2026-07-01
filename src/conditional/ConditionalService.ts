import type { Store } from '../store/Store';
import type { Cell } from '../types';
import { evaluate } from '../formula/evaluator';
import { FormulaParser } from '../formula/parser';
import type { ConditionalOverlay, ConditionalRule } from './ConditionalRule';

export class ConditionalService {
  private parser = new FormulaParser();

  /** Compute the conditional overlay for a cell at (r, c). */
  computeOverlay(store: Store, r: number, c: number): ConditionalOverlay {
    const rules = store.getConditionalRules();
    let style: Partial<import('../types').Style> | undefined;
    let dataBar: ConditionalOverlay['dataBar'];

    for (const [, ruleList] of rules) {
      for (const rule of ruleList) {
        const overlay = this.applyRule(store, r, c, rule);
        if (overlay.style !== undefined) style = { ...style, ...overlay.style };
        if (overlay.dataBar !== undefined) dataBar = overlay.dataBar;
      }
    }

    return { style, dataBar };
  }

  private applyRule(store: Store, r: number, c: number, rule: ConditionalRule): ConditionalOverlay {
    if (rule.type === 'dataBar') return this.applyDataBar(store, r, c, rule);
    if (rule.type === 'colorScale') return this.applyColorScale(store, r, c, rule);
    return this.applyFormula(store, rule);
  }

  private applyDataBar(store: Store, r: number, c: number, rule: ConditionalRule & { type: 'dataBar' }): ConditionalOverlay {
    const value = cellNumericValue(store.getCell(r, c));
    if (value === null) return {};
    const ratio = clamp01((value - rule.min) / (rule.max - rule.min));
    return { dataBar: { ratio, color: rule.color } };
  }

  private applyColorScale(store: Store, r: number, c: number, rule: ConditionalRule & { type: 'colorScale' }): ConditionalOverlay {
    const value = cellNumericValue(store.getCell(r, c));
    if (value === null) return {};
    const t = clamp01((value - rule.min) / (rule.max - rule.min));
    const bgcolor = interpolateColor(rule.minColor, rule.maxColor, t);
    return { style: { bgcolor } };
  }

  private applyFormula(store: Store, rule: ConditionalRule & { type: 'formula' }): ConditionalOverlay {
    const ast = this.parser.parse(rule.formula);
    if (ast === null) return {};
    try {
      const result = evaluate(ast, (x, y, sheetName) =>
        sheetName === undefined
          ? cellValue(store.getCell(y, x))
          : cellValue(store.getCellBySheetName(sheetName, y, x)),
      );
      if (isTruthy(result)) return { style: rule.style };
    } catch { /* formula error → no overlay */ }
    return {};
  }
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
