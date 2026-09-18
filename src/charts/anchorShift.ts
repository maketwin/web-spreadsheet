import type { Store } from '../store/Store';
import { shiftAnchorForDelete, shiftAnchorForInsert, sameAnchor } from './geometry';
import type { ChartAnchor } from './types';

/**
 * Structural row/col edits drag floating objects with them (Excel "move and
 * size with cells"): both anchor edges follow their row/column index.
 */
export function shiftSheetChartAnchors(store: Store, kind: 'insert' | 'delete', axis: 'row' | 'col', start: number, count: number): void {
  const shift = (anchor: ChartAnchor | undefined): ChartAnchor | undefined => {
    if (anchor === undefined) return undefined;
    return kind === 'insert'
      ? shiftAnchorForInsert(anchor, axis, start, count)
      : shiftAnchorForDelete(anchor, axis, start, count);
  };
  for (const chart of store.getCharts()) {
    const anchor = shift(chart.anchor);
    if (anchor === undefined || sameAnchor(anchor, chart.anchor)) continue;
    store.addChart({ ...chart, anchor });
  }
}
