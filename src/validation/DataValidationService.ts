import type { ValidationRule } from './types';
import { evaluate } from '../formula/evaluator';
import { FormulaParser } from '../formula/parser';

/** Result of validating a value against a rule. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly message?: string;
}

/** Service for validating cell values against rules. */
export class DataValidationService {
  private parser = new FormulaParser();

  public validate(value: string, rule: ValidationRule): ValidationResult {
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
        return this.validateCustom(value, rule.formula);
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

  private validateCustom(value: string, formula: string): ValidationResult {
    // Excel custom: formula should evaluate to TRUE. `value` is available as a hint via A1-less parse —
    // we evaluate the formula string; callers typically write formulas referencing the active cell.
    const ast = this.parser.parse(formula.startsWith('=') ? formula : `=${formula}`);
    if (ast === null) return { valid: false, message: '自定义公式无效' };
    try {
      const result = evaluate(ast, () => value);
      const ok = result === true || result === 1 || result === 'TRUE';
      return ok ? { valid: true } : { valid: false, message: '不满足自定义公式' };
    } catch {
      return { valid: false, message: '自定义公式无效' };
    }
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
