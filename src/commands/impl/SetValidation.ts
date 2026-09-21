import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ValidationRule } from '../../validation/types';
import type { RangeAddress } from '../../selection/Range';

export interface SetValidationArgs extends RangeAddress {
  readonly rule: ValidationRule;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class SetValidationCommand extends Command<SetValidationArgs> {
  private oldRule: ValidationRule | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const key = rangeKey(this.args);
    const existing = store.getValidationRules(sid).find(([k]) => k === key);
    this.oldRule = existing?.[1];
    store.setValidationRule(key, this.args.rule, sid);
  }

  public getUndo(): Command {
    return new RestoreValidation({ range: rangeKey(this.args), rule: this.oldRule, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreValidationArgs {
  readonly range: string;
  readonly rule: ValidationRule | undefined;
  readonly sheetId?: string;
}

class RestoreValidation extends Command<RestoreValidationArgs> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    if (this.args.rule === undefined) store.removeValidationRule(this.args.range, sid);
    else store.setValidationRule(this.args.range, this.args.rule, sid);
  }

  public getUndo(): Command {
    throw new Error('RestoreValidation undo not implemented');
  }
}

function rangeKey(addr: RangeAddress): string {
  return `${addr.r1},${addr.c1}:${addr.r2},${addr.c2}`;
}
