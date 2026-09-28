import { Button, Input, Modal, message } from 'antd';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { applyMatrix, clearRange } from '../util/rangeValues';
import { fillSelectionPatches } from '../fill/fillSelection';
import { openHyperlink } from '../util/hyperlink';

import { useMultiSelection } from './hooks/useMultiSelection';
import { useClipboardSession } from './hooks/useClipboardSession';
import type { Command } from '../commands/Command';
import type { DialogName } from './menu/types';
import { CommandManager } from '../commands/CommandManager';

import { hashPassword } from '../util/passwordHash';
import { SetRangeStyleCommand } from '../commands/impl/SetRangeStyle';
import { EventBus } from '../events/EventBus';
import { FormulaEngine } from '../formula/FormulaEngine';
import { resolveEditAnchor, snapClickSelection, snapRangeSelection } from '../selection/mergeSnap';
import type { FindMatch } from '../find/FindReplaceService';
import { PluginManager, type Plugin } from '../plugin/PluginManager';
import { TOTAL_COLS, TOTAL_ROWS, type CellAddress, type FormulaRefHighlight } from '../renderer/CanvasRenderer';
import { RemoveChartCommand } from '../commands/impl/RemoveChart';
import { SetChartAnchorCommand } from '../commands/impl/SetChartAnchor';
import { RemoveImageCommand, SetImageAnchorCommand } from '../commands/impl/ImageObject';
import { InsertRowCommand } from '../commands/impl/InsertRow';
import { InsertColCommand } from '../commands/impl/InsertCol';
import { DeleteRowCommand } from '../commands/impl/DeleteRow';
import { DeleteColCommand } from '../commands/impl/DeleteCol';
import { SetColWidth } from '../commands/impl/SetColWidth';
import { SetRowHeight } from '../commands/impl/SetRowHeight';
import { Range, type RangeAddress } from '../selection/Range';
import { Store, type SheetInfo } from '../store/Store';
import { applyStoredTheme, setTheme, type Theme } from '../theme';
import { DataValidationService } from '../validation/DataValidationService';
import { type CellInput as CellDataInput } from '../util/cell';
import { cellSelection, columnSelection, extendSelection, rangeSelection, rowSelection, sheetSelection, type Selection } from '../selection/Selection';
import { CellContextMenu, HeaderContextMenu } from './ContextMenu';
import { PasteSpecialDialog } from './PasteSpecialDialog';
import { BottomBar } from './BottomBar';
import { ErrorBoundary } from './ErrorBoundary';
import { StatusBar } from './StatusBar';
import { FormulaBar, type FormulaBarHandle } from './FormulaBar';
import { MoveOrCopySheetDialog } from './menu/dialogs/MoveOrCopySheetDialog';
import { MenuBar, allSheetRange } from './menu/MenuBar';
import { FloatingChart } from '../charts/FloatingChart';
import { FloatingImage } from '../charts/FloatingImage';
import { FilterDropdown } from './FilterDropdown';
import { startAutoSave } from '../db/autoSave';
import { loadWorkbook, DEFAULT_ID, saveWorkbook as saveToDB } from '../db/WorkbookDB';
import type { Cell, Style, RichTextRun } from '../types';
import { num2alpha } from '../util/alphabet';
import { endsWithRef, isPointTrigger, upsertRef } from '../formula/pointMode';
import type { RichEditorApi } from './RichEditor';
import { EditorOverlay, caretOffsetAtClick, clampVal, type EditingCell } from './EditorOverlay';
import { handleCanvasKeyDown, handleEndMode, type ViewState } from './keyboard';
import {
  applyShortcutStyle, applyMoveOrCopySheet, cellEditValue, commitFormulaValue, editorRunStyleIntercept, growRowsToContent,
  jumpNameBox, setCellText, submitCreateChart, submitCreateImage, submitInsertSparkline,
  unhideOrHideCols, unhideOrHideRows,
} from './spreadsheetActions';
import { applyRunStyle, applyTextChangeToRuns, charsAllHave, flattenRuns, isRich, normalizeRuns, runsFromText, type RunStylePatch } from '../util/richText';
import { InteractionToolbar, ProtectionModal } from './InteractionToolbar';
import { useCanvasRenderer } from './hooks/useCanvasRenderer';
import { useFormulaSync } from './formulaSync';
import { loadData, loadSheets } from './workbookInit';

export { snapshotCells, buildSessionPasteValues, tilePlainCells, combineMultiRanges } from '../clipboard/session';
export type { ClipboardSessionState } from '../clipboard/session';
export type CellInput = CellDataInput;
export interface SheetInput { readonly id?: string; readonly name: string; readonly data?: readonly (readonly CellInput[])[] }
export interface SpreadsheetOptions { readonly data?: readonly (readonly CellInput[])[]; readonly sheets?: readonly SheetInput[]; readonly theme?: Theme | false }
export interface SpreadsheetProps { readonly store: Store; readonly cmdManager?: CommandManager; readonly formulaEngine?: FormulaEngine; readonly theme?: Theme | false | undefined; readonly onClose?: () => void }
interface FilterPopupState { readonly r: number; readonly c: number; readonly x: number; readonly y: number }
/** Module-level hook the active instance registers so applyShortcutStyle can offer run-level styling to the open cell editor. */
type SpreadsheetContextMenu =
  | { readonly kind: 'cell'; readonly x: number; readonly y: number; readonly r: number; readonly c: number }
  | { readonly kind: 'row'; readonly index: number; readonly count: number; readonly x: number; readonly y: number }
  | { readonly kind: 'column'; readonly index: number; readonly count: number; readonly x: number; readonly y: number };


