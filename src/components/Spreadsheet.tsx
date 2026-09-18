import { Button, ColorPicker, Divider, Dropdown, Form, Input, Modal, Select, Space, Switch, Tooltip, message } from 'antd';
import { DownOutlined, AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BgColorsOutlined, BoldOutlined, BorderBottomOutlined, BorderInnerOutlined, BorderLeftOutlined, BorderOuterOutlined, BorderRightOutlined, BorderTopOutlined, ClearOutlined, ColumnHeightOutlined, FontColorsOutlined, FormatPainterOutlined, ItalicOutlined, LockOutlined, SelectOutlined, UnderlineOutlined, ZoomInOutlined, ZoomOutOutlined, TableOutlined, VerticalAlignTopOutlined, VerticalAlignMiddleOutlined, VerticalAlignBottomOutlined, MergeCellsOutlined } from '@ant-design/icons';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type FC, type KeyboardEvent as ReactKeyboardEvent, type RefObject, type SetStateAction } from 'react';
import { applyMatrix, clearRange, clearRangeCmd, CompositeCommand } from '../util/rangeValues';
import { fillSelectionPatches } from '../fill/fillSelection';
import { repeatOnRange } from '../commands/repeat';
import { useMultiSelection } from './hooks/useMultiSelection';
import { useClipboardSession } from './hooks/useClipboardSession';
import type { Command } from '../commands/Command';
import type { DialogName } from './menu/types';
import { CommandManager } from '../commands/CommandManager';
import { SetCellText } from '../commands/impl/SetCellText';
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
import { CanvasRenderer, COL_HEADER_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, TOTAL_COLS, TOTAL_ROWS, type CellAddress } from '../renderer/CanvasRenderer';
import { FillRangeCommand } from '../commands/impl/FillRange';
import { CreateChartCommand } from '../commands/impl/CreateChart';
import { RemoveChartCommand } from '../commands/impl/RemoveChart';
import { SetChartAnchorCommand } from '../commands/impl/SetChartAnchor';
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
import { FormulaBar } from './FormulaBar';
import { MenuBar, allSheetRange } from './menu/MenuBar';
import { excelSelectAll, edgeJump, currentRegion } from '../selection/currentRegion';
import { parseNameBoxInput } from '../selection/nameBox';
import { toggleAutoFilterCommand } from '../filter/toggleFilter';
import { FloatingChart } from '../charts/FloatingChart';
import { CHART_DEFAULT_H, CHART_DEFAULT_W, CHART_MIN_H, CHART_MIN_W, type ChartAnchor, type ChartType } from '../charts/types';
import { normalizeAnchor } from '../charts/geometry';
import type { SparklineType } from '../sparkline/types';
import { FilterDropdown } from './FilterDropdown';
import { startAutoSave } from '../db/autoSave';
import { loadWorkbook, DEFAULT_ID, saveWorkbook as saveToDB } from '../db/WorkbookDB';
import type { Cell, Style } from '../types';
import { WRAP_LINE_HEIGHT, wrappedContentHeight } from '../util/wrapText';
import { autoFitRowHeight, autofitRowHeights } from '../util/rowAutofit';
import { fillShortcut } from '../fill/fillShortcut';
import { cycleDollars, endsWithRef, isPointTrigger, refAtCaret, upsertRef } from '../formula/pointMode';

