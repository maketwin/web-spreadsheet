import type { Store } from '../store/Store';
import { shiftAnchorForDelete, shiftAnchorForInsert, sameAnchor } from './geometry';
import type { ChartAnchor } from './types';

/**
 * Structural row/col edits drag floating objects with them (Excel "move and
 * size with cells"): both anchor edges follow their row/column index. Images
 * anchor exactly like charts and ride along here.
 */
export function shiftSheetChartAnchors(store: Store, kind: 'insert' | 'delete', axis: 'row' | 'col', start: number, count: number, sheetId?: string): void {
  const shift = (anchor: ChartAnchor | undefined): ChartAnchor | undefined => {
    if (anchor === undefined) return undefined;
    return kind === 'insert'
      ? shiftAnchorForInsert(anchor, axis, start, count)
      : shiftAnchorForDelete(anchor, axis, start, count);
  };
  const sid = sheetId ?? store.getActiveSheetId();
  for (const chart of store.getCharts(sid)) {
    const anchor = shift(chart.anchor);
    if (anchor === undefined || sameAnchor(anchor, chart.anchor)) continue;
    store.addChart({ ...chart, anchor }, sid);
  }
  for (const image of store.getImages(sid)) {
    const anchor = shift(image.anchor);
    if (anchor === undefined || sameAnchor(anchor, image.anchor)) continue;
    store.addImage({ ...image, anchor }, sid);
  }
}