export const SpreadsheetComponent: FC<SpreadsheetProps> = ({ store, cmdManager, formulaEngine, theme, onClose }) => {
  const [selected, setSelected] = useState<Selection | null>(cellSelection(0, 0));
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [sheets, setSheets] = useState<readonly SheetInfo[]>(store.getSheets());
  const [activeSheetId, setActiveSheetId] = useState(store.getActiveSheetId());
  const [view, setView] = useState<ViewState>({ zoom: 100, showFormula: false, showGrid: true, frozenRows: 0, frozenCols: 0 });
  const [findDialogOpen, setFindDialogOpen] = useState<DialogName | null>(null);
  const [ctxMenu, setCtxMenu] = useState<SpreadsheetContextMenu | null>(null);
  const [protectOpen, setProtectOpen] = useState(false);
  /** 工作簿密码锁定：恢复的自动保存带密码时，需解锁才能操作。 */
  const [workbookLocked, setWorkbookLocked] = useState(store.getWorkbookPasswordHash() !== undefined);
  const [workbookUnlocked, setWorkbookUnlocked] = useState(false);
  const [unlockInput, setUnlockInput] = useState('');
  useEffect(() => {
    const update = (): void => setWorkbookLocked(store.getWorkbookPasswordHash() !== undefined && !workbookUnlocked);
    const off = store.subscribe(update);
    update();
    return off;
  }, [store, workbookUnlocked]);
  /** Add/rename sheet prompt: window.prompt is suppressed in embedded browsers, so use an in-app modal. */
  const [moveOrCopySheetId, setMoveOrCopySheetId] = useState<string | null>(null);
  const [sheetPrompt, setSheetPrompt] = useState<{ readonly mode: 'add' | 'rename'; readonly id?: string; readonly value: string } | null>(null);
  const [storeVersion, setStoreVersion] = useState(0);
  const [formulaValue, setFormulaValue] = useState('');
  const [painting, setPainting] = useState(false);
  const [sourceStyle, setSourceStyle] = useState<Style | undefined>(undefined);
  const [filterPopup, setFilterPopup] = useState<FilterPopupState | null>(null);
  /** Selected floating chart object (Excel: charts are selectable drawing objects). */
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const formulaBarHandleRef = useRef<FormulaBarHandle | null>(null);
  /** Ready-mode formula-bar draft runs (kept in sync so commits preserve rich text). */
  const formulaRunsRef = useRef<RichTextRun[] | undefined>(undefined);
  const [formulaRunsTick, setFormulaRunsTick] = useState(0);
  const bumpFormulaRuns = (): void => setFormulaRunsTick((n) => n + 1);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const editingRef = useRef<EditingCell | null>(editing);
  editingRef.current = editing;
  /** The rich editor registers itself while mounted (rich cells / rich drafts only). */
  const richApiRef = useRef<RichEditorApi | null>(null);
  const { multiRef, rendererApiRef, setMulti } = useMultiSelection();

  const selectSelection = useCallback((next: Selection) => {
    selectedRef.current = next;
    setSelected(next);
    setEditing(null);
    // Excel: selecting a cell deselects any selected floating object.
    setSelectedChartId(null);
  }, []);
  const selectRange = useCallback((range: RangeAddress) => selectSelection(rangeSelection(range)), [selectSelection]);
  /** Follow a hyperlink: external → window.open; in-sheet/workbook → navigate. */
  const followHyperlink = useCallback((link: NonNullable<Cell['hyperlink']>) => {
    openHyperlink(store, link, (r, c, sheetId) => {
      if (sheetId !== undefined) store.activateSheet(sheetId);
      selectSelection(snapClickSelection(store, r, c));
    });
  }, [store, selectSelection]);
  const onCellClick = useCallback((cell: CellAddress, shift: boolean, ctrl = false) => {
    if (painting && sourceStyle !== undefined) {
      const range = Range.single(cell.r, cell.c).toAddress();
      const cmd = new SetRangeStyleCommand({ ...range, style: sourceStyle });
      if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store);
      setPainting(false);
      setSourceStyle(undefined);
      return;
    }
    const ed = editingRef.current;
    if (ed !== null) {
      const el = inputRef.current;
      // Rich editor keeps its runs in the contenteditable DOM — the commit must
      // carry them, or clicking another cell flattens the cell (Excel keeps them).
      const richRuns = richApiRef.current?.getRuns();
      const value = richRuns !== undefined ? flattenRuns(richRuns) : (el?.value ?? ed.value);
      const caret = richRuns === undefined ? (el?.selectionStart ?? value.length) : value.length;
      const head = value.slice(0, caret);
      if (ed.point !== undefined || isPointTrigger(head)) {
        // Excel point mode: clicking a cell drops its reference into the formula.
        const ref = `${num2alpha(cell.c)}${cell.r + 1}`;
        const nextValue = upsertRef(head, ref, ed.point !== undefined && endsWithRef(head)) + value.slice(caret);
        editingRef.current = { ...ed, value: nextValue, point: { r: cell.r, c: cell.c } };
        setEditing(editingRef.current);
        el?.focus();
        return;
      }
      // Excel: clicking another cell commits the edit and selects the clicked cell.
      commitEditingRef.current?.(value, richRuns !== undefined ? normalizeRuns(richRuns) ?? undefined : undefined);
    }
    if (ctrl && !shift) {
      const link = store.getCell(cell.r, cell.c)?.hyperlink;
      if (link !== undefined) {
        // Excel: Ctrl+click follows the hyperlink (external or in-sheet).
        followHyperlink(link);
        return;
      }
      // Excel Ctrl+click: keep the existing selection as an extra range, activate the new cell.
      const current = selectedRef.current;
      setMulti([...multiRef.current, ...(current !== null ? [current.range] : [])]);
      selectSelection(snapClickSelection(store, cell.r, cell.c));
      return;
    }
    if (!ctrl) setMulti([]);
    // Excel: clicking a merged cell selects the whole merge; shift-extend snaps to merge edges.
    selectSelection(shift && selectedRef.current ? snapRangeSelection(store, extendSelection(selectedRef.current, cell)) : snapClickSelection(store, cell.r, cell.c));
  }, [painting, sourceStyle, selectSelection, cmdManager, store, setMulti, followHyperlink]);
  const commitEditingRef = useRef<((value: string, runs?: RichTextRun[]) => void) | null>(null);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const onAutoFilterClick = useCallback((r: number, c: number, x: number, y: number) => {
    setFilterPopup((current) => current !== null && current.r === r && current.c === c ? null : { r, c, x, y });
  }, []);
  const onHeaderContextMenu = useCallback((info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => {
    const cur = selectedRef.current;
    if (info.type === 'row') {
      const keep = cur?.kind === 'row' && info.r >= cur.range.r1 && info.r <= cur.range.r2;
      if (!keep) flushSync(() => selectSelection(rowSelection(info.r, TOTAL_COLS)));
      const range = selectedRef.current?.range;
      setCtxMenu({ kind: 'row', index: range?.r1 ?? info.r, count: range !== undefined ? range.r2 - range.r1 + 1 : 1, x, y });
    } else {
      const keep = cur?.kind === 'column' && info.c >= cur.range.c1 && info.c <= cur.range.c2;
      if (!keep) flushSync(() => selectSelection(columnSelection(info.c, TOTAL_ROWS)));
      const range = selectedRef.current?.range;
      setCtxMenu({ kind: 'column', index: range?.c1 ?? info.c, count: range !== undefined ? range.c2 - range.c1 + 1 : 1, x, y });
    }
  }, [selectSelection]);
  const onCellContextMenu = useCallback((cell: CellAddress, x: number, y: number) => {
    const cellMenu = (): SpreadsheetContextMenu => ({ kind: 'cell', x, y, r: cell.r, c: cell.c });
    const cur = selectedRef.current;
    // Excel: right-click inside selection keeps it; outside selects that cell.
    // Full row/col selection keeps kind and opens the matching header-style menu.
    if (cur !== null && new Range(cur.range).contains(cell.r, cell.c)) {
      if (cur.kind === 'row') {
        setCtxMenu({ kind: 'row', index: cur.range.r1, count: cur.range.r2 - cur.range.r1 + 1, x, y });
        return;
      }
      if (cur.kind === 'column') {
        setCtxMenu({ kind: 'column', index: cur.range.c1, count: cur.range.c2 - cur.range.c1 + 1, x, y });
        return;
      }
      setCtxMenu(cellMenu());
      return;
    }
    flushSync(() => selectSelection(cellSelection(cell.r, cell.c)));
    setCtxMenu(cellMenu());
  }, [selectSelection, store]);
  const execCmd = useCallback((cmd: Command) => {
    if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store);
  }, [cmdManager, store]);
  const { canvasRef, rendererRef } = useCanvasRenderer(store, selected, onCellClick, selectSelection, view, setView, cmdManager, onHeaderContextMenu, onCellContextMenu, onAutoFilterClick, editingRef);
  const handleRefHighlights = useCallback((ranges: readonly FormulaRefHighlight[] | null) => { rendererRef.current?.setFormulaRefHighlights(ranges); }, []);
  // The renderer refuses to steal canvas focus (which would blur-commit the
  // cell editor) only while its editing flag is set — keep it in sync.
  useEffect(() => {
    rendererRef.current?.setEditing(editing !== null);
  }, [editing, rendererRef]);
  // Find highlights are sheet-tagged: the renderer only ever sees the active
  // sheet's slice, refreshed whenever either the matches or the sheet change.
  const [findHighlights, setFindHighlights] = useState<{ matches: readonly FindMatch[]; current: number } | null>(null);
  useEffect(() => {
    if (findHighlights === null || findHighlights.matches.length === 0) {
      rendererRef.current?.setHighlightMatches([], -1);
      return;
    }
    const active = store.getActiveSheetId();
    const cells = findHighlights.matches
      .filter((m) => m.sheetId === active)
      .map((m) => ({ r: m.r, c: m.c }));
    const currentMatch = findHighlights.current >= 0 ? findHighlights.matches[findHighlights.current] : undefined;
    const current = currentMatch !== undefined && currentMatch.sheetId === active
      ? cells.findIndex((cell) => cell.r === currentMatch.r && cell.c === currentMatch.c)
      : -1;
    rendererRef.current?.setHighlightMatches(cells, current);
  }, [findHighlights, activeSheetId, store]);
  rendererApiRef.current = { setExtraRanges: (ranges) => rendererRef.current?.setExtraRanges(ranges) };
  useEffect(() => rendererRef.current?.setEditing(editing !== null), [editing, rendererRef]);
  // Excel clipboard session: copy/cut mark a source (marching ants); cut clears the source
  // only when the paste lands. Copy sessions allow repeated pastes; cut pastes once.
  // Excel "End mode": End arms the next arrow key to edge-jump (like Ctrl+arrow).
  const endModeRef = useRef(false);
  const { clipboardSession, clearClipboardSession, runClipboard, runCtxClipboard, pasteSpecialOpen, setPasteSpecialOpen, applyPasteSpecial } = useClipboardSession(store, cmdManager, rendererRef, selectedRef, multiRef);
  const startEditing = (cell: CellAddress, value?: string, editMode = false, caret?: number): void => {
    // Excel: a protected sheet rejects edit-mode entry outright — one warning
    // per user attempt (F2 / double-click / typing), not per keystroke. The
    // commit-path guard below stays as a backstop for protection enabled
    // mid-edit.
    if (store.isSheetProtected()) { message.warning('工作表已保护，无法编辑'); return; }
    // Excel: entering edit mode cancels the marching-ants clipboard session.
    if (clipboardSession.current !== null) clearClipboardSession();
    // Excel: editing a merged cell always targets the anchor (upper-left) cell.
    const { anchor, merge } = resolveEditAnchor(store, cell.r, cell.c);
    const editValue = value ?? cellEditValue(store, anchor);
    // Excel: typing with a multi-cell selection keeps the range (Ctrl+Enter fills it all).
    const cur = selectedRef.current;
    const keep = cur !== null && (cur.range.r1 !== cur.range.r2 || cur.range.c1 !== cur.range.c2) && new Range(cur.range).contains(anchor.r, anchor.c);
    const next = keep && cur !== null
      ? rangeSelection(cur.range, cur.anchor, anchor)
      : merge !== undefined
        ? rangeSelection(merge, { r: merge.r1, c: merge.c1 }, { r: merge.r1, c: merge.c1 })
        : cellSelection(anchor.r, anchor.c);
    selectedRef.current = next;
    setSelected(next);
    const clamped = caret !== undefined ? Math.max(0, Math.min(caret, editValue.length)) : undefined;
    const existing = store.getCell(anchor.r, anchor.c);
    const rich = isRich(existing?.richText) ? [...existing!.richText!] : undefined;
    setEditing({
      ...anchor,
      value: editValue,
      editMode,
      ...(clamped !== undefined ? { caret: clamped } : {}),
      ...(rich !== undefined ? { richDraft: rich, ...(clamped !== undefined ? { richSel: { start: clamped, end: clamped } } : {}) } : {}),
    });
  };
  // Excel: cancel (Esc) returns keyboard focus to the grid just like commit —
  // the unmounting editor otherwise leaves focus on <body> and arrows/F2/undo
  // stay dead until the next canvas click. The ref must clear BEFORE the
  // refocus: focusing the canvas blurs the editor and the blur-commit guard
  // (editingRef === null) is what keeps the cancelled draft from committing.
  const cancelEditing = (): void => {
    editingRef.current = null;
    canvasRef.current?.focus();
    setEditing(null);
  };
  const commitEditing = (value: string, moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection = false, runs?: RichTextRun[]): void => {
    const ed = editingRef.current;
    // Guarded by the ref so a blur right after a click-commit never double-writes.
    editingRef.current = null;
    if (ed !== null) {
      if (store.isSheetProtected()) { message.warning('工作表已保护，无法编辑'); cancelEditing(); return; }
      const rule = store.getValidationRule(ed.r, ed.c);
      if (rule !== undefined) {
        const svc = new DataValidationService();
        const result = svc.validate(value, rule);
        if (!result.valid) {
          message.warning(result.message ?? '输入值不符合验证规则');
          editingRef.current = ed;
          setEditing(ed);
          return;
        }
      }
      const selRange = fillSelection ? selectedRef.current?.range : undefined;
      const fillAll = selRange !== undefined && (selRange.r1 !== selRange.r2 || selRange.c1 !== selRange.c2);
      if (fillAll && selRange !== undefined) {
        applyMatrix(store, cmdManager, selRange.r1, selRange.c1, fillSelectionPatches(selRange, ed, value, runs));
      } else {
        setCellText(store, cmdManager, ed, value, runs);
      }
      // Excel: Alt+Enter auto-enables Wrap Text and grows the row
      if (value.includes('\n')) {
        const range = fillAll && selRange !== undefined ? selRange : { r1: ed.r, c1: ed.c, r2: ed.r, c2: ed.c };
        applyShortcutStyle(store, cmdManager, range, { wrap: true });
        growRowsToContent(store, range);
      }
      if (moveAfter !== undefined) {
        const next = Range.single(
          clampVal(ed.r + moveAfter.dr, 0, TOTAL_ROWS - 1),
          clampVal(ed.c + moveAfter.dc, 0, TOTAL_COLS - 1),
        ).toAddress();
        selectedRef.current = cellSelection(next.r1, next.c1);
        selectRange(next);
      }
    }
    // Excel: the editor unmounts on commit — put keyboard focus back on the
    // grid, or arrows/undo stay dead until the user clicks a cell.
    canvasRef.current?.focus();
    setEditing(null);
  };
  commitEditingRef.current = (value: string, runs?: RichTextRun[]) => commitEditing(value, undefined, false, runs);

  /**
   * Excel: run-level style keys with a cell editor open format the selected
   * characters of the draft (turning the cell rich) instead of the cells.
   * The same applies with a character selection in the FORMULA BAR — there the
   * cell's runs are edited directly (no edit session). Bold/italic/underline
   * toggle against the selection: only when EVERY selected character already
   * carries the attribute does it turn off. Non-run keys (fill, alignment,
   * number format…) fall through to whole cells.
   */
  const applyRunStyleToEditor = useCallback((style: Partial<Style>): boolean => {
    const buildPatch = (): { patch: RunStylePatch; ok: boolean } => {
      const patch: RunStylePatch = {};
      let hasRunKey = false;
      for (const key of ['bold', 'italic', 'underline', 'fontSize', 'fontFamily', 'color'] as const) {
        const value = (style as Record<string, unknown>)[key];
        if (value !== undefined) { (patch as Record<string, unknown>)[key] = value; hasRunKey = true; }
      }
      return { patch, ok: hasRunKey };
    };
    // No cell editor open: a character selection in the formula bar edits the
    // anchor cell's runs directly (Excel formula-bar behavior).
    if (editingRef.current === null) {
      const { patch, ok } = buildPatch();
      if (!ok) return false;
      const fbSel = formulaBarHandleRef.current?.getSelection();
      const start = fbSel?.start ?? formulaInputRef.current?.selectionStart ?? 0;
      const end = fbSel?.end ?? formulaInputRef.current?.selectionEnd ?? 0;
      const active = selectedRef.current?.active ?? (selectedRef.current !== null ? { r: selectedRef.current.range.r1, c: selectedRef.current.range.c1 } : null);
      if (active === null || end <= start) return false;
      const cell = store.getCell(active.r, active.c);
      // Excel: only text constants carry per-character formatting.
      if (cell === undefined || cell.formula !== undefined || typeof cell.value === 'number' || typeof cell.value === 'boolean') return false;
      if (end > cell.text.length) return false;
      const runs = isRich(cell.richText) ? [...cell.richText] : (runsFromText(cell.text) ?? [{ text: cell.text }]);
      const cellStyle = cell.styleId !== undefined ? store.getStyle(cell.styleId) : undefined;
      const mutablePatch = patch as Record<string, unknown>;
      for (const key of ['bold', 'italic', 'underline'] as const) {
        if (patch[key] === true && charsAllHave(runs, start, end, key, cellStyle)) {
          mutablePatch[key] = cellStyle?.[key] === true ? false : undefined;
        }
      }
      const nextRuns = applyRunStyle(runs, start, end, patch);
      const normalized = normalizeRuns(nextRuns);
      setCellText(store, cmdManager, active, flattenRuns(nextRuns), normalized ?? undefined);
      return true;
    }
    const patch0 = buildPatch();
    if (!patch0.ok) return false;
    const patch = patch0.patch;
    // Resolve the draft's runs + selection (rich editor already open, or the plain textarea).
    let runs: RichTextRun[];
    let sel: { start: number; end: number } | null;
    if (richApiRef.current !== null) {
      runs = richApiRef.current.getRuns();
      sel = richApiRef.current.getSelection();
    } else {
      const el = inputRef.current;
      if (el === null) return false;
      sel = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
      runs = runsFromText(el.value) ?? [{ text: el.value }];
    }
    if (sel === null) return false;
    // Collapsed caret: arm typing style (Excel) via the rich editor / upgrade path.
    if (sel.end <= sel.start) {
      if (richApiRef.current !== null) return richApiRef.current.applyRunStyle(patch);
      const ed0 = editingRef.current;
      if (ed0 === null) return false;
      const upgraded: EditingCell = {
        ...ed0,
        richDraft: ed0.richDraft ?? (runsFromText(ed0.value) ?? [{ text: ed0.value }]),
        richSel: { start: sel.start, end: sel.start },
      };
      editingRef.current = upgraded;
      setEditing(upgraded);
      // applyRunStyle after upgrade lands on the next paint; queue microtask.
      queueMicrotask(() => { richApiRef.current?.applyRunStyle(patch); });
      return true;
    }
    const ed = editingRef.current;
    const cellStyle = ed !== null && store.getCell(ed.r, ed.c)?.styleId !== undefined ? store.getStyle(store.getCell(ed.r, ed.c)!.styleId!) : undefined;
    const mutablePatch = patch as Record<string, unknown>;
    for (const key of ['bold', 'italic', 'underline'] as const) {
      if (patch[key] === true && charsAllHave(runs, sel.start, sel.end, key, cellStyle)) {
        // Excel toggle: clear the override, unless the cell style itself carries
        // the attribute — then an explicit false is needed to win over inherit.
        mutablePatch[key] = cellStyle?.[key] === true ? false : undefined;
      }
    }
    // Rich editor already open: patch its selection.
    if (richApiRef.current !== null) return richApiRef.current.applyRunStyle(patch);
    // Plain textarea with selected characters: upgrade the draft to rich runs.
    const nextRuns = applyRunStyle(runs, sel.start, sel.end, patch);
    const nextEd: EditingCell = { ...ed!, richDraft: nextRuns, value: flattenRuns(nextRuns), richSel: { start: sel.start, end: sel.end } };
    editingRef.current = nextEd;
    setEditing(nextEd);
    return true;
  }, []);
  editorRunStyleIntercept.current = applyRunStyleToEditor;
  /** Editor-mode Ctrl+B/I/U entry point (same toggle semantics as the buttons). */
  const applyCharStyleKey = useCallback((key: 'bold' | 'italic' | 'underline'): void => { void applyRunStyleToEditor({ [key]: true }); }, [applyRunStyleToEditor]);

  useTheme(theme);
  useFormulaSync(store, formulaEngine);
  useStoreSheets(store, setSheets, setActiveSheetId);
  useStoreVersion(store, () => setStoreVersion((value) => value + 1));
  useFormulaValue(selected, editing, store, storeVersion, setFormulaValue);
  // Keep ready-mode formula-bar runs aligned with the active cell.
  useEffect(() => {
    if (editing !== null) return;
    if (selected === null) { formulaRunsRef.current = undefined; bumpFormulaRuns(); return; }
    const active = selected.active ?? { r: selected.range.r1, c: selected.range.c1 };
    const cell = store.getCell(active.r, active.c);
    if (cell === undefined || cell.formula !== undefined || typeof cell.value === 'number' || typeof cell.value === 'boolean') {
      formulaRunsRef.current = undefined;
      bumpFormulaRuns();
      return;
    }
    formulaRunsRef.current = isRich(cell.richText) ? [...cell.richText] : (runsFromText(cell.text) ?? [{ text: cell.text ?? '' }]);
    bumpFormulaRuns();
  }, [selected, editing, store, storeVersion]);
  useAutoSave(store);
  // Excel: opening the editor places the caret after the typed text (typing)
  // or at the end of the content (F2/double-click) — never at position 0.
  // The cell-key guard keeps mid-edit caret moves (same cell) untouched.
  // When the editor closes the overlay unmounts, so el === null there — the
  // key MUST reset on that path too, or re-opening the same cell (F2 after a
  // committed edit) skips the caret placement and stays at the browser's
  // default position 0.
  const lastEditKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (el === null) { lastEditKeyRef.current = null; return; }
    el.focus();
    if (editing === null) { lastEditKeyRef.current = null; return; }
    const key = `${editing.r}:${editing.c}`;
    if (lastEditKeyRef.current !== key) {
      // Typing starts at end of the typed char; F2 at end; double-click uses hit caret.
      const pos = editing.caret !== undefined ? editing.caret : el.value.length;
      el.setSelectionRange(pos, pos);
      lastEditKeyRef.current = key;
    }
  }, [editing]);
  // Ctrl/Cmd+P: browser-native print would dump the viewport bitmap only —
  // route the shortcut to the paginated print preview instead.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p')) return;
      // Excel: no print while editing a cell or typing in an input/dialog.
      if (editing) return;
      const target = e.target as HTMLElement | null;
      if (target !== null && (target.closest('input, textarea, select, [contenteditable="true"]') !== null)) return;
      e.preventDefault();
      setFindDialogOpen('printPreview');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing]);

  return <ErrorBoundary><div className="ss-root">
    <MenuBar {...menuBarProps(store, cmdManager, selected, selectRange, () => selectSelection(sheetSelection(allSheetRange())), onClose, applyRunStyleToEditor)} view={{ ...view, setZoom: (zoom) => setView((current) => ({ ...current, zoom })), setShowFormula: (showFormula) => setView((current) => ({ ...current, showFormula })), setShowGrid: (showGrid) => setView((current) => ({ ...current, showGrid })), setFreeze: (frozenRows, frozenCols) => setView((current) => ({ ...current, frozenRows, frozenCols })) }} onFindNavigate={(match) => { if (match.sheetId !== store.getActiveSheetId()) store.activateSheet(match.sheetId); selectSelection(cellSelection(match.r, match.c)); }} onFindHighlight={(matches, current) => setFindHighlights(matches.length === 0 ? null : { matches, current })} openDialogKey={findDialogOpen} onCreateChart={(type, title) => submitCreateChart(type, title, store, selected, execCmd, rendererRef.current, setSelectedChartId)} onCreateImage={(src, name) => submitCreateImage(src, name, selected, execCmd, setSelectedImageId)} onSetWorkbookPassword={(hash) => { store.setWorkbookPasswordHash(hash); void saveToDB(DEFAULT_ID, store.serialize()); }} onInsertSparkline={(type, rangeInput) => submitInsertSparkline(type, rangeInput, store, selected, execCmd)} />
    <InteractionToolbar selected={selected} store={store} cmdManager={cmdManager} view={view} setView={setView} selectAll={() => selectSelection(sheetSelection(allSheetRange()))} painting={painting} onTogglePainter={() => { if (painting) { setPainting(false); setSourceStyle(undefined); } else { const cell = selected?.active; const s = cell === undefined ? undefined : store.getCell(cell.r, cell.c)?.styleId === undefined ? undefined : store.getStyle(store.getCell(cell.r, cell.c)!.styleId!); setSourceStyle(s); setPainting(true); } }} onToggleProtection={() => setProtectOpen(true)} />
    <ProtectionModal open={protectOpen} onClose={() => setProtectOpen(false)} store={store} />
    {workbookLocked && <Modal
      title="工作簿已锁定"
      open
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={[
        <Button key="unlock" type="primary" onClick={() => { if (hashPassword(unlockInput) === store.getWorkbookPasswordHash()) { setWorkbookUnlocked(true); setUnlockInput(''); message.success('已解锁'); } else message.error('密码错误'); }}>解锁</Button>,
      ]}
      width={380}
    >
      <Input.Password
        autoFocus
        placeholder="输入工作簿密码"
        value={unlockInput}
        onChange={(e) => setUnlockInput(e.target.value)}
        onPressEnter={() => { if (hashPassword(unlockInput) === store.getWorkbookPasswordHash()) { setWorkbookUnlocked(true); setUnlockInput(''); } else message.error('密码错误'); }}
      />
    </Modal>}
    <Modal
      title={sheetPrompt?.mode === 'rename' ? '重命名工作表' : '新建工作表'}
      open={sheetPrompt !== null}
      onCancel={() => setSheetPrompt(null)}
      onOk={() => {
        if (sheetPrompt === null) return;
        const name = sheetPrompt.value.trim();
        if (name === '') return;
        if (sheetPrompt.mode === 'rename' && sheetPrompt.id !== undefined) store.renameSheet(sheetPrompt.id, name);
        else store.addSheet(name);
        setSheetPrompt(null);
      }}
      okText="确定"
      cancelText="取消"
      width={360}
      destroyOnHidden
    >
      <Input
        autoFocus
        value={sheetPrompt?.value ?? ''}
        placeholder="工作表名称"
        onChange={(e) => setSheetPrompt((current) => current === null ? current : { ...current, value: e.target.value })}
        onPressEnter={() => {
          if (sheetPrompt === null) return;
          const name = sheetPrompt.value.trim();
          if (name === '') return;
          if (sheetPrompt.mode === 'rename' && sheetPrompt.id !== undefined) store.renameSheet(sheetPrompt.id, name);
          else store.addSheet(name);
          setSheetPrompt(null);
        }}
      />
    </Modal>
    <FormulaBar selected={selected} value={formulaValue} runs={formulaRunsTick < 0 ? undefined : formulaRunsRef.current} onChange={(next, nextRuns) => {
      const prev = formulaValue;
      setFormulaValue(next);
      const ed = editingRef.current;
      if (ed !== null) {
        if (ed.richDraft !== undefined) {
          const synced: EditingCell = {
            ...ed,
            value: next,
            richDraft: nextRuns !== undefined ? [...nextRuns] : applyTextChangeToRuns(ed.richDraft, ed.value, next),
          };
          editingRef.current = synced;
          setEditing(synced);
        } else {
          const synced: EditingCell = { ...ed, value: next };
          editingRef.current = synced;
          setEditing(synced);
        }
        return;
      }
      if (next.startsWith('=')) {
        formulaRunsRef.current = undefined;
        bumpFormulaRuns();
      } else if (nextRuns !== undefined) {
        formulaRunsRef.current = [...nextRuns];
        bumpFormulaRuns();
      } else if (formulaRunsRef.current !== undefined) {
        formulaRunsRef.current = applyTextChangeToRuns(formulaRunsRef.current, prev, next);
      }
    }} onCommit={(committed, fillSelection) => {
      const value = committed ?? formulaBarHandleRef.current?.getValue() ?? formulaInputRef.current?.value ?? formulaValue;
      if (store.isSheetProtected()) { message.warning('工作表已保护，无法编辑'); return; }
      const ed = editingRef.current;
      if (ed !== null) { commitEditing(value, undefined, fillSelection === true, ed.richDraft !== undefined ? normalizeRuns(ed.richDraft) ?? undefined : undefined); return; }
      const range = selected?.range;
      const multi = fillSelection === true && range !== undefined && (range.r1 !== range.r2 || range.c1 !== range.c2);
      if (multi && range !== undefined && selected !== null) {
        const active = selected.active ?? { r: range.r1, c: range.c1 };
        applyMatrix(store, cmdManager, range.r1, range.c1, fillSelectionPatches(range, active, value, formulaRunsRef.current));
        return;
      }
      commitFormulaValue(selected, value, store, cmdManager, formulaRunsRef.current);
    }} onCancel={() => {
      canvasRef.current?.focus();
      if (editingRef.current !== null) { cancelEditing(); return; }
      const sel = selectedRef.current;
      if (sel === null) { setFormulaValue(''); formulaRunsRef.current = undefined; return; }
      const active = sel.active ?? { r: sel.range.r1, c: sel.range.c1 };
      const cell = store.getCell(active.r, active.c);
      setFormulaValue(cell?.formula ?? cell?.text ?? '');
      formulaRunsRef.current = cell !== undefined && isRich(cell.richText) ? [...cell.richText] : (cell !== undefined ? runsFromText(cell.text) : undefined);
      bumpFormulaRuns();
    }} onGoTo={(input) => { jumpNameBox(store, input, selectRange); canvasRef.current?.focus(); }} inputRef={formulaInputRef} handleRef={formulaBarHandleRef} onCharStyleKey={applyCharStyleKey} />
    <div className="ss-canvas-wrap"><canvas ref={canvasRef} className="ss-canvas" tabIndex={0} aria-label="Spreadsheet canvas, use arrow keys to navigate" onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'v') {
          // Excel: Ctrl+Alt+V opens Paste Special.
          e.preventDefault();
          setPasteSpecialOpen(true);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey && clipboardSession.current !== null && selectedRef.current !== null) {
          // Excel: Enter with marching ants pastes once and clears the clipboard session.
          e.preventDefault();
          void runClipboard('paste', selectedRef.current.range).then(() => clearClipboardSession());
          return;
        }
        if (handleEndMode(e, selectedRef.current, store, endModeRef, selectSelection, selectRange)) return;
        handleCanvasKeyDown(e, selectedRef.current, { store, cmdManager, startEditing, selectSelection, selectRange, setView, setFindDialog: setFindDialogOpen, runClipboard, clearClipboardSession, execCmd, frozenRows: view.frozenRows, frozenCols: view.frozenCols, zoom: view.zoom, clearMulti: () => setMulti([]), multiRanges: () => multiRef.current });
      }} onDoubleClick={(e) => {
        const cell = rendererRef.current?.cellAtPoint(e.clientX, e.clientY);
        if (cell == null) return;
        const caret = caretOffsetAtClick(rendererRef.current, store, cell, e.clientX, e.clientY, view.zoom);
        startEditing(cell, undefined, true, caret);
      }} />
      {editing !== null && <EditorOverlay refEl={inputRef} editingRefSetter={(cell) => { editingRef.current = cell; setEditing(cell); }} editing={editing} setEditing={setEditing} cancel={cancelEditing} commit={commitEditing} zoom={view.zoom} store={store} richApiRef={richApiRef} onCharStyleKey={applyCharStyleKey} onRefHighlights={handleRefHighlights} {...(rendererRef.current !== null ? { cellRect: rendererRef.current.getCellViewportRect(editing.r, editing.c) } : {})} />}
      <div className="ss-chart-layer">{store.getCharts().map((spec) => <FloatingChart key={spec.id} spec={spec} store={store} renderer={rendererRef.current} selected={selectedChartId === spec.id} onSelect={setSelectedChartId} onGeometry={(id, anchor) => execCmd(new SetChartAnchorCommand({ id, anchor }))} onRemove={(id) => { execCmd(new RemoveChartCommand({ id })); setSelectedChartId((current) => current === id ? null : current); canvasRef.current?.focus(); }} onUndo={() => cmdManager?.undo()} onRedo={() => cmdManager?.redo()} />)}
        {store.getImages().map((img) => <FloatingImage key={img.id} spec={img} renderer={rendererRef.current} selected={selectedImageId === img.id} onSelect={setSelectedImageId} onGeometry={(id, anchor) => execCmd(new SetImageAnchorCommand({ id, anchor }))} onRemove={(id) => { execCmd(new RemoveImageCommand({ id })); setSelectedImageId((current) => current === id ? null : current); canvasRef.current?.focus(); }} onUndo={() => cmdManager?.undo()} onRedo={() => cmdManager?.redo()} />)}
      </div></div>
      <PasteSpecialDialog open={pasteSpecialOpen} onOk={(opts) => void applyPasteSpecial(opts)} onCancel={() => setPasteSpecialOpen(false)} />
      {filterPopup !== null && <FilterDropdown store={store} cmdManagerExecutor={execCmd} r={filterPopup.r} c={filterPopup.c} x={filterPopup.x} y={filterPopup.y} onClose={() => setFilterPopup(null)} />}
    <StatusBar store={store} selected={selected?.range ?? null} zoom={view.zoom} />
    <BottomBar sheets={sheets} activeSheetId={activeSheetId} onSheetChange={(id) => { setMulti([]); store.activateSheet(id); }} onAddSheet={() => setSheetPrompt({ mode: 'add', value: `Sheet${store.getSheets().length + 1}` })} onRenameSheet={(id) => setSheetPrompt({ mode: 'rename', id, value: sheets.find((s) => s.id === id)?.name ?? '' })} onDeleteSheet={(id) => deleteSheet(store, id)} onMoveSheet={(id, toIndex) => store.moveSheet(id, toIndex)} onSheetColor={(id, color) => store.setSheetColor(id, color)} onMoveOrCopySheet={(id) => setMoveOrCopySheetId(id)} />
      {moveOrCopySheetId !== null && (
        <MoveOrCopySheetDialog
          open
          sheetId={moveOrCopySheetId}
          sheets={sheets}
          onCancel={() => setMoveOrCopySheetId(null)}
          onSubmit={(values) => {
            const id = moveOrCopySheetId;
            setMoveOrCopySheetId(null);
            applyMoveOrCopySheet(store, id, values);
          }}
        />
      )}
    {ctxMenu?.kind === 'cell' && <CellContextMenu
      x={ctxMenu.x} y={ctxMenu.y} onClose={closeCtxMenu}
      onCut={() => runCtxClipboard('cut')} onCopy={() => runCtxClipboard('copy')} onPaste={() => runCtxClipboard('paste')} onClear={() => runCtxClipboard('clear')} onPasteSpecial={() => setPasteSpecialOpen(true)}
      onInsertRow={() => { const range = selectedRef.current?.range; const r = range?.r1 ?? 0; const count = range !== undefined ? range.r2 - range.r1 + 1 : 1; execCmd(new InsertRowCommand({ r, count, position: 'above' })); }}
      onInsertCol={() => { const range = selectedRef.current?.range; const c = range?.c1 ?? 0; const count = range !== undefined ? range.c2 - range.c1 + 1 : 1; execCmd(new InsertColCommand({ c, count, position: 'left' })); }}
      onDeleteRow={() => { const range = selectedRef.current?.range; if (range === undefined) return; execCmd(new DeleteRowCommand({ r: range.r1, count: range.r2 - range.r1 + 1 })); }}
      onDeleteCol={() => { const range = selectedRef.current?.range; if (range === undefined) return; execCmd(new DeleteColCommand({ c: range.c1, count: range.c2 - range.c1 + 1 })); }}
      onNumberFormat={() => { setFindDialogOpen(null); queueMicrotask(() => setFindDialogOpen('numberFormat')); }}
    />}
    {(ctxMenu?.kind === 'row' || ctxMenu?.kind === 'column') && <HeaderContextMenu
      x={ctxMenu.x} y={ctxMenu.y} type={ctxMenu.kind} index={ctxMenu.index} count={ctxMenu.count} onClose={closeCtxMenu}
      onCut={() => runCtxClipboard('cut')} onCopy={() => runCtxClipboard('copy')} onPaste={() => runCtxClipboard('paste')} onClear={() => runCtxClipboard('clear')}
      onInsertRow={(r, position, count) => execCmd(new InsertRowCommand({ r, count, position }))}
      onDeleteRow={(r, count) => execCmd(new DeleteRowCommand({ r, count }))}
      onSetRowHeight={(r, height) => execCmd(new SetRowHeight({ r, height }))}
      onSetRowsHidden={(r, count, hidden) => unhideOrHideRows(store, execCmd, r, count, hidden)}
      onInsertCol={(c, position, count) => execCmd(new InsertColCommand({ c, count, position }))}
      onDeleteCol={(c, count) => execCmd(new DeleteColCommand({ c, count }))}
      onSetColWidth={(c, width) => execCmd(new SetColWidth({ c, width }))}
      onSetColsHidden={(c, count, hidden) => unhideOrHideCols(store, execCmd, c, count, hidden)}
    />}
  </div></ErrorBoundary>;
};

