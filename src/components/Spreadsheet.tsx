import { Button, ColorPicker, Divider, Dropdown, Form, Input, Modal, Select, Space, Switch, Tooltip, message } from 'antd';
import { DownOutlined, AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BgColorsOutlined, BoldOutlined, BorderBottomOutlined, BorderInnerOutlined, BorderLeftOutlined, BorderOuterOutlined, BorderRightOutlined, BorderTopOutlined, ClearOutlined, ColumnHeightOutlined, FontColorsOutlined, FormatPainterOutlined, ItalicOutlined, LockOutlined, SelectOutlined, UnderlineOutlined, StrikethroughOutlined, ZoomInOutlined, ZoomOutOutlined, TableOutlined, VerticalAlignTopOutlined, VerticalAlignMiddleOutlined, VerticalAlignBottomOutlined, MergeCellsOutlined } from '@ant-design/icons';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type FC, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { applyMatrix, clearRange, clearRangeCmd, CompositeCommand } from '../util/rangeValues';
import { fillSelectionPatches } from '../fill/fillSelection';
import { caretOffsetFromLocalPoint } from '../util/caretHit';
import { openHyperlink } from '../util/hyperlink';
import { repeatOnRange } from '../commands/repeat';
import { useMultiSelection } from './hooks/useMultiSelection';
import { useClipboardSession } from './hooks/useClipboardSession';
import type { Command } from '../commands/Command';
import type { DialogName } from './menu/types';
import { CommandManager } from '../commands/CommandManager';
import { SetCellText } from '../commands/impl/SetCellText';
import { hashPassword } from '../util/passwordHash';
import { SetRangeStyleCommand } from '../commands/impl/SetRangeStyle';
import { SetRangeBorderCommand, type BorderPreset, type BorderLine } from '../commands/impl/SetRangeBorder';
import { SetRangeValues } from '../commands/impl/SetRangeValues';
import { EventBus } from '../events/EventBus';
import { FormulaEngine } from '../formula/FormulaEngine';
import { isSingleMergeSelection, mergeSelection } from './mergeActions';
import { isExactlyOneMerge, moveDirection, resolveArrowTarget, resolveEditAnchor, snapClickSelection, snapRangeSelection } from '../selection/mergeSnap';
import { sameRange, skipHiddenCells } from '../selection/visibleStep';
import { KeyboardHandler, type MenuShortcutCommand } from '../keys/KeyboardHandler';
import type { FindMatch } from '../find/FindReplaceService';
import { PluginManager, type Plugin } from '../plugin/PluginManager';
import { CanvasRenderer, COL_HEADER_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, TOTAL_COLS, TOTAL_ROWS, type CellAddress, type FormulaRefHighlight } from '../renderer/CanvasRenderer';
import { useFormulaAssist, parseFormulaRefs, REF_HIGHLIGHT_PALETTE } from './formulaAssist';
import { FillRangeCommand } from '../commands/impl/FillRange';
import { adjustDecimalPlaces } from '../format/decimalPlaces';
import { CreateChartCommand } from '../commands/impl/CreateChart';
import { RemoveChartCommand } from '../commands/impl/RemoveChart';
import { SetChartAnchorCommand } from '../commands/impl/SetChartAnchor';
import { AddImageCommand, RemoveImageCommand, SetImageAnchorCommand } from '../commands/impl/ImageObject';
import { SetRowsHiddenCommand, SetColsHiddenCommand } from '../commands/impl/SetHidden';
import { SetSparklineCommand } from '../commands/impl/SetSparkline';
import { makeMoveRange } from '../commands/commandFactories';
import { SetColWidth } from '../commands/impl/SetColWidth';
import { SetRowHeight } from '../commands/impl/SetRowHeight';
import { InsertRowCommand } from '../commands/impl/InsertRow';
import { InsertColCommand } from '../commands/impl/InsertCol';
import { DeleteRowCommand } from '../commands/impl/DeleteRow';
import { DeleteColCommand } from '../commands/impl/DeleteCol';
import { Range, type RangeAddress } from '../selection/Range';
import { Store, type SheetInfo } from '../store/Store';
import { applyStoredTheme, setTheme, type Theme } from '../theme';
import { DataValidationService } from '../validation/DataValidationService';
import { protectSheet, unprotectSheet, verifyPassword } from '../protection/SheetProtection';
import { cellFromText, cellId, cellIdCoords, formulaDependencies, formulaText, normalizeCellInput, type CellInput as CellDataInput } from '../util/cell';
import { num2alpha } from '../util/alphabet';
import { cellSelection, columnSelection, extendSelection, rangeSelection, rowSelection, sheetSelection, type Selection } from '../selection/Selection';
import { CellContextMenu, HeaderContextMenu } from './ContextMenu';
import { PasteSpecialDialog } from './PasteSpecialDialog';
import { BottomBar } from './BottomBar';
import { ErrorBoundary } from './ErrorBoundary';
import { StatusBar } from './StatusBar';
import { FormulaBar, type FormulaBarHandle } from './FormulaBar';
import { MoveOrCopySheetDialog } from './menu/dialogs/MoveOrCopySheetDialog';
import { MenuBar, allSheetRange } from './menu/MenuBar';
import { excelSelectAll, edgeJump, currentRegion } from '../selection/currentRegion';
import { parseNameBoxInput } from '../selection/nameBox';
import { toggleAutoFilterCommand } from '../filter/toggleFilter';
import { FloatingChart } from '../charts/FloatingChart';
import { FloatingImage } from '../charts/FloatingImage';
import { CHART_DEFAULT_H, CHART_DEFAULT_W, CHART_MIN_H, CHART_MIN_W, type ChartAnchor, type ChartType } from '../charts/types';
import { normalizeAnchor } from '../charts/geometry';
import type { SparklineType } from '../sparkline/types';
import { FilterDropdown } from './FilterDropdown';
import { startAutoSave } from '../db/autoSave';
import { loadWorkbook, DEFAULT_ID, saveWorkbook as saveToDB } from '../db/WorkbookDB';
import type { Cell, Style, RichTextRun } from '../types';
import { WRAP_LINE_HEIGHT, wrappedContentHeight } from '../util/wrapText';
import { autoFitRowHeight, autofitRowHeights } from '../util/rowAutofit';
import { indentPixels, resolveCellAlign } from '../util/generalAlign';
import { DEFAULT_FONT_SIZE } from '../util/defaults';
import { fillShortcut } from '../fill/fillShortcut';
import { cycleDollars, endsWithRef, isPointTrigger, refAtCaret, upsertRef } from '../formula/pointMode';
import { RichEditor, normalizeEditorRuns, type RichEditorApi } from './RichEditor';
import { applyRunStyle, applyTextChangeToRuns, charsAllHave, flattenRuns, isRich, normalizeRuns, runsFromText, type RunStylePatch } from '../util/richText';

export { snapshotCells, buildSessionPasteValues, tilePlainCells, combineMultiRanges } from '../clipboard/session';
export type { ClipboardSessionState } from '../clipboard/session';
export type CellInput = CellDataInput;
export interface SheetInput { readonly id?: string; readonly name: string; readonly data?: readonly (readonly CellInput[])[] }
export interface SpreadsheetOptions { readonly data?: readonly (readonly CellInput[])[]; readonly sheets?: readonly SheetInput[]; readonly theme?: Theme | false }
export interface SpreadsheetProps { readonly store: Store; readonly cmdManager?: CommandManager; readonly formulaEngine?: FormulaEngine; readonly theme?: Theme | false | undefined; readonly onClose?: () => void }
interface EditingCell extends CellAddress { readonly value: string; /** Excel: F2/double-click = edit mode (arrows move the caret); typing = enter mode (arrows commit). */ readonly editMode?: boolean; /** Flat caret offset when opening the editor (double-click hit). */ readonly caret?: number; /** Excel point mode: the cell the formula's trailing reference currently points at. */ readonly point?: CellAddress; /** Mid-edit upgrade: run-level formatting was applied to a selection (forces the rich editor). */ readonly richDraft?: RichTextRun[]; /** Selection to restore in the rich editor after the upgrade. */ readonly richSel?: { readonly start: number; readonly end: number } }
interface ViewState { readonly zoom: number; readonly showFormula: boolean; readonly showGrid: boolean; readonly frozenRows: number; readonly frozenCols: number }
interface FilterPopupState { readonly r: number; readonly c: number; readonly x: number; readonly y: number }
/** Module-level hook the active instance registers so applyShortcutStyle can offer run-level styling to the open cell editor. */
const editorRunStyleIntercept: { current: ((style: Partial<Style>) => boolean) | null } = { current: null };
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
  const { canvasRef, rendererRef } = useCanvasRenderer(store, selected, onCellClick, selectSelection, view, setView, cmdManager, onHeaderContextMenu, onCellContextMenu, onAutoFilterClick, followHyperlink, editingRef);
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
  const commitEditing = (value: string, moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection = false, runs?: RichTextRun[]): void => {
    const ed = editingRef.current;
    // Guarded by the ref so a blur right after a click-commit never double-writes.
    editingRef.current = null;
    if (ed !== null) {
      if (store.isSheetProtected()) { message.warning('工作表已保护，无法编辑'); setEditing(null); return; }
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
  const lastEditKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
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
      if (editingRef.current !== null) { setEditing(null); return; }
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
        handleCanvasKeyDown(e, selectedRef.current, store, cmdManager, startEditing, selectSelection, selectRange, setView, setFindDialogOpen, runClipboard, clearClipboardSession, execCmd, view.frozenRows, view.frozenCols, view.zoom, () => setMulti([]), () => multiRef.current);
      }} onDoubleClick={(e) => {
        const cell = rendererRef.current?.cellAtPoint(e.clientX, e.clientY);
        if (cell == null) return;
        const caret = caretOffsetAtClick(rendererRef.current, store, cell, e.clientX, e.clientY, view.zoom);
        startEditing(cell, undefined, true, caret);
      }} />
      {editing !== null && <EditorOverlay refEl={inputRef} editingRefSetter={(cell) => { editingRef.current = cell; setEditing(cell); }} editing={editing} setEditing={setEditing} commit={commitEditing} zoom={view.zoom} store={store} richApiRef={richApiRef} onCharStyleKey={applyCharStyleKey} onRefHighlights={handleRefHighlights} {...(rendererRef.current !== null ? { cellRect: rendererRef.current.getCellViewportRect(editing.r, editing.c) } : {})} />}
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

