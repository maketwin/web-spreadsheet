import type { ValidationRule } from './types';

/** Result of validating a value against a rule. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly message?: string;
}

/** Service for validating cell values against rules. */
export class DataValidationService {
  public validate(value: string, rule: ValidationRule): ValidationResult {
    switch (rule.type) {
      case 'list':
        return this.validateList(value, rule.values);
      case 'integer':
        return this.validateInteger(value, rule.min, rule.max);
      case 'date':
        return this.validateDate(value, rule.minDate, rule.maxDate);
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

  private validateDate(value: string, minDate: string, maxDate: string): ValidationResult {
    const d = Date.parse(value);
    if (Number.isNaN(d)) return { valid: false, message: '请输入有效日期' };
    const min = Date.parse(minDate);
    const max = Date.parse(maxDate);
    if (d < min || d > max) return { valid: false, message: `请输入 ${minDate} 到 ${maxDate} 之间的日期` };
    return { valid: true };
  }
}