export class Spreadsheet {
  public readonly store = new Store();
  public readonly events = new EventBus();
  public readonly cmdManager = new CommandManager(this.store, this.events);
  public readonly formula = new FormulaEngine(this.store);
  private readonly plugins = new PluginManager(this);
  private root: Root | null = null;
  private userTouched = false;
  private offTouch: (() => void) | null = null;
  public constructor(private readonly mountRoot: HTMLElement, private readonly options: SpreadsheetOptions = {}) {}
  public mount(): void { this.loadInitialData(); this.offTouch = this.store.subscribe(() => { this.userTouched = true; }); void this.tryRestoreFromDB(); this.root = createRoot(this.mountRoot); this.root.render(<SpreadsheetComponent store={this.store} cmdManager={this.cmdManager} formulaEngine={this.formula} theme={this.options.theme} />); }
  public destroy(): void { this.root?.unmount(); this.root = null; this.offTouch?.(); this.offTouch = null; this.plugins.clear(); }
  public use(plugin: Plugin): this { this.plugins.use(plugin); return this; }
  public get rowCount(): number { return this.options.data?.length ?? this.options.sheets?.[0]?.data?.length ?? 0; }

  private loadInitialData(): void {
    if (this.options.sheets !== undefined) loadSheets(this.store, this.cmdManager, this.formula, this.options.sheets);
    else if (this.options.data !== undefined) loadData(this.store, this.cmdManager, this.formula, this.options.data);
    this.cmdManager.clear();
  }

