import type { FC } from 'react';
import type { Store } from '../store/Store';
import type { Cell } from '../types';
import type { RangeAddress } from '../selection/Range';

export interface StatusBarProps {
  readonly store: Store;
  readonly selected: RangeAddress | null;
  readonly zoom: number;
  readonly autoSaveStatus?: string;
}

export const StatusBar: FC<StatusBarProps> = ({ store, selected, zoom, autoSaveStatus }) => {
  const sheetId = store.getActiveSheetId();
  const sheetData = store.getSheetData(sheetId);
  const cells = sheetData?.getCells() ?? [];
  const filledCount = cells.filter(([, cell]) => cell.text.length > 0).length;

  const stats = computeSelectionStats(store, selected);

  return (
    <div className="ss-status-bar" role="status" aria-label="Status bar">
      <span className="ss-status-item">单元格: {filledCount}</span>
      {stats !== null && (
        <>
          <span className="ss-status-divider">|</span>
          <span className="ss-status-item">求和: {stats.sum}</span>
          <span className="ss-status-item">平均: {stats.avg}</span>
          <span className="ss-status-item">计数: {stats.count}</span>
        </>
      )}
      <span className="ss-status-spacer" />
      {autoSaveStatus !== undefined && <span className="ss-status-item ss-status-save">{autoSaveStatus}</span>}
      <span className="ss-status-item">{zoom}%</span>
    </div>
  );
};

interface SelectionStats {
  readonly sum: number;
  readonly avg: string;
  readonly count: number;
}

function computeSelectionStats(store: Store, selected: RangeAddress | null): SelectionStats | null {
  if (selected === null) return null;
  const { r1, c1, r2, c2 } = selected;
  if (r1 === r2 && c1 === c2) return null;

  let sum = 0;
  let count = 0;
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const cell: Cell | undefined = store.getCell(r, c);
      if (cell === undefined || cell.text.length === 0) continue;
      if (typeof cell.value === 'number') { sum += cell.value; count += 1; }
    }
  }
  if (count === 0) return null;
  const avg = count > 0 ? (sum / count).toFixed(2) : '0';
  return { sum, avg, count };
}
