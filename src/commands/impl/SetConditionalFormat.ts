import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ConditionalRule } from '../../conditional/ConditionalRule';
import type { RangeAddress } from '../../selection/Range';

export interface SetConditionalFormatArgs extends RangeAddress {
  readonly rules: ConditionalRule[];
}

export class SetConditionalFormatCommand extends Command<SetConditionalFormatArgs> {
  private oldRules: ConditionalRule[] | undefined;

  public execute(store: Store): void {
    const range = rangeKey(this.args);
    const existing = store.getConditionalRules().find(([k]) => k === range);
    this.oldRules = existing?.[1];
    store.setConditionalRule(range, this.args.rules);
  }

  public getUndo(): Command {
    return new RestoreConditionalFormat({
      range: rangeKey(this.args),
      rules: this.oldRules,
    });
  }
}

interface RestoreConditionalFormatArgs {
  readonly range: string;
  readonly rules: ConditionalRule[] | undefined;
}

class RestoreConditionalFormat extends Command<RestoreConditionalFormatArgs> {
  public execute(store: Store): void {
    if (this.args.rules === undefined) store.removeConditionalRule(this.args.range);
    else store.setConditionalRule(this.args.range, this.args.rules);
  }

  public getUndo(): Command {
    return new SetConditionalFormatCommand({
      r1: 0, c1: 0, r2: 0, c2: 0, rules: this.args.rules ?? [],
    });
  }
}

function rangeKey(addr: RangeAddress): string {
  return `${addr.r1},${addr.c1}:${addr.r2},${addr.c2}`;
}

export interface SetSheetConditionalRulesArgs {
  /** Full replacement: every [rangeKey, rules] entry for the sheet. */
  readonly entries: ReadonlyArray<readonly [string, ConditionalRule[]]>;
}

/**
 * Replace the whole sheet's conditional rules in one undoable step — used by
 * the 管理规则 dialog (delete / reorder / toggle across multiple ranges).
 */
export class SetSheetConditionalRulesCommand extends Command<SetSheetConditionalRulesArgs> {
  private oldEntries: Array<readonly [string, ConditionalRule[]]> | undefined;

  public execute(store: Store): void {
    this.oldEntries = store.getConditionalRules().map(([k, rules]) => [k, rules] as const);
    applyEntries(store, this.args.entries);
  }

  public getUndo(): Command {
    return new RestoreSheetConditionalRules({ entries: this.oldEntries ?? [] });
  }
}

interface RestoreSheetConditionalRulesArgs {
  readonly entries: ReadonlyArray<readonly [string, ConditionalRule[]]>;
}

class RestoreSheetConditionalRules extends Command<RestoreSheetConditionalRulesArgs> {
  public execute(store: Store): void {
    applyEntries(store, this.args.entries);
  }

  public getUndo(): Command {
    return new SetSheetConditionalRulesCommand({ entries: this.args.entries });
  }
}

function applyEntries(store: Store, entries: ReadonlyArray<readonly [string, ConditionalRule[]]>): void {
  for (const [key] of store.getConditionalRules()) store.removeConditionalRule(key);
  for (const [key, rules] of entries) store.setConditionalRule(key, rules);
}