  private async tryRestoreFromDB(): Promise<void> {
    if (this.options.sheets !== undefined || this.options.data !== undefined) return;
    try {
      const data = await loadWorkbook(DEFAULT_ID);
      // The load is async: anything the user (or app code) wrote meanwhile
      // wins — a late restore must not clobber it or wipe fresh undo state.
      if (data === undefined || this.userTouched) return;
      this.store.replaceAll(data);
      this.store.setWorkbookPasswordHash(data.passwordHash);
      this.cmdManager.clear();
    } catch (err) {
      console.error('Failed to restore workbook from IndexedDB:', err);
    }
  }
}

export { createFormulaSync } from './formulaSync';

/** Excel: rows grow to fit a just-applied font size / wrap. Direct write — see growRowsToContent note in MenuBar. */

function useTheme(theme: Theme | false | undefined): void { useEffect(() => { if (theme === false) return; if (theme === undefined) applyStoredTheme(); else setTheme(theme); dispatchThemeChanged(); }, [theme]); }
function useStoreSheets(store: Store, setSheets: (s: readonly SheetInfo[]) => void, setActive: (id: string) => void): void { useEffect(() => store.subscribe((event) => { if (event.type !== 'sheet') return; setSheets(store.getSheets()); setActive(store.getActiveSheetId()); }), [store, setSheets, setActive]); }
function useStoreVersion(store: Store, bump: () => void): void { useEffect(() => store.subscribe(() => bump()), [store, bump]); }
function useAutoSave(store: Store): void { useEffect(() => { const handle = startAutoSave(store); return () => handle.stop(); }, [store]); }
function useFormulaValue(selected: Selection | null, editing: EditingCell | null, store: Store, storeVersion: number, setFormulaValue: (value: string) => void): void {
  useEffect(() => {
    if (selected === null) return;
    // Excel formula bar tracks the active cell (not just the selection origin).
    const active = selected.active ?? { r: selected.range.r1, c: selected.range.c1 };
    if (editing !== null && editing.r === active.r && editing.c === active.c) {
      setFormulaValue(editing.value);
      return;
    }
    const cell = store.getCell(active.r, active.c);
    setFormulaValue(cell?.formula ?? cell?.text ?? '');
  }, [selected, editing, store, storeVersion, setFormulaValue]);
}