export { snapshotCells, buildSessionPasteValues, tilePlainCells, combineMultiRanges } from '../clipboard/session';
export type { ClipboardSessionState } from '../clipboard/session';
export type CellInput = CellDataInput;
export interface SheetInput { readonly id?: string; readonly name: string; readonly data?: readonly (readonly CellInput[])[] }
export interface SpreadsheetOptions { readonly data?: readonly (readonly CellInput[])[]; readonly sheets?: readonly SheetInput[]; readonly theme?: Theme | false }
export interface SpreadsheetProps { readonly store: Store; readonly cmdManager?: CommandManager; readonly formulaEngine?: FormulaEngine; readonly theme?: Theme | false | undefined; readonly onClose?: () => void }
interface EditingCell extends CellAddress { readonly value: string; /** Excel: F2/double-click = edit mode (arrows move the caret); typing = enter mode (arrows commit). */ readonly editMode?: boolean; /** Excel point mode: the cell the formula's trailing reference currently points at. */ readonly point?: CellAddress }
interface ViewState { readonly zoom: number; readonly showFormula: boolean; readonly showGrid: boolean; readonly frozenRows: number; readonly frozenCols: number }
interface FilterPopupState { readonly r: number; readonly c: number; readonly x: number; readonly y: number }
type SpreadsheetContextMenu =
  | { readonly kind: 'cell'; readonly x: number; readonly y: number }
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
  const [storeVersion, setStoreVersion] = useState(0);
  const [formulaValue, setFormulaValue] = useState('');
  const [painting, setPainting] = useState(false);
  const [sourceStyle, setSourceStyle] = useState<Style | undefined>(undefined);
  const [filterPopup, setFilterPopup] = useState<FilterPopupState | null>(null);
  /** Selected floating chart object (Excel: charts are selectable drawing objects). */
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const editingRef = useRef<EditingCell | null>(editing);
  editingRef.current = editing;
  const { multiRef, rendererApiRef, setMulti } = useMultiSelection();

  const selectSelection = useCallback((next: Selection) => {
    selectedRef.current = next;
    setSelected(next);
    setEditing(null);
    // Excel: selecting a cell deselects any selected floating object.
    setSelectedChartId(null);
  }, []);
  const selectRange = useCallback((range: RangeAddress) => selectSelection(rangeSelection(range)), [selectSelection]);
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
      const value = el?.value ?? ed.value;
      const caret = el?.selectionStart ?? value.length;
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
      commitEditingRef.current?.(value);
    }
    if (ctrl && !shift) {
      // Excel Ctrl+click: keep the existing selection as an extra range, activate the new cell.
      const current = selectedRef.current;
      setMulti([...multiRef.current, ...(current !== null ? [current.range] : [])]);
      selectSelection(snapClickSelection(store, cell.r, cell.c));
      return;
    }
    if (!ctrl) setMulti([]);
    // Excel: clicking a merged cell selects the whole merge; shift-extend snaps to merge edges.
    selectSelection(shift && selectedRef.current ? snapRangeSelection(store, extendSelection(selectedRef.current, cell)) : snapClickSelection(store, cell.r, cell.c));
  }, [painting, sourceStyle, selectSelection, cmdManager, store, setMulti]);
  const commitEditingRef = useRef<((value: string) => void) | null>(null);
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
      setCtxMenu({ kind: 'cell', x, y });
      return;
    }
    flushSync(() => selectSelection(cellSelection(cell.r, cell.c)));
    setCtxMenu({ kind: 'cell', x, y });
  }, [selectSelection]);
  const execCmd = useCallback((cmd: Command) => {
    if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store);
  }, [cmdManager, store]);
  const { canvasRef, rendererRef } = useCanvasRenderer(store, selected, onCellClick, selectSelection, view, setView, cmdManager, onHeaderContextMenu, onCellContextMenu, onAutoFilterClick);
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
  const startEditing = (cell: CellAddress, value?: string, editMode = false): void => {
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
    setEditing({ ...anchor, value: editValue, editMode });
  };
  const commitEditing = (value: string, moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection = false): void => {
    const ed = editingRef.current;
    // Guarded by the ref so a blur right after a click-commit never double-writes.
    editingRef.current = null;
    if (ed !== null) {
      if (store.isSheetProtected()) { message.warning('工作表已保护，无法编辑'); setEditing(null); return; }
      const rule = store.getValidationRule(ed.r, ed.c);
      if (rule !== undefined) {
        const svc = new DataValidationService();
        const result = svc.validate(value, rule);
        if (!result.valid) { message.warning(result.message ?? '输入值不符合验证规则'); }
      }
      const selRange = fillSelection ? selectedRef.current?.range : undefined;
      const fillAll = selRange !== undefined && (selRange.r1 !== selRange.r2 || selRange.c1 !== selRange.c2);
      if (fillAll && selRange !== undefined) {
        applyMatrix(store, cmdManager, selRange.r1, selRange.c1, fillSelectionPatches(selRange, ed, value));
      } else {
        setCellText(store, cmdManager, ed, value);
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
    setEditing(null);
  };
  commitEditingRef.current = (value: string) => commitEditing(value);

  useTheme(theme);
  useFormulaSync(store, formulaEngine);
  useStoreSheets(store, setSheets, setActiveSheetId);
  useStoreVersion(store, () => setStoreVersion((value) => value + 1));
  useFormulaValue(selected, editing, store, storeVersion, setFormulaValue);
  useAutoSave(store);
  useEffect(() => inputRef.current?.focus(), [editing]);
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
    <MenuBar {...menuBarProps(store, cmdManager, selected, selectRange, () => selectSelection(sheetSelection(allSheetRange())), onClose)} view={{ ...view, setZoom: (zoom) => setView((current) => ({ ...current, zoom })), setShowFormula: (showFormula) => setView((current) => ({ ...current, showFormula })), setShowGrid: (showGrid) => setView((current) => ({ ...current, showGrid })), setFreeze: (frozenRows, frozenCols) => setView((current) => ({ ...current, frozenRows, frozenCols })) }} onFindNavigate={(match) => { if (match.sheetId !== store.getActiveSheetId()) store.activateSheet(match.sheetId); selectSelection(cellSelection(match.r, match.c)); }} onFindHighlight={(matches, current) => setFindHighlights(matches.length === 0 ? null : { matches, current })} openDialogKey={findDialogOpen} onCreateChart={(type, title) => submitCreateChart(type, title, store, selected, execCmd, rendererRef.current, setSelectedChartId)} onInsertSparkline={(type, rangeInput) => submitInsertSparkline(type, rangeInput, store, selected, execCmd)} />
    <InteractionToolbar selected={selected} store={store} cmdManager={cmdManager} view={view} setView={setView} selectAll={() => selectSelection(sheetSelection(allSheetRange()))} painting={painting} onTogglePainter={() => { if (painting) { setPainting(false); setSourceStyle(undefined); } else { const cell = selected?.active; const s = cell === undefined ? undefined : store.getCell(cell.r, cell.c)?.styleId === undefined ? undefined : store.getStyle(store.getCell(cell.r, cell.c)!.styleId!); setSourceStyle(s); setPainting(true); } }} onToggleProtection={() => setProtectOpen(true)} />
    <ProtectionModal open={protectOpen} onClose={() => setProtectOpen(false)} store={store} />
    <FormulaBar selected={selected} value={formulaValue} onChange={setFormulaValue} onCommit={() => commitFormulaValue(selected, formulaValue, store, cmdManager)} onGoTo={(input) => jumpNameBox(store, input, selectRange)} />
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
      }} onDoubleClick={(e) => { const cell = rendererRef.current?.cellAtPoint(e.clientX, e.clientY); if (cell != null) startEditing(cell, undefined, true); }} />
      {editing !== null && <EditorOverlay refEl={inputRef} editingRefSetter={(cell) => { editingRef.current = cell; setEditing(cell); }} editing={editing} setEditing={setEditing} commit={commitEditing} zoom={view.zoom} store={store} {...(rendererRef.current !== null ? { cellRect: rendererRef.current.getCellViewportRect(editing.r, editing.c) } : {})} />}
      <div className="ss-chart-layer">{store.getCharts().map((spec) => <FloatingChart key={spec.id} spec={spec} store={store} renderer={rendererRef.current} selected={selectedChartId === spec.id} onSelect={setSelectedChartId} onGeometry={(id, anchor) => execCmd(new SetChartAnchorCommand({ id, anchor }))} onRemove={(id) => { execCmd(new RemoveChartCommand({ id })); setSelectedChartId((current) => current === id ? null : current); canvasRef.current?.focus(); }} onUndo={() => cmdManager?.undo()} onRedo={() => cmdManager?.redo()} />)}</div></div>
      <PasteSpecialDialog open={pasteSpecialOpen} onOk={(opts) => void applyPasteSpecial(opts)} onCancel={() => setPasteSpecialOpen(false)} />
      {filterPopup !== null && <FilterDropdown store={store} cmdManagerExecutor={execCmd} r={filterPopup.r} c={filterPopup.c} x={filterPopup.x} y={filterPopup.y} onClose={() => setFilterPopup(null)} />}
    <StatusBar store={store} selected={selected?.range ?? null} zoom={view.zoom} />
    <BottomBar sheets={sheets} activeSheetId={activeSheetId} onSheetChange={(id) => { setMulti([]); store.activateSheet(id); }} onAddSheet={() => addSheet(store)} onRenameSheet={(id) => renameSheet(store, id)} onDeleteSheet={(id) => deleteSheet(store, id)} />
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
      this.cmdManager.clear();
    } catch (err) {
      console.error('Failed to restore workbook from IndexedDB:', err);
    }
  }
}

