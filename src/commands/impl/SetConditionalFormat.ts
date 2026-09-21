import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ConditionalRule } from '../../conditional/ConditionalRule';
import type { RangeAddress } from '../../selection/Range';

export interface SetConditionalFormatArgs extends RangeAddress {
  readonly rules: ConditionalRule[];
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

export class SetConditionalFormatCommand extends Command<SetConditionalFormatArgs> {
  private oldRules: ConditionalRule[] | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const range = rangeKey(this.args);
    const existing = store.getConditionalRules(sid).find(([k]) => k === range);
    this.oldRules = existing?.[1];
    store.setConditionalRule(range, this.args.rules, sid);
  }

  public getUndo(): Command {
    return new RestoreConditionalFormat({
      range: rangeKey(this.args),
      rules: this.oldRules,
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }
}

interface RestoreConditionalFormatArgs {
  readonly range: string;
  readonly rules: ConditionalRule[] | undefined;
  readonly sheetId?: string;
}

class RestoreConditionalFormat extends Command<RestoreConditionalFormatArgs> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    if (this.args.rules === undefined) store.removeConditionalRule(this.args.range, sid);
    else store.setConditionalRule(this.args.range, this.args.rules, sid);
  }

  public getUndo(): Command {
    return new SetConditionalFormatCommand({
      r1: 0, c1: 0, r2: 0, c2: 0, rules: this.args.rules ?? [],
      ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}),
    });
  }
}

function rangeKey(addr: RangeAddress): string {
  return `${addr.r1},${addr.c1}:${addr.r2},${addr.c2}`;
}

export interface SetSheetConditionalRulesArgs {
  /** Full replacement: every [rangeKey, rules] entry for the sheet. */
  readonly entries: ReadonlyArray<readonly [string, ConditionalRule[]]>;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/**
 * Replace the whole sheet's conditional rules in one undoable step — used by
 * the 管理规则 dialog (delete / reorder / toggle across multiple ranges).
 */
export class SetSheetConditionalRulesCommand extends Command<SetSheetConditionalRulesArgs> {
  private oldEntries: Array<readonly [string, ConditionalRule[]]> | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    this.oldEntries = store.getConditionalRules(sid).map(([k, rules]) => [k, rules] as const);
    applyEntries(store, this.args.entries, sid);
  }

  public getUndo(): Command {
    return new RestoreSheetConditionalRules({ entries: this.oldEntries ?? [], ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

interface RestoreSheetConditionalRulesArgs {
  readonly entries: ReadonlyArray<readonly [string, ConditionalRule[]]>;
  readonly sheetId?: string;
}

class RestoreSheetConditionalRules extends Command<RestoreSheetConditionalRulesArgs> {
  public execute(store: Store): void {
    applyEntries(store, this.args.entries, this.args.sheetId);
  }

  public getUndo(): Command {
    return new SetSheetConditionalRulesCommand({ entries: this.args.entries, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}

function applyEntries(store: Store, entries: ReadonlyArray<readonly [string, ConditionalRule[]]>, sheetId?: string): void {
  const sid = sheetId ?? store.getActiveSheetId();
  for (const [key] of store.getConditionalRules(sid)) store.removeConditionalRule(key, sid);
  for (const [key, rules] of entries) store.setConditionalRule(key, rules, sid);
}
