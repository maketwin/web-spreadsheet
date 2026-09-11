import { describe, expect, it } from 'vitest';
import { SetValidationCommand } from '../../src/commands/impl/SetValidation';
import type { ValidationRule } from '../../src/validation/types';
import { Store } from '../../src/store/Store';

const rule: ValidationRule = { type: 'integer', min: 1, max: 10 };

describe('SetValidationCommand undo', () => {
  it('undo removes a newly added rule', () => {
    const store = new Store();
    const cmd = new SetValidationCommand({ r1: 0, c1: 0, r2: 4, c2: 0, rule });

    cmd.execute(store);
    expect(store.getValidationRules()).toHaveLength(1);

    cmd.getUndo().execute(store);
    expect(store.getValidationRules()).toHaveLength(0);
  });

  it('undo restores a replaced rule', () => {
    const store = new Store();
    const oldRule: ValidationRule = { type: 'list', values: ['a', 'b'] };
    new SetValidationCommand({ r1: 0, c1: 0, r2: 4, c2: 0, rule: oldRule }).execute(store);

    const cmd = new SetValidationCommand({ r1: 0, c1: 0, r2: 4, c2: 0, rule });
    cmd.execute(store);
    cmd.getUndo().execute(store);

    expect(store.getValidationRules()[0]?.[1]).toEqual(oldRule);
  });
});
