import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Store } from '../../store/Store';
import type { ViewState } from '../keyboard';

/**
 * Frozen rows/columns belong to each sheet — they persist with it and travel
 * with an xlsx — and the view shows the active sheet's. Both ways: the view
 * follows the sheet when the active sheet changes, and a freeze toggled in
 * the view is written to the active sheet.
 */
export function useSheetFreeze(store: Store, activeSheetId: string, view: ViewState, setView: Dispatch<SetStateAction<ViewState>>): void {
  // A replaced workbook may keep the active sheet's id: follow its announcement.
  const [workbookGeneration, setWorkbookGeneration] = useState(0);
  useEffect(() => store.subscribe((event) => {
    if (event.type === 'workbook' && event.action === 'replace') setWorkbookGeneration((generation) => generation + 1);
  }), [store]);

  // The sheet whose freeze the view was last loaded from. Until the view has
  // been brought in line with a sheet, nothing may be written back: right
  // after a switch the view still shows the previous sheet's freeze.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    const freeze = store.getFreeze(activeSheetId);
    const rows = freeze?.rows ?? 0;
    const cols = freeze?.cols ?? 0;
    loadedFor.current = `${workbookGeneration}:${activeSheetId}`;
    setView((current) => (current.frozenRows === rows && current.frozenCols === cols ? current : { ...current, frozenRows: rows, frozenCols: cols }));
  }, [store, activeSheetId, workbookGeneration, setView]);

  const { frozenRows, frozenCols } = view;
  useEffect(() => {
    if (loadedFor.current !== `${workbookGeneration}:${activeSheetId}`) return;
    const current = store.getFreeze(activeSheetId);
    if ((current?.rows ?? 0) === frozenRows && (current?.cols ?? 0) === frozenCols) return;
    store.setFreeze(frozenRows === 0 && frozenCols === 0 ? undefined : { rows: frozenRows, cols: frozenCols }, activeSheetId);
  }, [store, activeSheetId, workbookGeneration, frozenRows, frozenCols]);
}