interface EditorOverlayProps { readonly refEl: RefObject<HTMLTextAreaElement>; readonly editingRefSetter: (cell: EditingCell) => void; readonly editing: EditingCell; readonly setEditing: (cell: EditingCell | null) => void; readonly commit: (value: string, moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection?: boolean, runs?: RichTextRun[]) => void; readonly zoom: number; readonly store: Store; readonly cellRect?: { x: number; y: number; w: number; h: number }; readonly richApiRef: MutableRefObject<RichEditorApi | null>; readonly onCharStyleKey?: (key: 'bold' | 'italic' | 'underline') => void; readonly onRefHighlights?: (ranges: readonly FormulaRefHighlight[] | null) => void }
const EditorOverlay: FC<EditorOverlayProps> = ({ refEl, editingRefSetter, editing, setEditing, commit, zoom, store, cellRect, richApiRef, onCharStyleKey, onRefHighlights }) => {
  const composing = useRef(false);
  const assist = useFormulaAssist();
  const editingValue = editing.value;
  // Excel formula editing: colored boxes over every range the formula references.
  useEffect(() => {
    if (onRefHighlights === undefined) return;
    if (!editingValue.startsWith('=')) { onRefHighlights(null); return; }
    const refs = parseFormulaRefs(editingValue);
    const ranges = refs.map((r, i) => ({ ...r, color: REF_HIGHLIGHT_PALETTE[i % REF_HIGHLIGHT_PALETTE.length]! }));
    onRefHighlights(ranges.length > 0 ? ranges : null);
  }, [editingValue, onRefHighlights]);
  useEffect(() => () => { onRefHighlights?.(null); }, [onRefHighlights]);
  const cellStyle = store.getCell(editing.r, editing.c)?.styleId !== undefined
    ? store.getStyle(store.getCell(editing.r, editing.c)!.styleId!)
    : undefined;
  const wrapping = cellStyle?.wrap === true || editing.value.includes('\n');
  const cell = store.getCell(editing.r, editing.c);
  const initialRuns = editing.richDraft ?? (isRich(cell?.richText) ? cell!.richText! : undefined);
  if (initialRuns !== undefined) {
    // Excel: rich cells edit in place with per-character styling. The DOM is
    // authoritative while typing; runs for the commit come from the editor api.
    const commitRich = (moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection?: boolean): void => {
      const runs = richApiRef.current?.getRuns() ?? [...initialRuns];
      const normalized = normalizeEditorRuns(runs);
      commit(flattenRuns(runs), moveAfter, fillSelection, normalized ?? undefined);
    };
    return <RichEditor
      initialRuns={initialRuns}
      css={editorStyle(store, editing, zoom, cellRect, cellStyle, editing.value)}
      cellStyle={cellStyle}
      initialSelection={editing.richSel}
      editMode={editing.editMode === true}
      onUpgradeEditMode={() => setEditing({ ...editing, editMode: true })}
      registerApi={(api) => { richApiRef.current = api; }}
      commit={commitRich}
      cancel={() => setEditing(null)}
      onValueChange={(value) => editingRefSetter({ ...editing, value })}
      onBlur={() => {
        // Toolbar/menu interaction keeps the draft alive so formatting can land
        // in the selection; any other blur (click-away) commits like the textarea.
        const active = document.activeElement as HTMLElement | null;
        if (active !== null && active.closest('.ss-interaction-toolbar, .ss-menu-bar, .ss-formula-bar, .ant-dropdown, .ant-popover') !== null) return;
        commitRich();
      }}
    />;
  }
  const editorCss = editorStyle(store, editing, zoom, cellRect, cellStyle, editing.value);
  const assistSetValue = (value: string, caret: number): void => {
    setEditing({ ...editing, value });
    requestAnimationFrame(() => { const t = refEl.current; if (t !== null) { t.selectionStart = caret; t.selectionEnd = caret; } });
  };
  const editorTop = typeof editorCss.top === 'number' ? editorCss.top : 0;
  const editorLeft = typeof editorCss.left === 'number' ? editorCss.left : 0;
  const editorHeight = typeof editorCss.height === 'number' ? editorCss.height : 24;
  return <>
    <textarea
      ref={refEl}
      className={`ss-editor-overlay${wrapping ? ' ss-editor-overlay--wrap' : ''}`}
      style={editorCss}
      value={editing.value}
      rows={1}
      spellCheck={false}
      onChange={(e) => { const v = e.target.value; setEditing({ ...editing, value: v }); assist.afterChange(v, e.target.selectionStart ?? v.length); }}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onBlur={() => {
      // Same toolbar/menu guard as the rich editor: formatting from the
      // toolbars must land in the draft, not commit it.
      const active = document.activeElement as HTMLElement | null;
      if (active !== null && active.closest('.ss-interaction-toolbar, .ss-menu-bar, .ss-formula-bar, .ant-dropdown, .ant-popover') !== null) return;
      commit(refEl.current?.value ?? editing.value);
    }}
    onKeyDown={(e) => {
      if (composing.current) return;
      // Formula AutoComplete owns the arrow/Tab/Enter keys while its list is open.
      if (assist.onKeyDown(e.key, refEl.current?.value ?? editing.value, refEl.current?.selectionStart ?? editing.value.length, assistSetValue)) {
        e.preventDefault();
        return;
      }
      // Excel: Ctrl/Cmd+B/I/U while editing formats the selected characters
      // (upgrading the draft to rich runs) instead of doing nothing.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'b' || key === 'i' || key === 'u') {
          e.preventDefault();
          const attr = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline';
          onCharStyleKey?.(attr);
          return;
        }
      }
      // Excel F4: cycle $ anchors on the reference at the caret (A1 → $A$1 → A$1 → $A1).
      if (e.key === 'F4') {
        const el = refEl.current;
        if (el === null) return;
        e.preventDefault();
        const caret = el.selectionStart ?? el.value.length;
        const span = refAtCaret(el.value, caret);
        if (span === undefined) return;
        const cycled = cycleDollars(span.text);
        const next = el.value.slice(0, span.start) + cycled + el.value.slice(span.end);
        setEditing({ ...editing, value: next });
        requestAnimationFrame(() => { el.selectionStart = span.start + cycled.length; el.selectionEnd = span.start + cycled.length; });
        return;
      }
      // Excel point mode: while TYPING a formula that awaits an operand, arrows
      // move the inserted reference instead of committing. In edit mode (F2 /
      // double-click) arrows always move the caret — never insert references.
      const arrowDeltas: Record<string, { dr: number; dc: number }> = { ArrowUp: { dr: -1, dc: 0 }, ArrowDown: { dr: 1, dc: 0 }, ArrowLeft: { dr: 0, dc: -1 }, ArrowRight: { dr: 0, dc: 1 } };
      const arrow = arrowDeltas[e.key];
      if (arrow !== undefined && editing.editMode !== true && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const el = refEl.current;
        const value = el?.value ?? editing.value;
        const caret = el?.selectionStart ?? value.length;
        const head = value.slice(0, caret);
        if (editing.point !== undefined || isPointTrigger(head)) {
          e.preventDefault();
          const base = editing.point ?? { r: editing.r, c: editing.c };
          const target = { r: clampVal(base.r + arrow.dr, 0, TOTAL_ROWS - 1), c: clampVal(base.c + arrow.dc, 0, TOTAL_COLS - 1) };
          const ref = `${num2alpha(target.c)}${target.r + 1}`;
          const nextHead = upsertRef(head, ref, editing.point !== undefined && endsWithRef(head));
          const nextValue = nextHead + value.slice(el?.selectionEnd ?? caret);
          editingRefSetter({ ...editing, value: nextValue, point: target });
          requestAnimationFrame(() => { const t = refEl.current; if (t !== null) { t.selectionStart = nextHead.length; t.selectionEnd = nextHead.length; } });
          return;
        }
      }
      handleEditorKey(e, refEl, (moveAfter, fillSelection) => commit(refEl.current?.value ?? editing.value, moveAfter, fillSelection), () => setEditing(null), (next) => setEditing({ ...editing, value: next }), editing.editMode === true, () => setEditing({ ...editing, value: refEl.current?.value ?? editing.value, editMode: true }));
    }}
    aria-label="Cell editor"
    />
    {assist.signature !== null && (
      <div className="ss-formula-signature" style={{ position: 'absolute', left: editorLeft, top: Math.max(0, editorTop - 34), zIndex: 45 }}>
        <span className="ss-sig-name">{assist.signature.name}</span>
        <span className="ss-sig-text">{assist.signature.sig}</span>
        <div className="ss-sig-desc">{assist.signature.desc} · 第 {assist.signature.argIndex + 1} 个参数</div>
      </div>
    )}
    {assist.suggestions !== null && (
      <ul className="ss-formula-assist" style={{ position: 'absolute', left: editorLeft, top: editorTop + editorHeight + 4, zIndex: 45 }}>
        {assist.suggestions.items.map((name, i) => (
          <li
            key={name}
            className={i === assist.suggestions?.active ? 'ss-active' : undefined}
            onMouseDown={(ev) => {
              ev.preventDefault();
              assist.onKeyDown('Enter', refEl.current?.value ?? editing.value, refEl.current?.selectionStart ?? editing.value.length, assistSetValue);
              refEl.current?.focus();
            }}
          >
            <span className="ss-fn-name">{name}</span>
          </li>
        ))}
      </ul>
    )}
  </>;
};