/** Excel Ctrl+End target: bottom-right of the used range (any cell with content). */

/**
 * Excel End mode: pressing End arms it; the next plain arrow edge-jumps (like
 * Ctrl+arrow, Shift extends) and disarms. Any other key just disarms.
 * Returns true when the event was consumed.
 */

function deleteSheet(store: Store, id: string): void {
  // window.confirm is suppressed (auto-dismissed) in embedded browsers — use
  // the in-app confirm so the entry point never silently does nothing.
  Modal.confirm({
    title: '删除工作表',
    content: '确定要删除此工作表吗？',
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => store.deleteSheet(id),
  });
}

function dispatchThemeChanged(): void { window.dispatchEvent(new CustomEvent('ss:theme-changed')); }






function menuBarProps(store: Store, cmdManager: CommandManager | undefined, selected: Selection | null, selectRange: (range: RangeAddress) => void, allRange: () => void, onClose: (() => void) | undefined, applyRunStyleToEditor: (style: Partial<Style>) => boolean): React.ComponentProps<typeof MenuBar> {
  const range = selected?.range ?? null;
  const activeCell = selected?.active ?? null;
  const props = { store, selected: range, activeCell, selectRange, clearRange: () => { if (range !== null) clearRange(store, cmdManager, range); }, allRange, applyRunStyleToEditor };
  return cmdManager === undefined ? withClose(props, onClose) : withClose({ ...props, cmdManager }, onClose);
}
function withClose<T extends Omit<React.ComponentProps<typeof MenuBar>, 'closeDemo'>>(props: T, onClose: (() => void) | undefined): React.ComponentProps<typeof MenuBar> {
  return onClose === undefined ? props : { ...props, closeDemo: onClose };
}

/** Excel: Enter/Tab cycle the active cell through a multi-cell selection (Shift reverses). */

/** Excel Alt+=: SUM over the contiguous numbers above the active cell, else to its left. */



/**
 * Excel arrow-key landing: hidden rows/columns are skipped in the step
 * direction (selection stays put when the rest of the grid is hidden), and a
 * merged cell remains one navigation stop — including when the step-out lands
 * on a hidden cell.
 */

/** 插入 → 图表: data range is the current selection; the object lands centered over the visible grid (Excel), selected. */

/** 插入 → 图片: anchored at the active cell, default size 4×6 cells, selected. */

/** Excel inserts a new chart centered on the visible grid with the default 15×7.5cm size. */

/** 插入 → 迷你图: anchored at the active cell; returns false (dialog stays open) on a bad range. */

/** Excel name box: jump to an A1 ref / range / defined name, switching sheets when prefixed. */

/**
 * 隐藏行: hide the clicked span. 取消隐藏 (Excel): restores the hidden rows
 * covered by the header selection — to unhide, select across the collapsed
 * gap (or a wider span) and choose 取消隐藏, exactly like Excel.
 */

/** 隐藏列 / 取消隐藏列: same selection-scoped unhide semantics as rows (Excel). */