interface EditorOverlayProps { readonly refEl: RefObject<HTMLTextAreaElement>; readonly editingRefSetter: (cell: EditingCell) => void; readonly editing: EditingCell; readonly setEditing: (cell: EditingCell | null) => void; readonly commit: (value: string, moveAfter?: { readonly dr: number; readonly dc: number }, fillSelection?: boolean) => void; readonly zoom: number; readonly store: Store; readonly cellRect?: { x: number; y: number; w: number; h: number } }
const EditorOverlay: FC<EditorOverlayProps> = ({ refEl, editingRefSetter, editing, setEditing, commit, zoom, store, cellRect }) => {
  const composing = useRef(false);
  const cellStyle = store.getCell(editing.r, editing.c)?.styleId !== undefined
    ? store.getStyle(store.getCell(editing.r, editing.c)!.styleId!)
    : undefined;
  const wrapping = cellStyle?.wrap === true || editing.value.includes('\n');
  return <textarea
    ref={refEl}
    className={`ss-editor-overlay${wrapping ? ' ss-editor-overlay--wrap' : ''}`}
    style={editorStyle(store, editing, zoom, cellRect, cellStyle, editing.value)}
    value={editing.value}
    rows={1}
    spellCheck={false}
    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onBlur={() => commit(refEl.current?.value ?? editing.value)}
    onKeyDown={(e) => {
      if (composing.current) return;
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
      // Excel point mode: while a formula awaits an operand, arrows move the
      // inserted reference instead of committing.
      const arrowDeltas: Record<string, { dr: number; dc: number }> = { ArrowUp: { dr: -1, dc: 0 }, ArrowDown: { dr: 1, dc: 0 }, ArrowLeft: { dr: 0, dc: -1 }, ArrowRight: { dr: 0, dc: 1 } };
      const arrow = arrowDeltas[e.key];
      if (arrow !== undefined && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
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
      handleEditorKey(e, refEl, (moveAfter, fillSelection) => commit(refEl.current?.value ?? editing.value, moveAfter, fillSelection), () => setEditing(null), (next) => setEditing({ ...editing, value: next }), editing.editMode === true);
    }}
    aria-label="Cell editor"
  />;
};

function useCanvasRenderer(store: Store, selected: Selection | null, onCellClick: (cell: CellAddress, shift: boolean, ctrl: boolean) => void, onSelectionChange: (selection: Selection) => void, view: ViewState, setView: Dispatch<SetStateAction<ViewState>>, cmdManager: CommandManager | undefined, onHeaderContextMenu: (info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => void, onCellContextMenu: (cell: CellAddress, x: number, y: number) => void, onAutoFilterClick: (r: number, c: number, x: number, y: number) => void): { canvasRef: RefObject<HTMLCanvasElement>; rendererRef: RefObject<CanvasRenderer | null> } {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const callbacks = useRef({ onCellClick, onSelectionChange, onHeaderContextMenu, onCellContextMenu, onAutoFilterClick });
  const selectedLiveRef = useRef(selected);
  callbacks.current = { onCellClick, onSelectionChange, onHeaderContextMenu, onCellContextMenu, onAutoFilterClick };
  selectedLiveRef.current = selected;
  useEffect(() => {
    if (canvasRef.current === null) return undefined;
    const currentSelection = selectedLiveRef.current;
    const base = { canvas: canvasRef.current, store, zoom: view.zoom, showFormula: view.showFormula, showGrid: view.showGrid, frozenRows: view.frozenRows, frozenCols: view.frozenCols, onCellClick: (cell: CellAddress, shift?: boolean, ctrl?: boolean) => flushSync(() => callbacks.current.onCellClick(cell, shift === true, ctrl === true)), onSelectionChange: (range: RangeAddress, active?: CellAddress, anchor?: CellAddress) => flushSync(() => callbacks.current.onSelectionChange(snapRangeSelection(store, rangeSelection(range, anchor ?? selectedLiveRef.current?.anchor, active ?? { r: range.r2, c: range.c2 })))), onColumnSelect: (c: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(columnSelection(c, TOTAL_ROWS, shift && current?.kind === 'column' ? current.anchor.c : c)); }), onRowSelect: (r: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(rowSelection(r, TOTAL_COLS, shift && current?.kind === 'row' ? current.anchor.r : r)); }), onSheetSelect: () => flushSync(() => callbacks.current.onSelectionChange(sheetSelection(allSheetRange()))), onRowResize: (r: number, height: number) => { const cmd = new SetRowHeight({ r, height }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColResize: (c: number, width: number) => { const cmd = new SetColWidth({ c, width }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onRowDblClick: (r: number) => { const fit = autoFitRowHeight(store, r); const cmd = new SetRowHeight({ r, height: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColDblClick: (c: number) => { const fit = autoFitColWidth(store, c); const cmd = new SetColWidth({ c, width: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onFill: (source: RangeAddress, target: RangeAddress, ctrlKey: boolean) => { const cmd = new FillRangeCommand({ ctrlKey, source, target }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onMoveRange: (source: RangeAddress, target: RangeAddress, copy?: boolean) => { const op = makeMoveRange({ source, target, copy }); if (cmdManager !== undefined) cmdManager.execute(op); else op.execute(store); }, onZoom: (delta: number) => setView((current) => ({ ...current, zoom: Math.min(200, Math.max(50, current.zoom + delta)) })), onHeaderContextMenu: (info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => callbacks.current.onHeaderContextMenu(info, x, y), onCellContextMenu: (cell: CellAddress, x: number, y: number) => callbacks.current.onCellContextMenu(cell, x, y), onAutoFilterClick: (r: number, c: number, x: number, y: number) => callbacks.current.onAutoFilterClick(r, c, x, y) };
    const renderer = new CanvasRenderer(currentSelection === null ? base : { ...base, selectedRange: currentSelection.range, selectionKind: currentSelection.kind, activeCell: currentSelection.active });
    rendererRef.current = renderer;
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
  }, [store, view.zoom, view.showFormula, view.showGrid]);
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
    const { r1, c1 } = selected.range;
    if (editing !== null && editing.r === r1 && editing.c === c1) {
      setFormulaValue(editing.value);
      return;
    }
    const cell = store.getCell(r1, c1);
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
  const deferred = new Map<string, string | undefined>();
  const unsubscribe = store.subscribe((event) => {
    if (event.type !== 'cell' || syncing) return;
    syncing = true;
    const sheetId = event.sheetId;
    const id = cellId(event.r, event.c);
    syncCellFormula(engine, event.r, event.c, event.cell, sheetId);
    if (store.isFlushing()) deferred.set(`${sheetId ?? ''}:${id}`, sheetId);
    else engine.onCellChanged(id, sheetId);
    syncing = false;
  });
  const offBatchEnd = store.onBatchEnd(() => {
    const entries = [...deferred.entries()];
    deferred.clear();
    entries.forEach(([key, sheetId]) => engine.onCellChanged(key.slice(key.indexOf(':') + 1), sheetId));
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
    applyMatrix(store, cmdManager, range.r1, range.c1, fillSelectionPatches(range, selected.anchor, text));
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
): void {
  if (event.key === 'Escape') { cancel(); return; }
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
  const fontSize = Math.max(8, Math.round((style?.fontSize ?? 11) * scale));
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
  return {
    left,
    top,
    width,
    height,
    fontSize,
    fontFamily,
    fontWeight: style?.bold === true ? 700 : 400,
    fontStyle: style?.italic === true ? 'italic' : 'normal',
    color: style?.color ?? undefined,
    textAlign: style?.align ?? 'left',
    lineHeight: `${WRAP_LINE_HEIGHT}`,
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
function setCellText(store: Store, cmdManager: CommandManager | undefined, cell: CellAddress, text: string): void { if (cmdManager === undefined) store.setCell(cell.r, cell.c, cellFromText(store.getCell(cell.r, cell.c), text)); else cmdManager.execute(new SetCellText({ r: cell.r, c: cell.c, text })); }
function cellEditValue(store: Store, cell: CellAddress): string { const current = store.getCell(cell.r, cell.c); return current?.formula ?? current?.text ?? ''; }
function syncExistingFormulas(store: Store, engine: FormulaEngine): void { const sheetId = store.getActiveSheetId(); store.getCells().forEach(([id, cell]) => { const formula = formulaText(cell); if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula), sheetId); }); }
function syncCellFormula(engine: FormulaEngine, r: number, c: number, cell: Cell | undefined, sheetId?: string): void { const formula = formulaText(cell); const id = cellId(r, c); if (formula === undefined) engine.removeFormula(id, sheetId); else engine.setFormula(id, formula, formulaDependencies(formula), sheetId); }

function addSheet(store: Store): void { const name = window.prompt('Sheet name', `Sheet${store.getSheets().length + 1}`); if (name !== null) store.addSheet(name); }
function renameSheet(store: Store, id: string): void { const current = store.getSheets().find((s) => s.id === id)?.name ?? ''; const name = window.prompt('Rename sheet', current); if (name !== null) store.renameSheet(id, name); }
function deleteSheet(store: Store, id: string): void { if (window.confirm('Delete this sheet?')) store.deleteSheet(id); }
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

function menuBarProps(store: Store, cmdManager: CommandManager | undefined, selected: Selection | null, selectRange: (range: RangeAddress) => void, allRange: () => void, onClose: (() => void) | undefined): React.ComponentProps<typeof MenuBar> {
  const range = selected?.range ?? null;
  const activeCell = selected?.active ?? null;
  const props = { store, selected: range, activeCell, selectRange, clearRange: () => { if (range !== null) clearRange(store, cmdManager, range); }, allRange };
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
  const map: Record<MenuShortcutCommand, () => void> = { save: () => saveToLocal(store), find: () => setFindDialog('find'), replace: () => setFindDialog('replace'), selectAll: () => selectRange(allSheetRange()), bold: () => applyShortcutStyle(store, cmdManager, selected, { bold: true }), italic: () => applyShortcutStyle(store, cmdManager, selected, { italic: true }), underline: () => applyShortcutStyle(store, cmdManager, selected, { underline: true }), zoom100: () => setView((current) => ({ ...current, zoom: 100 })), zoomIn: () => setView((current) => ({ ...current, zoom: Math.min(200, current.zoom + 10) })), zoomOut: () => setView((current) => ({ ...current, zoom: Math.max(50, current.zoom - 10) })), undo: () => cmdManager?.undo(), redo: () => cmdManager?.redo(), formatCells: () => setFindDialog('numberFormat'), nextSheet: () => switchSheet(store, 1), prevSheet: () => switchSheet(store, -1), toggleFilter: () => { const cmd = toggleAutoFilterCommand(store, selected); if (cmd !== null) execCmd(cmd); } };
  map[command]();
}
function applyShortcutStyle(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress, style: Partial<Style>): void { const cmd = new SetRangeStyleCommand({ ...range, style }); if (cmdManager === undefined) cmd.execute(store); else cmdManager.execute(cmd); }
function applyRangeBorder(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress, preset: BorderPreset, line: BorderLine = 'solid'): void { const cmd = new SetRangeBorderCommand({ ...range, preset, line }); if (cmdManager === undefined) cmd.execute(store); else cmdManager.execute(cmd); }
function saveToLocal(store: Store): void { void saveToDB(DEFAULT_ID, store.serialize()).then(() => message.success('已保存到 IndexedDB')); }
function dispatchThemeChanged(): void { window.dispatchEvent(new CustomEvent('ss:theme-changed')); }
function commitFormulaValue(selected: Selection | null, value: string, store: Store, cmdManager: CommandManager | undefined): void {
  if (selected === null) return;
  setCellText(store, cmdManager, { r: selected.range.r1, c: selected.range.c1 }, value);
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
  const fontSize = current?.fontSize ?? 11;
  const fontColor = current?.color ?? '#000000';
  const fillColor = current?.bgcolor ?? '#FFFFFF';
  const wrapping = current?.wrap === true;
  return <div className="ss-interaction-toolbar" role="toolbar" aria-label="Spreadsheet toolbar">
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
