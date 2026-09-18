import { SetAutoFilterCommand } from '../commands/impl/SetAutoFilter';
import type { RangeAddress } from '../selection/Range';
import type { Store } from '../store/Store';
import { FilterService } from './FilterService';

/**
 * Excel 筛选开关 (数据→筛选 / Ctrl+Shift+L): with a filter present it is
 * removed; otherwise one is created over the selection's data region.
 * Returns the command to execute, or null when nothing applies.
 */
export function toggleAutoFilterCommand(store: Store, selected: RangeAddress | null): SetAutoFilterCommand | null {
  const svc = new FilterService(store);
  const existing = svc.getAutoFilter();
  if (existing !== undefined) return new SetAutoFilterCommand({ ...existing.range, enabled: false });
  // Excel 规则：部分多格选区按精确范围；整列选择只筛所选列；单格/整行取当前区域。
  const range = svc.autoFilterRangeFor(selected);
  return new SetAutoFilterCommand({ ...range, enabled: true });
}