function useCanvasRenderer(store: Store, selected: Selection | null, onCellClick: (cell: CellAddress, shift: boolean, ctrl: boolean) => void, onSelectionChange: (selection: Selection) => void, view: ViewState, setView: Dispatch<SetStateAction<ViewState>>, cmdManager: CommandManager | undefined, onHeaderContextMenu: (info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => void, onCellContextMenu: (cell: CellAddress, x: number, y: number) => void, onAutoFilterClick: (r: number, c: number, x: number, y: number) => void, onHyperlinkClick: (link: NonNullable<Cell['hyperlink']>) => void, editingLiveRef: RefObject<EditingCell | null>): { canvasRef: RefObject<HTMLCanvasElement>; rendererRef: RefObject<CanvasRenderer | null> } {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const callbacks = useRef({ onCellClick, onSelectionChange, onHeaderContextMenu, onCellContextMenu, onAutoFilterClick, onHyperlinkClick });
  const selectedLiveRef = useRef(selected);
  callbacks.current = { onCellClick, onSelectionChange, onHeaderContextMenu, onCellContextMenu, onAutoFilterClick, onHyperlinkClick };
  selectedLiveRef.current = selected;
  useEffect(() => {
    if (canvasRef.current === null) return undefined;
    const currentSelection = selectedLiveRef.current;
    const base = { canvas: canvasRef.current, store, zoom: view.zoom, showFormula: view.showFormula, showGrid: view.showGrid, frozenRows: view.frozenRows, frozenCols: view.frozenCols, onCellClick: (cell: CellAddress, shift?: boolean, ctrl?: boolean) => flushSync(() => callbacks.current.onCellClick(cell, shift === true, ctrl === true)), onHyperlinkClick: (cell: CellAddress) => { const link = store.getCell(cell.r, cell.c)?.hyperlink; if (link !== undefined) flushSync(() => callbacks.current.onHyperlinkClick(link)); }, onSelectionChange: (range: RangeAddress, active?: CellAddress, anchor?: CellAddress) => flushSync(() => callbacks.current.onSelectionChange(snapRangeSelection(store, rangeSelection(range, anchor ?? selectedLiveRef.current?.anchor, active ?? { r: range.r2, c: range.c2 })))), onColumnSelect: (c: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(columnSelection(c, TOTAL_ROWS, shift && current?.kind === 'column' ? current.anchor.c : c)); }), onRowSelect: (r: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(rowSelection(r, TOTAL_COLS, shift && current?.kind === 'row' ? current.anchor.r : r)); }), onSheetSelect: () => flushSync(() => callbacks.current.onSelectionChange(sheetSelection(allSheetRange()))), onRowResize: (r: number, height: number) => { const cmd = new SetRowHeight({ r, height }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColResize: (c: number, width: number) => { const cmd = new SetColWidth({ c, width }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onRowDblClick: (r: number) => { const fit = autoFitRowHeight(store, r); const cmd = new SetRowHeight({ r, height: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColDblClick: (c: number) => { const fit = autoFitColWidth(store, c); const cmd = new SetColWidth({ c, width: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onFill: (source: RangeAddress, target: RangeAddress, ctrlKey: boolean) => { const cmd = new FillRangeCommand({ ctrlKey, source, target }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onMoveRange: (source: RangeAddress, target: RangeAddress, copy?: boolean) => { const op = makeMoveRange({ source, target, copy }); if (cmdManager !== undefined) cmdManager.execute(op); else op.execute(store); }, onZoom: (delta: number) => setView((current) => ({ ...current, zoom: Math.min(200, Math.max(50, current.zoom + delta)) })), onZoomTo: (zoom: number) => setView((current) => ({ ...current, zoom: Math.min(200, Math.max(50, zoom)) })), onHeaderContextMenu: (info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => callbacks.current.onHeaderContextMenu(info, x, y), onCellContextMenu: (cell: CellAddress, x: number, y: number) => callbacks.current.onCellContextMenu(cell, x, y), onAutoFilterClick: (r: number, c: number, x: number, y: number) => callbacks.current.onAutoFilterClick(r, c, x, y) };
    const renderer = new CanvasRenderer(currentSelection === null ? base : { ...base, selectedRange: currentSelection.range, selectionKind: currentSelection.kind, activeCell: currentSelection.active });
    rendererRef.current = renderer;
    renderer.setEditing(editingLiveRef.current !== null);
    // Container resizes and devicePixelRatio changes (window dragged between
    // monitors) must re-sync the canvas bitmap — nothing else repaints them.
    const repaint = (): void => { renderer.invalidateAll(); };
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(repaint) : null;
    resizeObserver?.observe(canvasRef.current);
    let dprQuery = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`) : null;
    const onDprChange = (): void => {
      repaint();
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`) : null;
      dprQuery?.addEventListener('change', onDprChange);
    };
    dprQuery?.addEventListener('change', onDprChange);
    return () => {
      dprQuery?.removeEventListener('change', onDprChange);
      resizeObserver?.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  // Create the renderer once per store. Zoom / formula / grid toggles flow
  // through setViewOptions below instead of tearing the renderer down (which
  // re-bound every DOM listener and dropped text-metric caches per zoom step).
  }, [store]);
  useEffect(() => rendererRef.current?.setViewOptions({ zoom: view.zoom }), [view.zoom]);
  useEffect(() => rendererRef.current?.setViewOptions({ showFormula: view.showFormula }), [view.showFormula]);
  useEffect(() => rendererRef.current?.setViewOptions({ showGrid: view.showGrid }), [view.showGrid]);
  useEffect(() => rendererRef.current?.setSelection(selected?.range, selected?.kind, selected?.active), [selected]);
  useEffect(() => rendererRef.current?.setFreeze(view.frozenRows, view.frozenCols), [view.frozenRows, view.frozenCols]);
  return { canvasRef, rendererRef };
}

function autoFitColWidth(store: Store, c: number): number {
  let maxLen = 0;
  let hasContent = false;
  for (let r = 0; r < TOTAL_ROWS; r += 1) { const t = store.getCell(r, c)?.text; if (t !== undefined && t.length > 0) { hasContent = true; if (t.length > maxLen) maxLen = t.length; } }
  if (!hasContent) return COL_WIDTH;
  return clampVal(maxLen * 8 + 20, 30, 500);
}

function clampVal(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

function useTheme(theme: Theme | false | undefined): void { useEffect(() => { if (theme === false) return; if (theme === undefined) applyStoredTheme(); else setTheme(theme); dispatchThemeChanged(); }, [theme]); }
function useStoreSheets(store: Store, setSheets: (s: readonly SheetInfo[]) => void, setActive: (id: string) => void): void { useEffect(() => store.subscribe((event) => { if (event.type !== 'sheet') return; setSheets(store.getSheets()); setActive(store.getActiveSheetId()); }), [store, setSheets, setActive]); }
function useStoreVersion(store: Store, bump: () => void): void { useEffect(() => store.subscribe(() => bump()), [store, bump]); }
function useAutoSave(store: Store): void { useEffect(() => { const handle = startAutoSave(store); return () => handle.stop(); }, [store]); }
function useFormulaSync(store: Store, formulaEngine: FormulaEngine | undefined): void { useEffect(() => { if (formulaEngine === undefined) return undefined; return createFormulaSync(store, formulaEngine).unsubscribe; }, [store, formulaEngine]); }
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
/**
 * Keep the formula engine in sync with cell events. While a store batch is
 * flushing (e.g. a sort moved many cells), only registrations update; the
 * dependent-recalculation cascades are deferred until the batch ends so a
 * stale pre-move registration can never overwrite a relocated cell.
 */
export function createFormulaSync(store: Store, engine: FormulaEngine): { readonly unsubscribe: () => void } {
  let syncing = false;
  interface DeferredCell { readonly r: number; readonly c: number; readonly sheetId: string | undefined }
  const deferred = new Map<string, DeferredCell>();
  const unsubscribe = store.subscribe((event) => {
    if (event.type !== 'cell' || syncing) return;
    syncing = true;
    const sheetId = event.sheetId;
    const id = cellId(event.r, event.c);
    if (store.isFlushing()) {
      // Mid-batch states are transient (e.g. rows half-moved by a sort):
      // defer all engine work to batch end so formulas never register
      // against stale edges (false circular refs / clobbered values).
      deferred.set(`${sheetId ?? ''}:${id}`, { r: event.r, c: event.c, sheetId });
    } else {
      syncCellFormula(engine, event.r, event.c, event.cell, sheetId);
      engine.onCellChanged(id, sheetId);
    }
    syncing = false;
  });
  const offBatchEnd = store.onBatchEnd(() => {
    if (deferred.size === 0) return;
    syncing = true;
    const entries = [...deferred.values()];
    deferred.clear();
    // Read the final cell state, not the per-event snapshot.
    const current = entries.map((e) => ({ ...e, cell: store.getCell(e.r, e.c, e.sheetId) }));
    // Removals before registrations: a formula that moved cells must drop its
    // old graph edges before the new position registers, or the stale edge
    // makes the new registration look circular.
    for (const e of current) {
      if (formulaText(e.cell) === undefined) engine.removeFormula(cellId(e.r, e.c), e.sheetId);
    }
    for (const e of current) {
      const formula = formulaText(e.cell);
      if (formula !== undefined) engine.setFormula(cellId(e.r, e.c), formula, formulaDependencies(formula), e.sheetId);
    }
    for (const e of current) engine.onCellChanged(cellId(e.r, e.c), e.sheetId);
    syncing = false;
  });
  return { unsubscribe: () => { unsubscribe(); offBatchEnd(); } };
}

/** Excel Ctrl+End target: bottom-right of the used range (any cell with content). */
function lastUsedCell(store: Store): { readonly r: number; readonly c: number } {
  let maxR = 0;
  let maxC = 0;
  for (const [id, cell] of store.getCells()) {
    if (cell.text === '' && cell.formula === undefined) continue;
    const coords = cellIdCoords(id);
    if (coords === null) continue;
    if (coords.r > maxR) maxR = coords.r;
    if (coords.c > maxC) maxC = coords.c;
  }
  return { r: maxR, c: maxC };
}

/**
 * Excel End mode: pressing End arms it; the next plain arrow edge-jumps (like
 * Ctrl+arrow, Shift extends) and disarms. Any other key just disarms.
 * Returns true when the event was consumed.
 */
function handleEndMode(
  event: ReactKeyboardEvent<HTMLCanvasElement>,
  selected: Selection | null,
  store: Store,
  endModeRef: { current: boolean },
  selectSelection: (selection: Selection) => void,
  selectRange: (range: RangeAddress) => void,
): boolean {
  if (event.key === 'End' && !event.ctrlKey && !event.metaKey) {
    endModeRef.current = true;
    event.preventDefault();
    return true;
  }
  if (!endModeRef.current) return false;
  endModeRef.current = false;
  if (selected === null || event.ctrlKey || event.metaKey) return false;
  const dirs: Record<string, { dr: number; dc: number }> = { ArrowUp: { dr: -1, dc: 0 }, ArrowDown: { dr: 1, dc: 0 }, ArrowLeft: { dr: 0, dc: -1 }, ArrowRight: { dr: 0, dc: 1 } };
  const dir = dirs[event.key];
  if (dir === undefined) return false;
  event.preventDefault();
  const target = edgeJump(store, selected.active, dir.dr, dir.dc, TOTAL_ROWS, TOTAL_COLS);
  if (event.shiftKey) selectSelection(extendSelection(selected, target));
  else selectRange(Range.single(target.r, target.c).toAddress());
  return true;
}

function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>, selected: Selection | null, store: Store, cmdManager: CommandManager | undefined, startEditing: (cell: CellAddress, value?: string, editMode?: boolean) => void, selectSelection: (selection: Selection) => void, selectRange: (range: RangeAddress) => void, setView: Dispatch<SetStateAction<ViewState>>, setFindDialog: (name: DialogName | null) => void, runClipboard: (type: 'cut' | 'copy' | 'paste', range: RangeAddress) => void, clearClipboardSession: () => boolean, execCmd: (cmd: Command) => void, frozenRows = 0, frozenCols = 0, zoom = 100, clearMulti?: () => void, multiRanges?: () => readonly RangeAddress[]): void {
  // Excel: Alt+= inserts an AutoSum formula for the column/row around the active cell.
  if (event.altKey && (event.key === '=' || event.key === '＝')) {
    if (selected === null) return;
    event.preventDefault();
    const active = selected.active;
    startEditing({ r: active.r, c: active.c }, autoSumFormula(store, active.r, active.c), true);
    return;
  }
  if (selected === null || event.altKey) return;
  const range = selected.range;
  const keyboardBase = event.shiftKey ? Range.single(selected.active.r, selected.active.c).toAddress() : range;
  const action = KeyboardHandler.fromReactEvent(event, keyboardBase);
  if (action === null) return;
  event.preventDefault();
  if (action.type === 'move' && action.range !== undefined && (event.key === 'Enter' || event.key === 'Tab') && (range.r1 !== range.r2 || range.c1 !== range.c2) && !isExactlyOneMerge(store, range)) {
    // Excel: Enter/Tab walk the active cell through a multi-cell selection.
    selectSelection(rangeSelection(range, selected.anchor, cycleActive(range, selected.active, event.key, event.shiftKey)));
  }
  else if (action.type === 'move' && action.range !== undefined && event.shiftKey) {
    // Excel: shift+arrow extension also skips hidden rows/columns.
    const { dr, dc } = moveDirection(range, action.range);
    const visible = skipHiddenCells(store, Range.single(selected.active.r, selected.active.c).toAddress(), action.range, dr, dc);
    clearMulti?.();
    selectSelection(snapRangeSelection(store, extendSelection(selected, { r: visible.r1, c: visible.c1 })));
  }
  else if (action.type === 'move' && action.range !== undefined) {
    clearMulti?.();
    const { dr, dc } = moveDirection(range, action.range);
    selectRange(moveArrowTarget(store, range, action.range, dr, dc));
  }
  else if (action.type === 'moveEdge') {
    // Excel Ctrl+arrow: jump to the data-region edge; Shift extends the selection to it.
    const target = edgeJump(store, selected.active, action.dr ?? 0, action.dc ?? 0, TOTAL_ROWS, TOTAL_COLS);
    clearMulti?.();
    if (event.shiftKey) selectSelection(extendSelection(selected, target));
    else selectRange(Range.single(target.r, target.c).toAddress());
  }
  else if (action.type === 'jump') {
    // Ctrl+Home: first unfrozen cell (Excel freeze-aware); Ctrl+End: last used cell.
    clearMulti?.();
    const target = action.jump === 'home' ? { r: frozenRows, c: frozenCols } : lastUsedCell(store);
    if (event.shiftKey) selectSelection(extendSelection(selected, target));
    else selectRange(Range.single(target.r, target.c).toAddress());
  }
  else if (action.type === 'fill' && action.fillDir !== undefined) { const op = fillShortcut(range, action.fillDir); if (op !== undefined) execCmd(op); }
  else if (action.type === 'repeat') {
    // Excel F4: replay the last command against the current selection.
    const last = cmdManager?.getLastExecuted();
    const rebound = last !== undefined ? repeatOnRange(last, range) : undefined;
    if (rebound !== undefined) execCmd(rebound);
  }
  else if (action.type === 'fillSelection') {
    // Excel Ctrl+Enter (no pending edit): re-enter the anchor cell's content across
    // the selection (Excel's active cell stays at the anchor after Shift+arrows/drag).
    const text = cellEditValue(store, selected.anchor);
    const anchorCell = store.getCell(selected.anchor.r, selected.anchor.c);
    applyMatrix(store, cmdManager, range.r1, range.c1, fillSelectionPatches(range, selected.anchor, text, anchorCell?.richText));
  }
  else if (action.type === 'selectColumn') { clearMulti?.(); selectSelection(columnSelection(selected.range.c2, TOTAL_ROWS, selected.range.c1)); }
  else if (action.type === 'selectRow') { clearMulti?.(); selectSelection(rowSelection(selected.range.r2, TOTAL_COLS, selected.range.r1)); }
  else if (action.type === 'edit') startEditing({ r: range.r1, c: range.c1 }, undefined, true);
  else if (action.type === 'page' && action.pageDir !== undefined) {
    // Excel: PageUp/PageDown move one screen (viewport rows at the current zoom).
    const canvas = event.currentTarget;
    const rows = Math.max(1, Math.floor((canvas.clientHeight - COL_HEADER_HEIGHT) / (ROW_HEIGHT * (zoom / 100))));
    clearMulti?.();
    const target = { r: clampVal(selected.active.r + action.pageDir * rows, 0, TOTAL_ROWS - 1), c: selected.active.c };
    if (event.shiftKey) selectSelection(extendSelection(selected, target));
    else selectRange(Range.single(target.r, target.c).toAddress());
  }
  else if (action.type === 'backspace') { clearRange(store, cmdManager, range); startEditing({ r: range.r1, c: range.c1 }, '', true); }
  else if (action.type === 'insertDate') { const now = new Date(); setCellText(store, cmdManager, { r: range.r1, c: range.c1 }, `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`); }
  else if (action.type === 'clear') {
    const extras = multiRanges?.() ?? [];
    if (extras.length === 0) clearRange(store, cmdManager, range);
    else execCmd(new CompositeCommand([clearRangeCmd(range), ...extras.map(clearRangeCmd)]));
  }
  // Excel: Esc cancels the clipboard session but never changes the selection.
  else if (action.type === 'cancel') clearClipboardSession();
  else if (action.type === 'type' && action.text !== undefined) { startEditing({ r: range.r1, c: range.c1 }, action.text); }
  else if (action.type === 'menu' && action.command === 'selectAll') selectSelection(excelSelectAll(store, selected, TOTAL_ROWS, TOTAL_COLS));
  else if (action.type === 'menu' && action.command !== undefined) handleMenuShortcut(action.command, store, cmdManager, range, selectRange, setView, setFindDialog, execCmd);
  else if (action.type === 'copy' || action.type === 'cut' || action.type === 'paste') runClipboard(action.type, range);
}

function handleEditorKey(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  refEl: RefObject<HTMLTextAreaElement>,
  commit: (moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection?: boolean) => void,
  cancel: () => void,
  setValue: (value: string) => void,
  editMode = false,
  upgradeEditMode?: () => void,
): void {
  if (event.key === 'Escape') { cancel(); return; }
  // Excel: F2 while typing upgrades enter mode → edit mode (arrows then move the caret).
  if (event.key === 'F2') { event.preventDefault(); if (!editMode) upgradeEditMode?.(); return; }
  // Excel "enter mode" (typing): arrows commit and move; F2 edit mode moves the caret.
  // While the text is a formula, arrows stay in the editor (formula entry).
  const arrowDeltas: Record<string, { dr: number; dc: number }> = { ArrowUp: { dr: -1, dc: 0 }, ArrowDown: { dr: 1, dc: 0 }, ArrowLeft: { dr: 0, dc: -1 }, ArrowRight: { dr: 0, dc: 1 } };
  const arrow = arrowDeltas[event.key];
  if (!editMode && arrow !== undefined && !event.shiftKey && !event.ctrlKey && !event.metaKey && refEl.current?.value.startsWith('=') !== true) {
    event.preventDefault();
    commit(arrow);
    return;
  }
  // Excel: Tab commits and moves right (Shift+Tab left)
  if (event.key === 'Tab') { event.preventDefault(); commit({ dr: 0, dc: event.shiftKey ? -1 : 1 }); return; }
  // Excel: Ctrl+Enter commits the typed text into every cell of the selection.
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) { event.preventDefault(); commit(undefined, true); return; }
  // Excel: Enter commits and moves down (Shift+Enter up); Alt+Enter inserts a line break
  if (event.key === 'Enter' && !event.altKey) { event.preventDefault(); commit({ dr: event.shiftKey ? -1 : 1, dc: 0 }); return; }
  if (event.key === 'Enter' && event.altKey) {
    event.preventDefault();
    const el = refEl.current;
    if (el === null) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = `${el.value.slice(0, start)}\n${el.value.slice(end)}`;
    setValue(next);
    requestAnimationFrame(() => {
      const pos = start + 1;
      el.selectionStart = pos;
      el.selectionEnd = pos;
    });
  }
}


/** Approximate Excel double-click caret: hit-test along painted lines (incl. wrap / Alt+Enter). */
function caretOffsetAtClick(
  renderer: CanvasRenderer | null,
  store: Store,
  cell: CellAddress,
  clientX: number,
  clientY: number,
  zoom: number,
): number {
  const data = store.getCell(cell.r, cell.c);
  const text = data?.formula ?? data?.text ?? '';
  if (text.length === 0 || renderer === null) return 0;
  const rect = renderer.getCellViewportRect(cell.r, cell.c);
  const canvasEl = document.querySelector('canvas.ss-canvas') as HTMLCanvasElement | null;
  if (canvasEl === null) return text.length;
  const bounds = canvasEl.getBoundingClientRect();
  const style = data?.styleId !== undefined ? store.getStyle(data.styleId) : undefined;
  return caretOffsetFromLocalPoint({
    text,
    localX: clientX - bounds.left - rect.x,
    localY: clientY - bounds.top - rect.y,
    cellW: rect.w,
    cellH: rect.h,
    style,
    value: data?.value,
    formula: data?.formula,
    zoom,
    runs: data?.richText,
  });
}

function editorStyle(
  store: Store,
  cell: CellAddress,
  zoom: number,
  cellRect: { x: number; y: number; w: number; h: number } | undefined,
  style: Style | undefined,
  value: string,
): CSSProperties {
  // Borderless inset 2px so it sits inside the canvas accent strokeRect.
  const inset = 2;
  const scale = zoom / 100;
  const fontSize = Math.max(8, Math.round((style?.fontSize ?? DEFAULT_FONT_SIZE) * scale));
  const fontFamily = style?.fontFamily ?? 'Calibri, "Segoe UI", "Microsoft YaHei", sans-serif';
  const wrapping = style?.wrap === true || value.includes('\n');
  const valign = style?.valign ?? 'middle';
  const editorLineHeight = Math.max(1, Math.round(fontSize * WRAP_LINE_HEIGHT));
  let left: number;
  let top: number;
  let width: number;
  let height: number;
  if (cellRect !== undefined) {
    left = cellRect.x + inset;
    top = cellRect.y + inset;
    width = Math.max(0, cellRect.w - inset * 2);
    height = Math.max(0, cellRect.h - inset * 2);
  } else {
    let x = 0;
    for (let c = 0; c < cell.c; c += 1) x += store.getCol(c)?.width ?? COL_WIDTH;
    let y = 0;
    for (let r = 0; r < cell.r; r += 1) y += store.getRow(r)?.height ?? ROW_HEIGHT;
    const w = store.getCol(cell.c)?.width ?? COL_WIDTH;
    const h = store.getRow(cell.r)?.height ?? ROW_HEIGHT;
    left = ROW_HEADER_WIDTH + x * scale + inset;
    top = COL_HEADER_HEIGHT + y * scale + inset;
    width = Math.max(0, w * scale - inset * 2);
    height = Math.max(0, h * scale - inset * 2);
  }
  const editorContentHeight = wrapping
    ? Math.max(editorLineHeight, wrappedContentHeight(Math.max(1, value.split(/\r?\n/).length), fontSize))
    : editorLineHeight;
  if (wrapping) {
    const lineCount = Math.max(1, value.split(/\r?\n/).length);
    height = Math.max(height, wrappedContentHeight(lineCount, fontSize));
  }
  // Excel: the in-cell editor keeps the cell's indent (left padding for
  // left-aligned text, right padding for right-aligned) instead of the text
  // jumping to the cell edge while editing.
  const editorAlign = resolveCellAlign(style?.align, (() => {
    const live = store.getCell(cell.r, cell.c);
    if (live !== undefined && typeof live.value === 'number') return live.value;
    const n = Number(value);
    return value.trim() !== '' && Number.isFinite(n) && !value.trim().startsWith('=') ? n : value;
  })());
  const indentPx = indentPixels(style, fontSize);
  return {
    left,
    top,
    width,
    height,
    fontSize,
    fontFamily,
    fontWeight: style?.bold === true ? 700 : 400,
    fontStyle: style?.italic === true ? 'italic' : 'normal',
    // Cell-level underline must stay visible inside the editor (spans without
    // an explicit underline override inherit it from here).
    textDecoration: [
      style?.underline === true ? 'underline' : '',
      style?.strike === true ? 'line-through' : '',
    ].filter(Boolean).join(' ') || undefined,
    color: style?.color ?? undefined,
    textAlign: editorAlign,
    lineHeight: `${WRAP_LINE_HEIGHT}`,
    paddingLeft: editorAlign === 'left' ? 3 + indentPx : undefined,
    paddingRight: editorAlign === 'right' ? 3 + indentPx : undefined,
    paddingTop: valign === 'top'
      ? 0
      : valign === 'middle'
        ? Math.max(0, (height - editorContentHeight) / 2)
        : Math.max(0, height - editorContentHeight),
    whiteSpace: wrapping ? 'pre-wrap' : 'nowrap',
    overflow: wrapping ? 'auto' : 'hidden',
    resize: 'none',
  };
}
function setCellText(store: Store, cmdManager: CommandManager | undefined, cell: CellAddress, text: string, runs?: RichTextRun[]): void {
  if (cmdManager === undefined) {
    const next = cellFromText(store.getCell(cell.r, cell.c), text);
    if (runs !== undefined) next.richText = runs;
    store.setCell(cell.r, cell.c, next);
    return;
  }
  const cmd = new SetCellText({ r: cell.r, c: cell.c, text, richText: runs });
  cmdManager.execute.bind(cmdManager)(cmd);
}
function cellEditValue(store: Store, cell: CellAddress): string { const current = store.getCell(cell.r, cell.c); return current?.formula ?? current?.text ?? ''; }
function syncExistingFormulas(store: Store, engine: FormulaEngine): void { const sheetId = store.getActiveSheetId(); store.getCells().forEach(([id, cell]) => { const formula = formulaText(cell); if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula), sheetId); }); }
function syncCellFormula(engine: FormulaEngine, r: number, c: number, cell: Cell | undefined, sheetId?: string): void { const formula = formulaText(cell); const id = cellId(r, c); if (formula === undefined) engine.removeFormula(id, sheetId); else engine.setFormula(id, formula, formulaDependencies(formula), sheetId); }

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
function loadData(store: Store, cmd: CommandManager, formula: FormulaEngine, data: readonly (readonly CellInput[])[]): void { loadValues(cmd, data); syncExistingFormulas(store, formula); }
function loadSheets(store: Store, cmd: CommandManager, formula: FormulaEngine, sheets: readonly SheetInput[]): void { sheets.forEach((sheet, index) => { const id = index === 0 ? store.getActiveSheetId() : store.addSheet(sheet.name); store.renameSheet(id, sheet.name); store.activateSheet(id); loadValues(cmd, sheet.data ?? []); syncExistingFormulas(store, formula); }); const first = store.getSheets()[0]; if (first !== undefined) store.activateSheet(first.id); }
function loadValues(cmd: CommandManager, data: readonly (readonly CellInput[])[]): void { const values = data.map((row) => row.map(normalizeCellInput)); const maxCols = values.reduce((max, row) => Math.max(max, row.length), 0); if (values.length === 0 || maxCols === 0) return; cmd.execute(new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: maxCols - 1, values })); }

/** Excel: rows grow to fit a just-applied font size / wrap. Direct write — see growRowsToContent note in MenuBar. */
function growRowsToContent(store: Store, range: RangeAddress): void {
  for (const { r, height } of autofitRowHeights(store, range)) {
    const meta = store.getRow(r);
    store.setRow(r, { ...meta, height });
  }
}

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
function cycleActive(range: RangeAddress, active: { readonly r: number; readonly c: number }, key: 'Enter' | 'Tab', shiftKey: boolean): { r: number; c: number } {
  let { r, c } = active;
  const d = shiftKey ? -1 : 1;
  if (key === 'Enter') {
    r += d;
    if (r > range.r2) { r = range.r1; c += 1; }
    if (r < range.r1) { r = range.r2; c -= 1; }
    if (c > range.c2) c = range.c1;
    if (c < range.c1) c = range.c2;
  } else {
    c += d;
    if (c > range.c2) { c = range.c1; r += 1; }
    if (c < range.c1) { c = range.c2; r -= 1; }
    if (r > range.r2) r = range.r1;
    if (r < range.r1) r = range.r2;
  }
  return { r, c };
}

/** Excel Alt+=: SUM over the contiguous numbers above the active cell, else to its left. */
function autoSumFormula(store: Store, r: number, c: number): string {
  const numericAt = (rr: number, cc: number): boolean => {
    const cell = store.getCell(rr, cc);
    if (cell === undefined) return false;
    return typeof cell.value === 'number' || (cell.text.trim() !== '' && !Number.isNaN(Number(cell.text)));
  };
  let top = r - 1;
  while (top >= 0 && numericAt(top, c)) top -= 1;
  if (top < r - 1) return `=SUM(${num2alpha(c)}${top + 2}:${num2alpha(c)}${r})`;
  let left = c - 1;
  while (left >= 0 && numericAt(r, left)) left -= 1;
  if (left < c - 1) return `=SUM(${num2alpha(left + 1)}${r + 1}:${num2alpha(c - 1)}${r + 1})`;
  return '=SUM()';
}

function switchSheet(store: Store, delta: 1 | -1): void {
  const sheets = store.getSheets();
  if (sheets.length < 2) return;
  const index = sheets.findIndex((sheet) => sheet.id === store.getActiveSheetId());
  const next = sheets[(index + delta + sheets.length) % sheets.length];
  if (next !== undefined) store.activateSheet(next.id);
}

function handleMenuShortcut(command: MenuShortcutCommand, store: Store, cmdManager: CommandManager | undefined, selected: RangeAddress, selectRange: (range: RangeAddress) => void, setView: Dispatch<SetStateAction<ViewState>>, setFindDialog: (name: DialogName | null) => void, execCmd: (cmd: Command) => void): void {
  const openDialog = (name: DialogName): void => { setFindDialog(null); queueMicrotask(() => setFindDialog(name)); };
  const map: Record<MenuShortcutCommand, () => void> = { save: () => saveToLocal(store), find: () => openDialog('find'), replace: () => openDialog('replace'), selectAll: () => selectRange(allSheetRange()), bold: () => applyShortcutStyle(store, cmdManager, selected, { bold: true }), italic: () => applyShortcutStyle(store, cmdManager, selected, { italic: true }), underline: () => applyShortcutStyle(store, cmdManager, selected, { underline: true }), zoom100: () => setView((current) => ({ ...current, zoom: 100 })), zoomIn: () => setView((current) => ({ ...current, zoom: Math.min(200, current.zoom + 10) })), zoomOut: () => setView((current) => ({ ...current, zoom: Math.max(50, current.zoom - 10) })), undo: () => cmdManager?.undo(), redo: () => cmdManager?.redo(), formatCells: () => openDialog('numberFormat'), nextSheet: () => switchSheet(store, 1), prevSheet: () => switchSheet(store, -1), toggleFilter: () => { const cmd = toggleAutoFilterCommand(store, selected); if (cmd !== null) execCmd(cmd); } };
  map[command]();
}
function applyShortcutStyle(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress, style: Partial<Style>): void {
  // Excel: run-level style keys with a cell editor open + text selection apply
  // to the selected characters of the draft instead of the cells.
  if (editorRunStyleIntercept.current?.(style) === true) return;
  const cmd = new SetRangeStyleCommand({ ...range, style });
  if (cmdManager === undefined) cmd.execute.bind(cmd)(store);
  else cmdManager.execute.bind(cmdManager)(cmd);
}
function applyRangeBorder(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress, preset: BorderPreset, line: BorderLine = 'solid'): void { const cmd = new SetRangeBorderCommand({ ...range, preset, line }); if (cmdManager === undefined) cmd.execute(store); else cmdManager.execute(cmd); }
function saveToLocal(store: Store): void { void saveToDB(DEFAULT_ID, store.serialize()).then(() => message.success('已保存到 IndexedDB')); }
function dispatchThemeChanged(): void { window.dispatchEvent(new CustomEvent('ss:theme-changed')); }
function commitFormulaValue(selected: Selection | null, value: string, store: Store, cmdManager: CommandManager | undefined, runs?: readonly RichTextRun[]): void {
  if (selected === null) return;
  if (store.isSheetProtected()) { message.warning('工作表已保护，无法编辑'); return; }
  const active = selected.active ?? { r: selected.range.r1, c: selected.range.c1 };
  const rule = store.getValidationRule(active.r, active.c);
  if (rule !== undefined) {
    const result = new DataValidationService().validate(value, rule);
    if (!result.valid) { message.warning(result.message ?? '输入值不符合验证规则'); return; }
  }
  if (value.startsWith('=')) {
    setCellText(store, cmdManager, active, value);
    return;
  }
  const normalized = runs !== undefined ? normalizeRuns([...runs]) : undefined;
  setCellText(store, cmdManager, active, value, normalized ?? undefined);
}

/**
 * Excel arrow-key landing: hidden rows/columns are skipped in the step
 * direction (selection stays put when the rest of the grid is hidden), and a
 * merged cell remains one navigation stop — including when the step-out lands
 * on a hidden cell.
 */
function moveArrowTarget(store: Store, current: RangeAddress, target: RangeAddress, dr: number, dc: number): RangeAddress {
  const visible = skipHiddenCells(store, current, target, dr, dc);
  if (sameRange(visible, current)) return current; // nothing visible ahead — Excel stays put
  const merged = resolveArrowTarget(store, current, visible, dr, dc);
  if (sameRange(merged, visible)) return merged;
  const isSingle = merged.r1 === merged.r2 && merged.c1 === merged.c2;
  return isSingle ? skipHiddenCells(store, current, merged, dr, dc) : merged;
}

/** 插入 → 图表: data range is the current selection; the object lands centered over the visible grid (Excel), selected. */
function submitCreateChart(type: ChartType, title: string, store: Store, selected: Selection | null, execCmd: (cmd: Command) => void, renderer: CanvasRenderer | null, selectChart: (id: string) => void): void {
  let sel = selected?.range ?? Range.single(0, 0).toAddress();
  // Excel: a single-cell selection charts the surrounding contiguous data region.
  if (sel.r1 === sel.r2 && sel.c1 === sel.c2) {
    sel = currentRegion(store, { r: sel.r1, c: sel.c1 }, TOTAL_ROWS, TOTAL_COLS) ?? sel;
  }
  const cmd = new CreateChartCommand({
    ...sel,
    type,
    title: title === '' ? undefined : title,
    anchor: renderer !== null ? anchorCenteredInGrid(renderer) : undefined,
  });
  execCmd(cmd);
  selectChart(cmd.chartId);
}

/** 插入 → 图片: anchored at the active cell, default size 4×6 cells, selected. */
function submitCreateImage(src: string, name: string, selected: Selection | null, execCmd: (cmd: Command) => void, selectImage: (id: string) => void): void {
  const active = selected?.active ?? { r: 0, c: 0 };
  const anchor: ChartAnchor = {
    from: { r: active.r, c: active.c, offX: 0, offY: 0 },
    to: { r: Math.min(active.r + 6, TOTAL_ROWS - 1), c: Math.min(active.c + 3, TOTAL_COLS - 1), offX: 0, offY: 0 },
  };
  const cmd = new AddImageCommand({ spec: { id: '', name: name === '' ? '图片' : name, src, anchor } });
  execCmd(cmd);
  selectImage(cmd.imageId);
}

/** Excel inserts a new chart centered on the visible grid with the default 15×7.5cm size. */
function anchorCenteredInGrid(renderer: CanvasRenderer): ChartAnchor {
  const grid = renderer.gridClientRect();
  const w = Math.max(CHART_MIN_W, Math.min(CHART_DEFAULT_W, grid.w - 8));
  const h = Math.max(CHART_MIN_H, Math.min(CHART_DEFAULT_H, grid.h - 8));
  const x = grid.x + Math.max(0, (grid.w - w) / 2);
  const y = grid.y + Math.max(0, (grid.h - h) / 2);
  return normalizeAnchor(renderer.anchorFromRect({ x, y, w, h }), TOTAL_ROWS, TOTAL_COLS);
}

/** 插入 → 迷你图: anchored at the active cell; returns false (dialog stays open) on a bad range. */
function submitInsertSparkline(type: SparklineType, rangeInput: string, store: Store, selected: Selection | null, execCmd: (cmd: Command) => void): boolean {
  const target = parseNameBoxInput(store, rangeInput);
  if (target === null) { message.error('数据范围无效，请输入如 A1:E1 的引用'); return false; }
  const anchor = selected?.active ?? { r: target.range.r1, c: target.range.c1 };
  execCmd(new SetSparklineCommand({ ...target.range, type, targetRow: anchor.r, targetCol: anchor.c }));
  return true;
}

/** Excel name box: jump to an A1 ref / range / defined name, switching sheets when prefixed. */
function jumpNameBox(store: Store, input: string, selectRange: (range: RangeAddress) => void): void {
  const target = parseNameBoxInput(store, input);
  if (target === null) { message.error('引用或名称无效，示例：A1、B2:D5、Sheet2!A1'); return; }
  if (target.sheetId !== null && target.sheetId !== store.getActiveSheetId()) store.activateSheet(target.sheetId);
  selectRange(target.range);
}

/**
 * 隐藏行: hide the clicked span. 取消隐藏 (Excel): restores the hidden rows
 * covered by the header selection — to unhide, select across the collapsed
 * gap (or a wider span) and choose 取消隐藏, exactly like Excel.
 */
function unhideOrHideRows(store: Store, execCmd: (cmd: Command) => void, r: number, count: number, hidden: boolean): void {
  if (hidden) {
    execCmd(new SetRowsHiddenCommand({ r1: r, r2: r + count - 1, hidden: true }));
    return;
  }
  // Excel: 取消隐藏只作用于选区覆盖的隐藏行 — the header selection's address
  // span already includes the collapsed gap, so restore hidden rows inside it.
  let any = false;
  for (let i = r; i < r + count; i += 1) if (store.getRow(i)?.hide === true) { any = true; break; }
  if (!any) { message.info('选区内没有隐藏的行'); return; }
  execCmd(new SetRowsHiddenCommand({ r1: r, r2: r + count - 1, hidden: false }));
}

/** 隐藏列 / 取消隐藏列: same selection-scoped unhide semantics as rows (Excel). */
function unhideOrHideCols(store: Store, execCmd: (cmd: Command) => void, c: number, count: number, hidden: boolean): void {
  if (hidden) {
    execCmd(new SetColsHiddenCommand({ c1: c, c2: c + count - 1, hidden: true }));
    return;
  }
  // Excel: 取消隐藏只作用于选区覆盖的隐藏列（同行语义）。
  let any = false;
  for (let i = c; i < c + count; i += 1) if (store.getCol(i)?.hide === true) { any = true; break; }
  if (!any) { message.info('选区内没有隐藏的列'); return; }
  execCmd(new SetColsHiddenCommand({ c1: c, c2: c + count - 1, hidden: false }));
}


const ProtectionModal: FC<{ readonly open: boolean; readonly onClose: () => void; readonly store: Store }> = ({ open, onClose, store }) => {
  const isProtected = store.isSheetProtected();
  const [form] = Form.useForm<{ password: string }>();
  const submit = (): void => {
    const pwd = form.getFieldValue('password') ?? '';
    if (isProtected) {
      const prot = store.getProtection();
      if (prot !== undefined && prot.protected && !verifyPassword(pwd, prot.passwordHash)) { message.error('密码错误'); return; }
      store.setProtection(unprotectSheet());
      message.success('已取消保护');
    } else {
      store.setProtection(protectSheet(pwd));
      message.success('工作表已保护');
    }
    form.resetFields();
    onClose();
  };
  return <Modal title={isProtected ? '取消保护工作表' : '保护工作表'} open={open} onCancel={onClose} onOk={submit} destroyOnHidden>
    <Form form={form} layout="vertical"><Form.Item name="password" label="密码"><Input.Password placeholder={isProtected ? '输入保护密码' : '设置保护密码'} /></Form.Item></Form>
  </Modal>;
};



const FONT_FAMILIES = [
  'Calibri',
  'Microsoft YaHei',
  'SimSun',
  'Arial',
  'Times New Roman',
  'Consolas',
  'Segoe UI',
] as const;

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72] as const;

const InteractionToolbar: FC<{ readonly selected: Selection | null; readonly store: Store; readonly cmdManager: CommandManager | undefined; readonly view: ViewState; readonly setView: Dispatch<SetStateAction<ViewState>>; readonly selectAll: () => void; readonly painting: boolean; readonly onTogglePainter: () => void; readonly onToggleProtection: () => void }> = ({ selected, store, cmdManager, view, setView, selectAll, painting, onTogglePainter, onToggleProtection }) => {
  const range = selected?.range;
  const current = activeCellStyle(store, selected);
  const style = (next: Partial<Style>): void => { if (range !== undefined) applyShortcutStyle(store, cmdManager, range, next); };
  const setZoom = (zoom: number): void => setView((currentView) => ({ ...currentView, zoom }));
  const fontFamily = current?.fontFamily ?? 'Calibri';
  const fontSize = current?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontColor = current?.color ?? '#000000';
  const fillColor = current?.bgcolor ?? '#FFFFFF';
  const wrapping = current?.wrap === true;
  return <div className="ss-interaction-toolbar" role="toolbar" aria-label="Spreadsheet toolbar"
    // Excel: clicking the toolbar while editing keeps the edit session alive —
    // plain buttons must not steal focus from the cell editor.
    onMouseDown={(e) => { const t = e.target as HTMLElement; if (t.closest('button') !== null && t.closest('.ant-select, .ant-popover, .ant-dropdown, .ant-picker') === null) e.preventDefault(); }}>
    <Space size={4} wrap>
      <Tooltip title="全选"><Button size="small" icon={<SelectOutlined />} aria-label="Select all" onClick={selectAll} /></Tooltip>
      <Tooltip title="清除内容"><Button size="small" icon={<ClearOutlined />} aria-label="Clear contents" onClick={() => { if (range !== undefined) clearRange(store, cmdManager, range); }} /></Tooltip>
      <Divider type="vertical" />
      <Tooltip title={painting ? '退出格式刷' : '格式刷'}><Button size="small" type={painting ? 'primary' : 'default'} icon={<FormatPainterOutlined />} aria-label="Format painter" onClick={onTogglePainter} /></Tooltip>
      <Divider type="vertical" />
      <Select
        size="small"
        aria-label="Font family"
        style={{ width: 120 }}
        value={fontFamily}
        popupMatchSelectWidth={false}
        options={FONT_FAMILIES.map((value) => ({ value, label: value }))}
        onChange={(value) => style({ fontFamily: value })}
      />
      <Select
        size="small"
        aria-label="Font size"
        style={{ width: 64 }}
        value={fontSize}
        popupMatchSelectWidth={false}
        options={FONT_SIZES.map((value) => ({ value, label: String(value) }))}
        onChange={(value) => {
          style({ fontSize: value });
          if (range !== undefined) growRowsToContent(store, range);
        }}
      />
      <Tooltip title="加粗"><Button size="small" type={current?.bold === true ? 'primary' : 'default'} icon={<BoldOutlined />} aria-label="Bold" onClick={() => style({ bold: !(current?.bold === true) })} /></Tooltip>
      <Tooltip title="斜体"><Button size="small" type={current?.italic === true ? 'primary' : 'default'} icon={<ItalicOutlined />} aria-label="Italic" onClick={() => style({ italic: !(current?.italic === true) })} /></Tooltip>
      <Tooltip title="下划线"><Button size="small" type={current?.underline === true ? 'primary' : 'default'} icon={<UnderlineOutlined />} aria-label="Underline" onClick={() => style({ underline: !(current?.underline === true) })} /></Tooltip>
      <Tooltip title="删除线"><Button size="small" type={current?.strike === true ? 'primary' : 'default'} icon={<StrikethroughOutlined />} aria-label="Strikethrough" onClick={() => style({ strike: !(current?.strike === true) })} /></Tooltip>
      <Tooltip title="增加缩进"><Button size="small" aria-label="Increase indent" onClick={() => style({ indent: Math.min(15, (current?.indent ?? 0) + 1) })}>→|</Button></Tooltip>
      <Tooltip title="减少缩进"><Button size="small" aria-label="Decrease indent" onClick={() => style({ indent: Math.max(0, (current?.indent ?? 0) - 1) })}>|←</Button></Tooltip>
      <Tooltip title="增加小数位数"><Button size="small" className="ss-decimal-btn" aria-label="Increase decimal" onClick={() => { const next = adjustDecimalPlaces(current?.numberFormat, 1); if (next !== null) style({ numberFormat: next }); }}>.0→.00</Button></Tooltip>
      <Tooltip title="减少小数位数"><Button size="small" className="ss-decimal-btn" aria-label="Decrease decimal" onClick={() => { const next = adjustDecimalPlaces(current?.numberFormat, -1); if (next !== null) style({ numberFormat: next }); }}>.00→.0</Button></Tooltip>
      <Select
        size="small"
        aria-label="Text rotation"
        placeholder="旋转"
        style={{ width: 72 }}
        value={current?.textRotation ?? 0}
        options={[
          { value: 0, label: '0°' },
          { value: 45, label: '45°' },
          { value: 90, label: '90°' },
          { value: -45, label: '-45°' },
          { value: -90, label: '-90°' },
        ]}
        onChange={(v: number) => style({ textRotation: v })}
      />
      <Tooltip title="字体颜色">
        <ColorPicker
          size="small"
          value={fontColor}
          disabledAlpha
          arrow={false}
          onChange={(value) => style({ color: value.toHexString() })}
        >
          <Button size="small" aria-label="Font color" icon={<FontColorsOutlined />} style={{ color: fontColor }} />
        </ColorPicker>
      </Tooltip>
      <Tooltip title="单元格填充">
        <ColorPicker
          size="small"
          value={fillColor}
          disabledAlpha
          arrow={false}
          onChange={(value) => style({ bgcolor: value.toHexString() })}
        >
          <Button size="small" aria-label="Fill color" icon={<BgColorsOutlined />} style={{ color: fillColor === '#FFFFFF' || fillColor.toLowerCase() === '#fff' ? '#666' : fillColor }} />
        </ColorPicker>
      </Tooltip>
      <Divider type="vertical" />
      <Tooltip title="左对齐"><Button size="small" type={current?.align === 'left' ? 'primary' : 'default'} icon={<AlignLeftOutlined />} aria-label="Align left" onClick={() => style({ align: 'left' })} /></Tooltip>
      <Tooltip title="居中"><Button size="small" type={current?.align === 'center' ? 'primary' : 'default'} icon={<AlignCenterOutlined />} aria-label="Align center" onClick={() => style({ align: 'center' })} /></Tooltip>
      <Tooltip title="右对齐"><Button size="small" type={current?.align === 'right' ? 'primary' : 'default'} icon={<AlignRightOutlined />} aria-label="Align right" onClick={() => style({ align: 'right' })} /></Tooltip>
      <Divider type="vertical" />
      <Tooltip title="顶端对齐"><Button size="small" type={current?.valign === 'top' ? 'primary' : 'default'} icon={<VerticalAlignTopOutlined />} aria-label="Align top" onClick={() => style({ valign: 'top' })} /></Tooltip>
      <Tooltip title="垂直居中"><Button size="small" type={(current?.valign ?? 'middle') === 'middle' ? 'primary' : 'default'} icon={<VerticalAlignMiddleOutlined />} aria-label="Align middle" onClick={() => style({ valign: 'middle' })} /></Tooltip>
      <Tooltip title="底端对齐"><Button size="small" type={current?.valign === 'bottom' ? 'primary' : 'default'} icon={<VerticalAlignBottomOutlined />} aria-label="Align bottom" onClick={() => style({ valign: 'bottom' })} /></Tooltip>
      <Divider type="vertical" />
      <Dropdown.Button
        size="small"
        className="ss-merge-btn"
        type={isSingleMergeSelection(store, range ?? { r1: 0, c1: 0, r2: 0, c2: 0 }) && range !== undefined ? 'primary' : 'default'}
        icon={<DownOutlined />}
        aria-label="合并单元格"
        menu={{
          items: [
            { key: 'center', label: '合并后居中' },
            { key: 'across', label: '跨越合并' },
            { key: 'plain', label: '合并单元格' },
            { key: 'unmerge', label: '取消合并' },
          ],
          onClick: ({ key }) => { if (range !== undefined) mergeSelection(store, cmdManager, range, key as 'center' | 'across' | 'plain' | 'unmerge'); },
        }}
        onClick={() => { if (range !== undefined) mergeSelection(store, cmdManager, range, 'center'); }}
      ><MergeCellsOutlined /> 合并后居中</Dropdown.Button>
      <Divider type="vertical" />
      <Tooltip title="自动换行">
        <Button
          size="small"
          type={wrapping ? 'primary' : 'default'}
          className="ss-wrap-btn"
          aria-label="自动换行"
          aria-pressed={wrapping}
          icon={<ColumnHeightOutlined />}
          onClick={() => {
            const next = !wrapping;
            style({ wrap: next });
            if (next && range !== undefined) growRowsToContent(store, range);
          }}
        >自动换行</Button>
      </Tooltip>
      <Divider type="vertical" />
      <Dropdown trigger={['click']} menu={{
        items: [
          { key: 'all', icon: <TableOutlined />, label: '全部边框' },
          { key: 'outer', icon: <BorderOuterOutlined />, label: '外边框' },
          { key: 'thickOuter', icon: <BorderOuterOutlined />, label: '粗匣边框' },
          { key: 'inner', icon: <BorderInnerOutlined />, label: '内边框' },
          { type: 'divider' },
          { key: 'top', icon: <BorderTopOutlined />, label: '上边框' },
          { key: 'bottom', icon: <BorderBottomOutlined />, label: '下边框' },
          { key: 'left', icon: <BorderLeftOutlined />, label: '左边框' },
          { key: 'right', icon: <BorderRightOutlined />, label: '右边框' },
          { type: 'divider' },
          { key: 'none', icon: <ClearOutlined />, label: '无边框' },
        ],
        onClick: ({ key }) => { if (range === undefined) return; if (key === 'thickOuter') applyRangeBorder(store, cmdManager, range, 'outer', 'thick'); else applyRangeBorder(store, cmdManager, range, key as BorderPreset); },
      }}>
        <Tooltip title="边框"><Button size="small" icon={<TableOutlined />} aria-label="Borders" /></Tooltip>
      </Dropdown>
      <Divider type="vertical" />
      <Tooltip title={store.isSheetProtected() ? '取消保护' : '保护工作表'}><Button size="small" icon={<LockOutlined />} aria-label="Sheet protection" onClick={onToggleProtection} /></Tooltip>
      <Divider type="vertical" />
      <Tooltip title="缩小"><Button size="small" icon={<ZoomOutOutlined />} aria-label="Zoom out" onClick={() => setZoom(Math.max(50, view.zoom - 10))} /></Tooltip>
      <Select size="small" aria-label="Zoom level" value={view.zoom} popupMatchSelectWidth={false} onChange={setZoom} options={[50, 75, 100, 125, 150, 200].map((value) => ({ value, label: `${value}%` }))} />
      <Tooltip title="放大"><Button size="small" icon={<ZoomInOutlined />} aria-label="Zoom in" onClick={() => setZoom(Math.min(200, view.zoom + 10))} /></Tooltip>
      <Divider type="vertical" />
      <span className="ss-toolbar-toggle"><Switch size="small" checked={view.showFormula} onChange={(showFormula) => setView((currentView) => ({ ...currentView, showFormula }))} />公式</span>
      <span className="ss-toolbar-toggle"><Switch size="small" checked={view.showGrid} onChange={(showGrid) => setView((currentView) => ({ ...currentView, showGrid }))} />网格</span>
    </Space>
  </div>;
};

function activeCellStyle(store: Store, selected: Selection | null): Style | undefined {
  const cell = selected?.active;
  if (cell === undefined) return undefined;
  const data = store.getCell(cell.r, cell.c);
  if (data?.styleId === undefined) return undefined;
  return store.getStyle(data.styleId);
}


function applyMoveOrCopySheet(
  store: Store,
  sheetId: string,
  values: { readonly beforeSheetId: string | 'end'; readonly createCopy: boolean },
): void {
  const ids = store.getSheets().map((sh) => sh.id);
  const beforeId = values.beforeSheetId === 'end' ? undefined : values.beforeSheetId;
  if (values.createCopy) {
    if (beforeId === undefined) store.copySheet(sheetId);
    else store.copySheet(sheetId, { beforeSheetId: beforeId });
    return;
  }
  let toIndex: number;
  if (beforeId === undefined) {
    toIndex = ids.length - 1;
  } else {
    const at = ids.indexOf(beforeId);
    toIndex = at < 0 ? ids.length - 1 : at;
    const from = ids.indexOf(sheetId);
    if (from >= 0 && from < toIndex) toIndex -= 1;
  }
  store.moveSheet(sheetId, toIndex);
  store.activateSheet(sheetId);
}
