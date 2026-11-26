import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Store } from '../../store/Store';
import type { ViewState } from '../keyboard';

/**
 * Frozen rows/columns belong to each sheet — they persist with it and travel
 * with an xlsx — and the view shows the active sheet's. Both ways: the view
 * follows the sheet when the active sheet changes, and a freeze toggled in
 * the view is written to the active sheet.
 *
 * The view also follows when the host sets the freeze of the ACTIVE sheet
 * directly (store.setFreeze behind the view's back): the store's `freeze`
 * event triggers one reload, equivalent to having just switched to this
 * sheet. No echo — the write-back then finds the sheet and the view already
 * in agreement and skips.
 */
export function useSheetFreeze(store: Store, activeSheetId: string, view: ViewState, setView: Dispatch<SetStateAction<ViewState>>): void {
  // A replaced workbook may keep the active sheet's id, and the host may set
  // the active sheet's freeze without going through the view: either
  // announcement makes the view reload from the sheet once.
  const [reloadGeneration, setReloadGeneration] = useState(0);
  useEffect(() => store.subscribe((event) => {
    if (event.type === 'workbook' && event.action === 'replace') setReloadGeneration((generation) => generation + 1);
    // Missing sheetId means the active sheet (legacy event shape).
    if (event.type === 'freeze' && (event.sheetId === undefined || event.sheetId === activeSheetId)) setReloadGeneration((generation) => generation + 1);
  }), [store, activeSheetId]);

  // The sheet whose freeze the view was last loaded from. Until the view has
  // been brought in line with a sheet, nothing may be written back: right
  // after a switch the view still shows the previous sheet's freeze.
  const loadedFor = useRef<string | null>(null);

  const { frozenRows, frozenCols } = view;
  useEffect(() => {
    const key = `${reloadGeneration}:${activeSheetId}`;
    if (loadedFor.current !== key) {
      // Load: this commit switched sheets or follows a workbook replace /
      // an externally set freeze — bring the view in line with the sheet.
      // (Exactly one branch runs per commit: a reload commit never also
      // writes back, so the view value still in this commit's props —
      // possibly the previous sheet's freeze — cannot land in the sheet.)
      const freeze = store.getFreeze(activeSheetId);
      const rows = freeze?.rows ?? 0;
      const cols = freeze?.cols ?? 0;
      loadedFor.current = key;
      setView((current) => (current.frozenRows === rows && current.frozenCols === cols ? current : { ...current, frozenRows: rows, frozenCols: cols }));
      return;
    }
    // Write-back: the view changed on its own (menu / shortcut) — mirror it
    // into the sheet. Skipping when they already agree is what breaks the
    // event→view→write→event echo after an external freeze is absorbed.
    const current = store.getFreeze(activeSheetId);
    if ((current?.rows ?? 0) === frozenRows && (current?.cols ?? 0) === frozenCols) return;
    store.setFreeze(frozenRows === 0 && frozenCols === 0 ? undefined : { rows: frozenRows, cols: frozenCols }, activeSheetId);
  }, [store, activeSheetId, reloadGeneration, frozenRows, frozenCols]);
}
