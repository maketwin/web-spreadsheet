import { describe, expect, it } from 'vitest';
import { DataValidationService, type ValidationContext } from '../../src/validation/DataValidationService';
import type { ValidationRule } from '../../src/validation/types';
import { Store } from '../../src/store/Store';

describe('custom validation formula with context', () => {
  const svc = new DataValidationService();

  it('reads the real cells: candidate on the validated cell, store elsewhere', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '100', value: 100 }); // A1
    const rule: ValidationRule = { type: 'custom', formula: '=B1<=A1' };
    store.setValidationRule('0,1:0,1', rule);
    const context: ValidationContext = { store, r: 0, c: 1 };

    expect(svc.validate('500', rule, context).valid).toBe(false); // 500 <= 100
    expect(svc.validate('50', rule, context).valid).toBe(true); // 50 <= 100
  });

  it('shifts the formula to the cell offset from the rule range top-left', () => {
    const store = new Store();
    store.setCell(0, 1, { text: '10', value: 10 }); // B1 — absolute anchor
    store.setCell(1, 2, { text: '3', value: 3 }); // C2 — a decoy the unshifted formula would read
    const rule: ValidationRule = { type: 'custom', formula: '=C2<=$B$1' };
    store.setValidationRule('1,2:9,2', rule); // C2:C10

    // C5 (r=3 from C2): must evaluate `=C5<=$B$1`, not `=C2<=$B$1`.
    expect(svc.validate('5', rule, { store, r: 4, c: 2 }).valid).toBe(true); // 5 <= 10
    expect(svc.validate('50', rule, { store, r: 4, c: 2 }).valid).toBe(false); // 50 <= 10 — C2=3 would have passed
    expect(svc.validate('20', rule, { store, r: 4, c: 2 }).valid).toBe(false); // 20 <= 10
  });

  it('falls back to the validated cell as anchor when no stored range matches', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '100', value: 100 }); // A1
    const hit: ValidationRule = { type: 'custom', formula: '=A1>5' };
    const miss: ValidationRule = { type: 'custom', formula: '=A1>500' };
    // The rule is registered on a range that does not contain (0, 1).
    store.setValidationRule('5,5:9,9', hit);

    expect(svc.validate('anything', hit, { store, r: 0, c: 1 }).valid).toBe(true);
    expect(svc.validate('anything', miss, { store, r: 0, c: 1 }).valid).toBe(false);
  });

  it('types the candidate like Excel: numeric text is a number, other text stays text', () => {
    const store = new Store();
    const asNumber: ValidationRule = { type: 'custom', formula: '=B1=42' };
    const asText: ValidationRule = { type: 'custom', formula: '=ISTEXT(B1)' };

    expect(svc.validate('42', asNumber, { store, r: 0, c: 1 }).valid).toBe(true);
    expect(svc.validate('abc', asText, { store, r: 0, c: 1 }).valid).toBe(true);
    expect(svc.validate('42', asText, { store, r: 0, c: 1 }).valid).toBe(false);
  });

  it('resolves cross-sheet references through the store', () => {
    const store = new Store();
    const sheet2 = store.addSheet('Sheet2');
    store.setCell(0, 0, { text: '7', value: 7 }, sheet2);
    const rule: ValidationRule = { type: 'custom', formula: '=Sheet2!A1>5' };

    expect(svc.validate('999', rule, { store, r: 0, c: 1 }).valid).toBe(true);

    store.setCell(0, 0, { text: '2', value: 2 }, sheet2);
    expect(svc.validate('999', rule, { store, r: 0, c: 1 }).valid).toBe(false);
  });

  it('without a context keeps the legacy behaviour: every reference reads the candidate', () => {
    // Legacy: the sheet is unknown, so `=B1<=A1` degenerates to `value<=value`
    // — anything passes a self-comparison. Passing a context fixes it.
    const rule: ValidationRule = { type: 'custom', formula: '=B1<=A1' };
    expect(svc.validate('500', rule).valid).toBe(true);
    expect(svc.validate('FALSE', { type: 'custom', formula: '=FALSE' }).valid).toBe(false);
  });
});
