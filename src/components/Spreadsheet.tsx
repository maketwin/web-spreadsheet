import { Button, ColorPicker, Divider, Dropdown, Form, Input, Modal, Select, Space, Switch, Tooltip, message } from 'antd';
import { AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BgColorsOutlined, BoldOutlined, BorderBottomOutlined, BorderInnerOutlined, BorderLeftOutlined, BorderOuterOutlined, BorderOutlined, BorderRightOutlined, BorderTopOutlined, ClearOutlined, ColumnHeightOutlined, FontColorsOutlined, FormatPainterOutlined, ItalicOutlined, LockOutlined, SelectOutlined, UnderlineOutlined, ZoomInOutlined, ZoomOutOutlined, TableOutlined } from '@ant-design/icons';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type FC, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { ClipboardService } from '../clipboard/ClipboardService';
import type { Command } from '../commands/Command';
import type { DialogName } from './menu/types';
import { CommandManager } from '../commands/CommandManager';
import { SetCellText } from '../commands/impl/SetCellText';
import { SetRangeStyleCommand } from '../commands/impl/SetRangeStyle';
import { SetRangeBorderCommand, type BorderPreset, type BorderLine } from '../commands/impl/SetRangeBorder';
import { SetRangeValues } from '../commands/impl/SetRangeValues';
import { EventBus } from '../events/EventBus';
import { FormulaEngine } from '../formula/FormulaEngine';
import { KeyboardHandler, type MenuShortcutCommand } from '../keys/KeyboardHandler';
import { PluginManager, type Plugin } from '../plugin/PluginManager';
import { CanvasRenderer, COL_HEADER_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, TOTAL_COLS, TOTAL_ROWS, type CellAddress } from '../renderer/CanvasRenderer';
import { FillRangeCommand } from '../commands/impl/FillRange';
import { MoveRange } from '../commands/impl/MoveRange';
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
import { cellFromText, cellId, formulaDependencies, formulaText, normalizeCellInput, type CellInput as CellDataInput } from '../util/cell';
import { cellSelection, columnSelection, extendSelection, rangeSelection, rowSelection, sheetSelection, type Selection } from '../selection/Selection';
import { CellContextMenu, HeaderContextMenu } from './ContextMenu';
import { BottomBar } from './BottomBar';
import { ErrorBoundary } from './ErrorBoundary';
import { StatusBar } from './StatusBar';
import { FormulaBar } from './FormulaBar';
import { MenuBar, allSheetRange } from './menu/MenuBar';
import { startAutoSave } from '../db/autoSave';
import { loadWorkbook, DEFAULT_ID, saveWorkbook as saveToDB } from '../db/WorkbookDB';
import type { Cell, StoreEvent, Style } from '../types';
import { WRAP_LINE_HEIGHT, wrappedContentHeight } from '../util/wrapText';
import { autoFitRowHeight, autofitRowsForSelection } from '../util/rowAutofit';

