import { describe, expect, it } from 'vitest';
import { DataValidationService } from '../../src/validation/DataValidationService';

describe('expanded data validation', () => {
  const svc = new DataValidationService();

  it('decimal range', () => {
    expect(svc.validate('1.5', { type: 'decimal', min: 0, max: 2 }).valid).toBe(true);
    expect(svc.validate('3', { type: 'decimal', min: 0, max: 2 }).valid).toBe(false);
  });

  it('text length', () => {
    expect(svc.validate('ab', { type: 'textLength', min: 1, max: 3 }).valid).toBe(true);
    expect(svc.validate('abcd', { type: 'textLength', min: 1, max: 3 }).valid).toBe(false);
  });

  it('custom formula', () => {
    expect(svc.validate('x', { type: 'custom', formula: '=TRUE' }).valid).toBe(true);
    expect(svc.validate('x', { type: 'custom', formula: '=FALSE' }).valid).toBe(false);
  });
});
