import { useEffect, useRef, type RefObject } from 'react';
import { cellSelection, type Selection } from '../../selection/Selection';
import type { Store } from '../../store/Store';

/**
 * Excel: the selection belongs to the sheet. Whichever way the active sheet
 * changes — a tab, a hyperlink, Find, a host call — the sheet being left keeps
 * its selection for when it comes back, and the sheet entered shows its own,
 * or A1 when it has none. (Before: one selection served every sheet, so the
 * coordinates selected on one were carried onto the next — off-screen as soon
 * as sheets kept their own views.) A replaced workbook starts over at A1.
 *
 * `onLeave` runs while the sheet is being left, before its selection is put
 * away: an edit open at that moment cannot continue on another sheet.
 */
export function useSheetSelection(
  store: Store,
  selection: RefObject<Selection | null>,
  select: (next: Selection) => void,
  onLeave: () => void,
  clearExtraRanges: () => void,
): void {
  const saved = useRef(new Map<string, Selection>());
  const viewed = useRef(store.getActiveSheetId());
  useEffect(() => store.subscribe((event) => {
    if (event.type === 'workbook' && event.action === 'replace') {
      // Nothing of the workbook before it carries over — not the selections
      // kept for its sheets, not the one on screen. Its own sheet events follow.
      saved.current.clear();
      viewed.current = store.getActiveSheetId();
      onLeave();
      clearExtraRanges();
      select(cellSelection(0, 0));
      return;
    }
    if (event.type === 'sheet' && event.action === 'delete') saved.current.delete(event.sheetId);
    const active = store.getActiveSheetId();
    if (active === viewed.current) return;
    const left = viewed.current;
    viewed.current = active;
    onLeave();
    const current = selection.current;
    // The active sheet just deleted is not there to come back to.
    if (current !== null && store.getSheets().some((sheet) => sheet.id === left)) saved.current.set(left, current);
    clearExtraRanges();
    select(saved.current.get(active) ?? cellSelection(0, 0));
  }), [store, selection, select, onLeave, clearExtraRanges]);
}