export type CellInput = CellDataInput;
export interface SheetInput { readonly id?: string; readonly name: string; readonly data?: readonly (readonly CellInput[])[] }
export interface SpreadsheetOptions { readonly data?: readonly (readonly CellInput[])[]; readonly sheets?: readonly SheetInput[]; readonly theme?: Theme | false }
export interface SpreadsheetProps { readonly store: Store; readonly cmdManager?: CommandManager; readonly formulaEngine?: FormulaEngine; readonly theme?: Theme | false | undefined; readonly onClose?: () => void }
interface EditingCell extends CellAddress { readonly value: string }
interface ViewState { readonly zoom: number; readonly showFormula: boolean; readonly showGrid: boolean; readonly frozenRows: number; readonly frozenCols: number }
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const selectSelection = useCallback((next: Selection) => {
    selectedRef.current = next;
    setSelected(next);
    setEditing(null);
  }, []);
  const selectRange = useCallback((range: RangeAddress) => selectSelection(rangeSelection(range)), [selectSelection]);
  const onCellClick = useCallback((cell: CellAddress, shift: boolean) => {
    if (painting && sourceStyle !== undefined) {
      const range = Range.single(cell.r, cell.c).toAddress();
      const cmd = new SetRangeStyleCommand({ ...range, style: sourceStyle });
      if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store);
      setPainting(false);
      setSourceStyle(undefined);
      return;
    }
    selectSelection(shift && selectedRef.current ? extendSelection(selectedRef.current, cell) : cellSelection(cell.r, cell.c));
  }, [painting, sourceStyle, selectSelection, cmdManager, store]);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
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
  const runCtxClipboard = useCallback((type: 'cut' | 'copy' | 'paste' | 'clear') => {
    const range = selectedRef.current?.range;
    if (range === undefined) return;
    if (type === 'clear') clearRange(store, cmdManager, range);
    else void handleClipboardAction(type, store, cmdManager, range);
  }, [store, cmdManager]);
  const execCmd = useCallback((cmd: Command) => {
    if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store);
  }, [cmdManager, store]);
  const { canvasRef, rendererRef } = useCanvasRenderer(store, selected, onCellClick, selectSelection, view, cmdManager, onHeaderContextMenu, onCellContextMenu);
  useEffect(() => rendererRef.current?.setEditing(editing !== null), [editing, rendererRef]);
  const startEditing = (cell: CellAddress, value = cellEditValue(store, cell)): void => {
    const next = cellSelection(cell.r, cell.c);
    selectedRef.current = next;
    setSelected(next);
    setEditing({ ...cell, value });
  };
  const commitEditing = (value: string): void => {
    if (editing !== null) {
      if (store.isSheetProtected()) { message.warning('工作表已保护，无法编辑'); setEditing(null); return; }
      const rule = store.getValidationRule(editing.r, editing.c);
      if (rule !== undefined) {
        const svc = new DataValidationService();
        const result = svc.validate(value, rule);
        if (!result.valid) { message.warning(result.message ?? '输入值不符合验证规则'); }
      }
      setCellText(store, cmdManager, editing, value);
      // Excel: Alt+Enter auto-enables Wrap Text and grows the row
      if (value.includes('\n')) {
        const range = { r1: editing.r, c1: editing.c, r2: editing.r, c2: editing.c };
        applyShortcutStyle(store, cmdManager, range, { wrap: true });
        autofitRowsForSelection(store, cmdManager, range);
      }
    }
    setEditing(null);
  };

  useTheme(theme);
  useFormulaSync(store, formulaEngine);
  useStoreSheets(store, setSheets, setActiveSheetId);
  useStoreVersion(store, () => setStoreVersion((value) => value + 1));
  useFormulaValue(selected, editing, store, storeVersion, setFormulaValue);
  useAutoSave(store);
  useEffect(() => inputRef.current?.focus(), [editing]);

  return <ErrorBoundary><div className="ss-root">
    <MenuBar {...menuBarProps(store, cmdManager, selected, selectRange, () => selectSelection(sheetSelection(allSheetRange())), onClose)} view={{ ...view, setZoom: (zoom) => setView((current) => ({ ...current, zoom })), setShowFormula: (showFormula) => setView((current) => ({ ...current, showFormula })), setShowGrid: (showGrid) => setView((current) => ({ ...current, showGrid })), setFreeze: (frozenRows, frozenCols) => setView((current) => ({ ...current, frozenRows, frozenCols })) }} onFindNavigate={(cell) => selectSelection(cellSelection(cell.r, cell.c))} onFindHighlight={(cells) => rendererRef.current?.setHighlightMatches(cells)} openDialogKey={findDialogOpen} />
    <InteractionToolbar selected={selected} store={store} cmdManager={cmdManager} view={view} setView={setView} selectAll={() => selectSelection(sheetSelection(allSheetRange()))} painting={painting} onTogglePainter={() => { if (painting) { setPainting(false); setSourceStyle(undefined); } else { const cell = selected?.active; const s = cell === undefined ? undefined : store.getCell(cell.r, cell.c)?.styleId === undefined ? undefined : store.getStyle(store.getCell(cell.r, cell.c)!.styleId!); setSourceStyle(s); setPainting(true); } }} onToggleProtection={() => setProtectOpen(true)} />
    <ProtectionModal open={protectOpen} onClose={() => setProtectOpen(false)} store={store} />
    <FormulaBar selected={selected} value={formulaValue} onChange={setFormulaValue} onCommit={() => commitFormulaValue(selected, formulaValue, store, cmdManager)} />
    <div className="ss-canvas-wrap"><canvas ref={canvasRef} className="ss-canvas" tabIndex={0} aria-label="Spreadsheet canvas, use arrow keys to navigate" onKeyDown={(e) => handleCanvasKeyDown(e, selectedRef.current, store, cmdManager, startEditing, selectSelection, selectRange, setView, setFindDialogOpen)} onDoubleClick={(e) => { const cell = rendererRef.current?.cellAtPoint(e.clientX, e.clientY); if (cell != null) startEditing(cell); }} />
      {editing !== null && <EditorOverlay refEl={inputRef} editing={editing} setEditing={setEditing} commit={commitEditing} zoom={view.zoom} store={store} {...(rendererRef.current !== null ? { cellRect: rendererRef.current.getCellViewportRect(editing.r, editing.c) } : {})} />}</div>
    <StatusBar store={store} selected={selected?.range ?? null} zoom={view.zoom} />
    <BottomBar sheets={sheets} activeSheetId={activeSheetId} onSheetChange={(id) => store.activateSheet(id)} onAddSheet={() => addSheet(store)} onRenameSheet={(id) => renameSheet(store, id)} onDeleteSheet={(id) => deleteSheet(store, id)} />
    {ctxMenu?.kind === 'cell' && <CellContextMenu
      x={ctxMenu.x} y={ctxMenu.y} onClose={closeCtxMenu}
      onCut={() => runCtxClipboard('cut')} onCopy={() => runCtxClipboard('copy')} onPaste={() => runCtxClipboard('paste')} onClear={() => runCtxClipboard('clear')}
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
      onInsertCol={(c, position, count) => execCmd(new InsertColCommand({ c, count, position }))}
      onDeleteCol={(c, count) => execCmd(new DeleteColCommand({ c, count }))}
      onSetColWidth={(c, width) => execCmd(new SetColWidth({ c, width }))}
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
  public constructor(private readonly mountRoot: HTMLElement, private readonly options: SpreadsheetOptions = {}) {}
  public mount(): void { this.loadInitialData(); void this.tryRestoreFromDB(); this.root = createRoot(this.mountRoot); this.root.render(<SpreadsheetComponent store={this.store} cmdManager={this.cmdManager} formulaEngine={this.formula} theme={this.options.theme} />); }
  public destroy(): void { this.root?.unmount(); this.root = null; this.plugins.clear(); }
  public use(plugin: Plugin): this { this.plugins.use(plugin); return this; }
  public get rowCount(): number { return this.options.data?.length ?? this.options.sheets?.[0]?.data?.length ?? 0; }

  private loadInitialData(): void {
    if (this.options.sheets !== undefined) loadSheets(this.store, this.cmdManager, this.formula, this.options.sheets);
    else if (this.options.data !== undefined) loadData(this.store, this.cmdManager, this.formula, this.options.data);
    this.cmdManager.clear();
  }

  private async tryRestoreFromDB(): Promise<void> {
    if (this.options.sheets !== undefined || this.options.data !== undefined) return;
    const data = await loadWorkbook(DEFAULT_ID);
    if (data === undefined) return;
    const restored = Store.deserialize(data);
    restored.getSheets().forEach(({ id, name }) => { if (id !== 'sheet-1') this.store.addSheet(name); this.store.renameSheet(id, name); });
    restored.getCells().forEach(([key, cell]) => { const [r, c] = key.split(',').map(Number); this.store.setCell(r ?? 0, c ?? 0, cell); });
    this.cmdManager.clear();
  }
}

