import type { Cell } from '../types';
import type { Store } from '../store/Store';
import type { FormulaValue } from '../formula/types';
import { evaluate } from '../formula/evaluator';
import { FormulaParser } from '../formula/parser';
import { shiftFormula } from '../formula/refRewrite';
import { parseInternalRange } from '../util/rangeNotation';
import type { ValidationRule } from './types';

/** Result of validating a value against a rule. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly message?: string;
}

/**
 * Optional context for rules that need the surrounding sheet — custom
 * formulas. With it, the formula is evaluated against the real cells: it is
 * shifted to the validated cell's offset from the rule range's top-left
 * (Excel semantics), references to the validated cell read the candidate
 * value, and references to other cells read the store. Without it the sheet
 * is unknown: references cannot be resolved, and a custom formula degenerates
 * to reading the candidate value for every reference.
 */
export interface ValidationContext {
  readonly store: Store;
  /** The cell being validated. */
  readonly r: number;
  readonly c: number;
  /** Defaults to the store's active sheet. */
  readonly sheetId?: string;
}

/** Service for validating cell values against rules. */
export class DataValidationService {
  private parser = new FormulaParser();

  public validate(value: string, rule: ValidationRule, context?: ValidationContext): ValidationResult {
    // Excel's "Ignore blank" is on by default: an empty candidate passes every
    // rule type, so clearing a cell is never blocked.
    if (value === '') return { valid: true };
    switch (rule.type) {
      case 'list':
        return this.validateList(value, rule.values);
      case 'integer':
        return this.validateInteger(value, rule.min, rule.max);
      case 'date':
        return this.validateDate(value, rule.minDate, rule.maxDate);
      case 'decimal':
        return this.validateDecimal(value, rule.min, rule.max);
      case 'textLength':
        return this.validateTextLength(value, rule.min, rule.max);
      case 'custom':
        return this.validateCustom(value, rule.formula, context);
    }
  }

  private validateList(value: string, allowed: readonly string[]): ValidationResult {
    if (allowed.includes(value)) return { valid: true };
    return { valid: false, message: `值 "${value}" 不在允许列表中` };
  }

  private validateInteger(value: string, min: number, max: number): ValidationResult {
    const num = Number(value);
    if (!Number.isInteger(num)) return { valid: false, message: '请输入整数' };
    if (num < min || num > max) return { valid: false, message: `请输入 ${min} 到 ${max} 之间的整数` };
    return { valid: true };
  }

  private validateDecimal(value: string, min: number, max: number): ValidationResult {
    const num = Number(value);
    if (!Number.isFinite(num)) return { valid: false, message: '请输入数字' };
    if (num < min || num > max) return { valid: false, message: `请输入 ${min} 到 ${max} 之间的数字` };
    return { valid: true };
  }

  private validateTextLength(value: string, min: number, max: number): ValidationResult {
    const len = value.length;
    if (len < min || len > max) return { valid: false, message: `文本长度需在 ${min}–${max} 之间` };
    return { valid: true };
  }

  /**
   * Excel custom: the formula is written relative to the rule range's
   * top-left cell and must evaluate to TRUE for the candidate to pass. With a
   * context the formula is shifted to the validated cell's offset and its
   * references read the real cells; without one every reference reads the
   * candidate value (legacy behaviour — references cannot be resolved).
   */
  private validateCustom(value: string, formula: string, context?: ValidationContext): ValidationResult {
    const source = formula.startsWith('=') ? formula : `=${formula}`;
    // Without a context (or without a matching stored range) the validated
    // cell is its own anchor, so the formula is used exactly as written.
    let text = source;
    if (context !== undefined) {
      const origin = this.ruleOrigin(formula, context) ?? { r1: context.r, c1: context.c };
      text = shiftFormula(source, context.r - origin.r1, context.c - origin.c1);
    }
    const ast = this.parser.parse(text);
    if (ast === null) return { valid: false, message: '自定义公式无效' };
    try {
      const result = evaluate(ast, context === undefined
        ? () => value
        : (x, y, sheetName) => {
          if (sheetName !== undefined) return storedCellValue(context.store.getCellBySheetName(sheetName, y, x));
          // The validated cell itself: the candidate, typed as Excel would.
          if (x === context.c && y === context.r) return candidateCellValue(value);
          return storedCellValue(context.store.getCell(y, x, context.sheetId));
        });
      const ok = result === true || result === 1 || result === 'TRUE';
      return ok ? { valid: true } : { valid: false, message: '不满足自定义公式' };
    } catch {
      return { valid: false, message: '自定义公式无效' };
    }
  }

  /** Top-left of the stored range that holds this exact custom rule and contains (r, c); null when none matches. */
  private ruleOrigin(formula: string, context: ValidationContext): { r1: number; c1: number } | null {
    for (const [key, stored] of context.store.getValidationRules(context.sheetId)) {
      if (stored.type !== 'custom' || stored.formula !== formula) continue;
      const range = parseInternalRange(key);
      if (range === null) continue;
      if (context.r < range.r1 || context.r > range.r2 || context.c < range.c1 || context.c > range.c2) continue;
      return { r1: range.r1, c1: range.c1 };
    }
    return null;
  }

  private validateDate(value: string, minDate: string, maxDate: string): ValidationResult {
    const d = Date.parse(value);
    if (Number.isNaN(d)) return { valid: false, message: '请输入有效日期' };
    const min = Date.parse(minDate);
    const max = Date.parse(maxDate);
    if (d < min || d > max) return { valid: false, message: `请输入 ${minDate} 到 ${maxDate} 之间的日期` };
    return { valid: true };
  }
}

/** The candidate as Excel types it: numeric text becomes a number, empty is blank. */
function candidateCellValue(value: string): FormulaValue {
  if (value === '') return null;
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) ? n : value;
}

/** A cell as the formula engine sees it: `value ?? text`; a missing cell is blank. */
function storedCellValue(cell: Cell | undefined): FormulaValue {
  if (cell === undefined) return null;
  const v = cell.value;
  if (v === undefined || v === null) return cell.text;
  if (v instanceof Date) return v.toISOString();
  return v;
}
