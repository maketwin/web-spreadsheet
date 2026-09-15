import { Modal } from 'antd';
import { SetMerge, SetMergeAcross } from '../commands/impl/SetMerge';
import { SetRangeStyleCommand } from '../commands/impl/SetRangeStyle';
import { CompositeCommand } from '../util/rangeValues';
import { mergeConflictCount } from '../util/merge';
import { parseRange } from '../util/cell';
import { xy2expr } from '../util/alphabet';
import type { CommandManager } from '../commands/CommandManager';
import type { RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';

export type MergeMode = 'center' | 'across' | 'plain' | 'unmerge';

export function rangeToName(range: RangeAddress): string {
  return `${xy2expr(range.c1, range.r1)}:${xy2expr(range.c2, range.r2)}`;
}

function execute(store: Store, cmdManager: CommandManager | undefined, cmd: Parameters<CommandManager['execute']>[0]): void {
  if (cmdManager === undefined) cmd.execute(store);
  else cmdManager.execute(cmd);
}

/** True when the selection is exactly one existing merge (Merge & Center toggle-off case, Excel). */
export function isSingleMergeSelection(store: Store, range: RangeAddress): boolean {
  return store.getMerges().some((m) => {
    const a = parseRange(m);
    return a.r1 === range.r1 && a.c1 === range.c1 && a.r2 === range.r2 && a.c2 === range.c2;
  });
}

/**
 * Excel merge entry points shared by the menu bar and the toolbar.
 * Merging a range where more than one cell holds a value warns first
 * (「仅保留左上角的值」); Merge & Center toggles off on an already-merged
 * selection; Merge & Center also centers the anchor cell.
 */
export function mergeSelection(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress, mode: MergeMode): void {
  const name = rangeToName(range);
  if (mode === 'unmerge') { execute(store, cmdManager, new SetMerge({ range: name, active: false })); return; }
  if (mode === 'center' && isSingleMergeSelection(store, range)) {
    execute(store, cmdManager, new SetMerge({ range: name, active: false }));
    return;
  }
  const run = (): void => {
    if (mode === 'across') { execute(store, cmdManager, new SetMergeAcross({ range: name })); return; }
    const merge = new SetMerge({ range: name, active: true });
    // Excel: Merge & Center (merge + center) is ONE undo step; F4 repeats it whole.
    execute(store, cmdManager, mode === 'center'
      ? new CompositeCommand([merge, new SetRangeStyleCommand({ ...range, style: { align: 'center' } })])
      : merge);
  };
  if (mergeConflictCount(store, range) > 0) {
    Modal.confirm({ title: '合并单元格', content: '合并单元格时，仅保留左上角的值，而放弃其他值。是否继续？', okText: '确定', cancelText: '取消', onOk: run });
    return;
  }
  run();
}