interface EditorOverlayProps { readonly refEl: RefObject<HTMLTextAreaElement>; readonly editing: EditingCell; readonly setEditing: (cell: EditingCell | null) => void; readonly commit: (value: string) => void; readonly zoom: number; readonly store: Store; readonly cellRect?: { x: number; y: number; w: number; h: number } }
const EditorOverlay: FC<EditorOverlayProps> = ({ refEl, editing, setEditing, commit, zoom, store, cellRect }) => {
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
      handleEditorKey(e, refEl, () => commit(refEl.current?.value ?? editing.value), () => setEditing(null), (next) => setEditing({ ...editing, value: next }));
    }}
    aria-label="Cell editor"
  />;
};

function useCanvasRenderer(store: Store, selected: Selection | null, onCellClick: (cell: CellAddress, shift: boolean) => void, onSelectionChange: (selection: Selection) => void, view: ViewState, cmdManager: CommandManager | undefined, onHeaderContextMenu: (info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => void, onCellContextMenu: (cell: CellAddress, x: number, y: number) => void): { canvasRef: RefObject<HTMLCanvasElement>; rendererRef: RefObject<CanvasRenderer | null> } {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const callbacks = useRef({ onCellClick, onSelectionChange, onHeaderContextMenu, onCellContextMenu });
  const selectedLiveRef = useRef(selected);
  callbacks.current = { onCellClick, onSelectionChange, onHeaderContextMenu, onCellContextMenu };
  selectedLiveRef.current = selected;
  useEffect(() => {
    if (canvasRef.current === null) return undefined;
    const currentSelection = selectedLiveRef.current;
    const base = { canvas: canvasRef.current, store, zoom: view.zoom, showFormula: view.showFormula, showGrid: view.showGrid, frozenRows: view.frozenRows, frozenCols: view.frozenCols, onCellClick: (cell: CellAddress, shift?: boolean) => flushSync(() => callbacks.current.onCellClick(cell, shift === true)), onSelectionChange: (range: RangeAddress, active?: CellAddress, anchor?: CellAddress) => flushSync(() => callbacks.current.onSelectionChange(rangeSelection(range, anchor ?? selectedLiveRef.current?.anchor, active ?? { r: range.r2, c: range.c2 }))), onColumnSelect: (c: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(columnSelection(c, TOTAL_ROWS, shift && current?.kind === 'column' ? current.anchor.c : c)); }), onRowSelect: (r: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(rowSelection(r, TOTAL_COLS, shift && current?.kind === 'row' ? current.anchor.r : r)); }), onSheetSelect: () => flushSync(() => callbacks.current.onSelectionChange(sheetSelection(allSheetRange()))), onRowResize: (r: number, height: number) => { const cmd = new SetRowHeight({ r, height }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColResize: (c: number, width: number) => { const cmd = new SetColWidth({ c, width }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onRowDblClick: (r: number) => { const fit = autoFitRowHeight(store, r); const cmd = new SetRowHeight({ r, height: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColDblClick: (c: number) => { const fit = autoFitColWidth(store, c); const cmd = new SetColWidth({ c, width: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onFill: (source: RangeAddress, target: RangeAddress, ctrlKey: boolean) => { const cmd = new FillRangeCommand({ mode: ctrlKey ? 'series' : 'copy', source, target }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onMoveRange: (source: RangeAddress, target: RangeAddress) => { const cmd = new MoveRange({ source, target }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onHeaderContextMenu: (info: { type: 'row'; r: number } | { type: 'column'; c: number }, x: number, y: number) => callbacks.current.onHeaderContextMenu(info, x, y), onCellContextMenu: (cell: CellAddress, x: number, y: number) => callbacks.current.onCellContextMenu(cell, x, y) };
    const renderer = new CanvasRenderer(currentSelection === null ? base : { ...base, selectedRange: currentSelection.range, selectionKind: currentSelection.kind, activeCell: currentSelection.active });
    rendererRef.current = renderer;
    return () => { renderer.destroy(); rendererRef.current = null; };
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
function useFormulaSync(store: Store, formulaEngine: FormulaEngine | undefined): void { const syncing = useRef(false); useEffect(() => { if (formulaEngine === undefined) return undefined; return store.subscribe((e) => syncFormulaEvent(e, formulaEngine, syncing)); }, [store, formulaEngine]); }
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
function syncFormulaEvent(event: StoreEvent, engine: FormulaEngine, syncing: MutableRefObject<boolean>): void { if (event.type !== 'cell' || syncing.current) return; syncing.current = true; const sheetId = event.sheetId; syncCellFormula(engine, event.r, event.c, event.cell, sheetId); engine.onCellChanged(cellId(event.r, event.c), sheetId); syncing.current = false; }

function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>, selected: Selection | null, store: Store, cmdManager: CommandManager | undefined, startEditing: (cell: CellAddress, value?: string) => void, selectSelection: (selection: Selection) => void, selectRange: (range: RangeAddress) => void, setView: Dispatch<SetStateAction<ViewState>>, setFindDialog: (name: DialogName | null) => void): void {
  if (selected === null || event.altKey) return;
  const range = selected.range;
  const keyboardBase = event.shiftKey ? Range.single(selected.active.r, selected.active.c).toAddress() : range;
  const action = KeyboardHandler.fromReactEvent(event, keyboardBase);
  if (action === null) return;
  event.preventDefault();
  if (action.type === 'move' && action.range !== undefined && event.shiftKey) selectSelection(extendSelection(selected, { r: action.range.r1, c: action.range.c1 }));
  else if (action.type === 'move' && action.range !== undefined) selectRange(action.range);
  else if (action.type === 'edit' || event.key === 'Enter') startEditing({ r: range.r1, c: range.c1 });
  else if (action.type === 'clear') clearRange(store, cmdManager, range);
  else if (action.type === 'cancel') selectRange(Range.single(range.r1, range.c1).toAddress());
  else if (action.type === 'type' && action.text !== undefined) { setCellText(store, cmdManager, { r: range.r1, c: range.c1 }, action.text); startEditing({ r: range.r1, c: range.c1 }, action.text); }
  else if (action.type === 'menu' && action.command !== undefined) handleMenuShortcut(action.command, store, cmdManager, range, selectRange, setView, setFindDialog);
  else handleClipboardAction(action.type, store, cmdManager, range);
}

function handleEditorKey(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  refEl: RefObject<HTMLTextAreaElement>,
  commit: () => void,
  cancel: () => void,
  setValue: (value: string) => void,
): void {
  if (event.key === 'Escape') { cancel(); return; }
  // Excel: Enter commits; Alt+Enter inserts a line break
  if (event.key === 'Enter' && !event.altKey) { event.preventDefault(); commit(); return; }
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
    whiteSpace: wrapping ? 'pre-wrap' : 'nowrap',
    overflow: wrapping ? 'auto' : 'hidden',
    resize: 'none',
  };
}
function setCellText(store: Store, cmdManager: CommandManager | undefined, cell: CellAddress, text: string): void { if (cmdManager === undefined) store.setCell(cell.r, cell.c, cellFromText(store.getCell(cell.r, cell.c), text)); else cmdManager.execute(new SetCellText({ r: cell.r, c: cell.c, text })); }
function cellEditValue(store: Store, cell: CellAddress): string { const current = store.getCell(cell.r, cell.c); return current?.formula ?? current?.text ?? ''; }
function syncExistingFormulas(store: Store, engine: FormulaEngine): void { const sheetId = store.getActiveSheetId(); store.getCells().forEach(([id, cell]) => { const formula = formulaText(cell); if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula), sheetId); }); }
function syncCellFormula(engine: FormulaEngine, r: number, c: number, cell: Cell | undefined, sheetId?: string): void { const formula = formulaText(cell); const id = cellId(r, c); if (formula === undefined) engine.removeFormula(id, sheetId); else engine.setFormula(id, formula, formulaDependencies(formula), sheetId); }

async function handleClipboardAction(type: string, store: Store, cmdManager: CommandManager | undefined, range: RangeAddress): Promise<void> {
  if (type === 'copy') await ClipboardService.copy(store, range);
  if (type === 'cut') { await ClipboardService.cut(store, range); clearRange(store, cmdManager, range); }
  if (type === 'paste') await pasteFromClipboard(cmdManager, range);
}
async function pasteFromClipboard(cmdManager: CommandManager | undefined, target: RangeAddress): Promise<void> { const cells = await ClipboardService.read(); applyMatrix(cmdManager, target.r1, target.c1, cells); }
function clearRange(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress): void { const values = matrix(range, () => ({ text: '' })); executeRange(store, cmdManager, range.r1, range.c1, values); }
function applyMatrix(cmdManager: CommandManager | undefined, r: number, c: number, values: readonly (readonly Partial<Cell>[])[]): void { const lastRow = values[values.length - 1]; if (lastRow === undefined) return; executeRange(undefined, cmdManager, r, c, values); }
function executeRange(store: Store | undefined, cmdManager: CommandManager | undefined, r: number, c: number, values: readonly (readonly Partial<Cell>[])[]): void { const r2 = r + values.length - 1; const c2 = c + (values[0]?.length ?? 1) - 1; const cmd = new SetRangeValues({ r1: r, c1: c, r2, c2, values }); if (cmdManager === undefined) { if (store !== undefined) cmd.execute(store); } else cmdManager.execute(cmd); }
function matrix(range: RangeAddress, cell: () => Partial<Cell>): Partial<Cell>[][] { return Array.from({ length: range.r2 - range.r1 + 1 }, () => Array.from({ length: range.c2 - range.c1 + 1 }, cell)); }
function addSheet(store: Store): void { const name = window.prompt('Sheet name', `Sheet${store.getSheets().length + 1}`); if (name !== null) store.addSheet(name); }
function renameSheet(store: Store, id: string): void { const current = store.getSheets().find((s) => s.id === id)?.name ?? ''; const name = window.prompt('Rename sheet', current); if (name !== null) store.renameSheet(id, name); }
function deleteSheet(store: Store, id: string): void { if (window.confirm('Delete this sheet?')) store.deleteSheet(id); }
function loadData(store: Store, cmd: CommandManager, formula: FormulaEngine, data: readonly (readonly CellInput[])[]): void { loadValues(cmd, data); syncExistingFormulas(store, formula); }
function loadSheets(store: Store, cmd: CommandManager, formula: FormulaEngine, sheets: readonly SheetInput[]): void { sheets.forEach((sheet, index) => { const id = index === 0 ? store.getActiveSheetId() : store.addSheet(sheet.name); store.renameSheet(id, sheet.name); store.activateSheet(id); loadValues(cmd, sheet.data ?? []); syncExistingFormulas(store, formula); }); const first = store.getSheets()[0]; if (first !== undefined) store.activateSheet(first.id); }
function loadValues(cmd: CommandManager, data: readonly (readonly CellInput[])[]): void { const values = data.map((row) => row.map(normalizeCellInput)); const maxCols = values.reduce((max, row) => Math.max(max, row.length), 0); if (values.length === 0 || maxCols === 0) return; cmd.execute(new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: maxCols - 1, values })); }

function menuBarProps(store: Store, cmdManager: CommandManager | undefined, selected: Selection | null, selectRange: (range: RangeAddress) => void, allRange: () => void, onClose: (() => void) | undefined): React.ComponentProps<typeof MenuBar> {
  const range = selected?.range ?? null;
  const props = { store, selected: range, selectRange, clearRange: () => { if (range !== null) clearRange(store, cmdManager, range); }, allRange };
  return cmdManager === undefined ? withClose(props, onClose) : withClose({ ...props, cmdManager }, onClose);
}
function withClose<T extends Omit<React.ComponentProps<typeof MenuBar>, 'closeDemo'>>(props: T, onClose: (() => void) | undefined): React.ComponentProps<typeof MenuBar> {
  return onClose === undefined ? props : { ...props, closeDemo: onClose };
}

function handleMenuShortcut(command: MenuShortcutCommand, store: Store, cmdManager: CommandManager | undefined, selected: RangeAddress, selectRange: (range: RangeAddress) => void, setView: Dispatch<SetStateAction<ViewState>>, setFindDialog: (name: DialogName | null) => void): void {
  const map: Record<MenuShortcutCommand, () => void> = { save: () => saveToLocal(store), find: () => setFindDialog('find'), replace: () => setFindDialog('replace'), selectAll: () => selectRange(allSheetRange()), bold: () => applyShortcutStyle(store, cmdManager, selected, { bold: true }), italic: () => applyShortcutStyle(store, cmdManager, selected, { italic: true }), underline: () => applyShortcutStyle(store, cmdManager, selected, { underline: true }), zoom100: () => setView((current) => ({ ...current, zoom: 100 })), zoomIn: () => setView((current) => ({ ...current, zoom: Math.min(200, current.zoom + 10) })), zoomOut: () => setView((current) => ({ ...current, zoom: Math.max(50, current.zoom - 10) })), undo: () => cmdManager?.undo(), redo: () => cmdManager?.redo() };
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
          if (range !== undefined) autofitRowsForSelection(store, cmdManager, range);
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
            if (next && range !== undefined) autofitRowsForSelection(store, cmdManager, range);
          }}
        >自动换行</Button>
      </Tooltip>
      <Divider type="vertical" />
      <Dropdown trigger={['click']} menu={{
        items: [
          { key: 'all', icon: <BorderOutlined />, label: '全部边框' },
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
