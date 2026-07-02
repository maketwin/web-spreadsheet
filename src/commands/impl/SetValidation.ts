import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ValidationRule } from '../../validation/types';
import type { RangeAddress } from '../../selection/Range';

export interface SetValidationArgs extends RangeAddress {
  readonly rule: ValidationRule;
}

export class SetValidationCommand extends Command<SetValidationArgs> {
  private oldRule: ValidationRule | undefined;

  public execute(store: Store): void {
    const key = rangeKey(this.args);
    const existing = store.getValidationRules().find(([k]) => k === key);
    this.oldRule = existing?.[1];
    store.setValidationRule(key, this.args.rule);
  }

  public getUndo(): Command {
    return new RestoreValidation({ range: rangeKey(this.args), rule: this.oldRule });
  }
}

interface RestoreValidationArgs {
  readonly range: string;
  readonly rule: ValidationRule | undefined;
}

class RestoreValidation extends Command<RestoreValidationArgs> {
  public execute(store: Store): void {
    if (this.args.rule === undefined) store.removeValidationRule(this.args.range);
    else store.setValidationRule(this.args.range, this.args.rule);
  }

  public getUndo(): Command {
    throw new Error('RestoreValidation undo not implemented');
  }
}

function rangeKey(addr: RangeAddress): string {
  return `${addr.r1},${addr.c1}:${addr.r2},${addr.c2}`;
}
