import { describe, it, expect } from 'vitest';
import { DataValidationService } from '../../src/validation/DataValidationService';
import type { ValidationRule } from '../../src/validation/types';
import { Store } from '../../src/store/Store';
import { SetValidationCommand } from '../../src/commands/impl/SetValidation';

describe('DataValidationService', () => {
  const svc = new DataValidationService();

  it('validates list type — allowed value', () => {
    const rule: ValidationRule = { type: 'list', values: ['apple', 'banana', 'cherry'] };
    expect(svc.validate('apple', rule)).toEqual({ valid: true });
  });

  it('validates list type — disallowed value', () => {
    const rule: ValidationRule = { type: 'list', values: ['apple', 'banana', 'cherry'] };
    const result = svc.validate('orange', rule);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('orange');
  });

  it('validates integer range — within range', () => {
    const rule: ValidationRule = { type: 'integer', min: 1, max: 100 };
    expect(svc.validate('50', rule)).toEqual({ valid: true });
  });

  it('validates integer range — out of range', () => {
    const rule: ValidationRule = { type: 'integer', min: 1, max: 100 };
    const result = svc.validate('200', rule);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('1');
    expect(result.message).toContain('100');
  });

  it('validates integer range — non-integer', () => {
    const rule: ValidationRule = { type: 'integer', min: 1, max: 100 };
    const result = svc.validate('3.5', rule);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('整数');
  });

  it('validates date range — within range', () => {
    const rule: ValidationRule = { type: 'date', minDate: '2024-01-01', maxDate: '2024-12-31' };
    expect(svc.validate('2024-06-15', rule)).toEqual({ valid: true });
  });

  it('validates date range — out of range', () => {
    const rule: ValidationRule = { type: 'date', minDate: '2024-01-01', maxDate: '2024-12-31' };
    const result = svc.validate('2025-01-01', rule);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('2024');
  });

  it('validates date range — invalid date', () => {
    const rule: ValidationRule = { type: 'date', minDate: '2024-01-01', maxDate: '2024-12-31' };
    const result = svc.validate('not-a-date', rule);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('有效日期');
  });

  it('mixed: list validation rejects empty string not in list', () => {
    const rule: ValidationRule = { type: 'list', values: ['apple', 'banana'] };
    const result = svc.validate('', rule);
    expect(result.valid).toBe(false);
  });
});

describe('SetValidationCommand', () => {
  it('sets and reads validation rule from store', () => {
    const store = new Store();
    const rule: ValidationRule = { type: 'list', values: ['yes', 'no'] };
    const cmd = new SetValidationCommand({ r1: 0, c1: 0, r2: 5, c2: 0, rule });
    cmd.execute(store);
    const stored = store.getValidationRule(2, 0);
    expect(stored).toBeDefined();
    expect(stored?.type).toBe('list');
  });

  it('undo removes validation rule', () => {
    const store = new Store();
    const rule: ValidationRule = { type: 'integer', min: 0, max: 100 };
    const cmd = new SetValidationCommand({ r1: 0, c1: 0, r2: 5, c2: 0, rule });
    cmd.execute(store);
    expect(store.getValidationRule(2, 0)).toBeDefined();
    cmd.getUndo().execute(store);
    expect(store.getValidationRule(2, 0)).toBeUndefined();
  });

  it('cell outside range has no validation', () => {
    const store = new Store();
    const rule: ValidationRule = { type: 'list', values: ['a'] };
    const cmd = new SetValidationCommand({ r1: 0, c1: 0, r2: 5, c2: 0, rule });
    cmd.execute(store);
    expect(store.getValidationRule(10, 0)).toBeUndefined();
    expect(store.getValidationRule(2, 1)).toBeUndefined();
  });
});
