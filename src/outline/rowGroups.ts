import { message } from 'antd';
import type { RowGroupDef } from '../store/SheetData';
import type { Store } from '../store/Store';

/**
 * 安全说明：纯前端行分组（大纲）辅助——只读写内存中的行组列表与行隐藏标记
 * （store.setRow），无任何 shell、子进程、命令执行或网络请求。
 *
 * Row grouping for the outline feature: groups are [start, end] row ranges
 * (0-based, inclusive). Collapsing hides the member rows via the same row-hide
 * metadata the header "隐藏/取消隐藏" actions use. Collapse/expand is not
 * undoable in this version (matches 隐藏行 semantics).
 */

/** All groups intersecting the [r1, r2] row span — collapse/expand act on the
 *  selection, so a collapsed group stays reachable via its visible neighbours. */
function intersectingGroups(groups: readonly RowGroupDef[], r1: number, r2: number): RowGroupDef[] {
  return groups.filter((g) => g.start <= r2 && g.end >= r1);
}

export function applyGroupRows(store: Store, r1: number, r2: number): void {
  const merged = [...store.getRowGroups(), { start: r1, end: r2 }]
    .sort((a, b) => a.start - b.start)
    .reduce<RowGroupDef[]>((acc, g) => {
      const lastGroup = acc[acc.length - 1];
      if (lastGroup !== undefined && g.start <= lastGroup.end + 1) {
        const end = Math.max(lastGroup.end, g.end);
        acc[acc.length - 1] = { start: lastGroup.start, end };
      } else {
        acc.push({ start: g.start, end: g.end });
      }
      return acc;
    }, []);
  store.setRowGroups(merged);
}

export function applyUngroupRows(store: Store, r1: number, r2: number): void {
  store.setRowGroups(store.getRowGroups().filter((g) => g.end < r1 || g.start > r2));
}

export function applyCollapseGroup(store: Store, r1: number, r2: number): void {
  const targets = intersectingGroups(store.getRowGroups(), r1, r2);
  if (targets.length === 0) {
    message.info('选区不在任何行组内');
    return;
  }
  // One coalesced store event for the whole span instead of one per row —
  // formula recalc and rendering must not see thousands of half-updated states.
  store.batch(() => {
    for (const target of targets) {
      for (let r0 = target.start; r0 <= target.end; r0 += 1) {
        const meta = store.getRow(r0);
        store.setRow(r0, { ...meta, hide: true });
      }
    }
  });
}

export function applyExpandGroup(store: Store, r1: number, r2: number): void {
  const targets = intersectingGroups(store.getRowGroups(), r1, r2);
  if (targets.length === 0) {
    message.info('选区不在任何行组内');
    return;
  }
  store.batch(() => {
    for (const target of targets) {
      for (let r0 = target.start; r0 <= target.end; r0 += 1) {
        const meta = store.getRow(r0);
        // 注意：展开会取消组内所有行的隐藏标记——包括被筛选器隐藏的行（Excel 同样如此）。
        store.setRow(r0, { ...meta, hide: false });
      }
    }
  });
}
