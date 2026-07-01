import { Button, Divider, Select, Space, Switch, Tooltip, message } from 'antd';
import { AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BoldOutlined, ClearOutlined, ItalicOutlined, SelectOutlined, UnderlineOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type FC, type KeyboardEvent as ReactKeyboardEvent, type RefObject, type SetStateAction } from 'react';
import { ClipboardService } from '../clipboard/ClipboardService';
import { CommandManager } from '../commands/CommandManager';
import { SetCellText } from '../commands/impl/SetCellText';
import { SetRangeStyleCommand } from '../commands/impl/SetRangeStyle';
import { SetRangeValues } from '../commands/impl/SetRangeValues';
import { EventBus } from '../events/EventBus';
import { FormulaEngine } from '../formula/FormulaEngine';
import { KeyboardHandler, type MenuShortcutCommand } from '../keys/KeyboardHandler';
import { PluginManager, type Plugin } from '../plugin/PluginManager';
import { CanvasRenderer, COL_HEADER_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, TOTAL_COLS, TOTAL_ROWS, canvasPointToCell, type CellAddress } from '../renderer/CanvasRenderer';
import { FillRangeCommand } from '../commands/impl/FillRange';
import { SetColWidth } from '../commands/impl/SetColWidth';
import { SetRowHeight } from '../commands/impl/SetRowHeight';
import { Range, type RangeAddress } from '../selection/Range';
import { Store, type SheetInfo } from '../store/Store';
import { applyStoredTheme, setTheme, type Theme } from '../theme';
import { cellFromText, cellId, formulaDependencies, formulaText, normalizeCellInput, type CellInput as CellDataInput } from '../util/cell';
import { cellSelection, columnSelection, extendSelection, rangeSelection, rowSelection, selectionLabel, sheetSelection, type Selection } from '../selection/Selection';
import { BottomBar } from './BottomBar';
import { MenuBar, allSheetRange } from './menu/MenuBar';
import type { Cell, StoreEvent, Style } from '../types';

export type CellInput = CellDataInput;
export interface SheetInput { readonly id?: string; readonly name: string; readonly data?: readonly (readonly CellInput[])[] }
export interface SpreadsheetOptions { readonly data?: readonly (readonly CellInput[])[]; readonly sheets?: readonly SheetInput[]; readonly theme?: Theme | false }
export interface SpreadsheetProps { readonly store: Store; readonly cmdManager?: CommandManager; readonly formulaEngine?: FormulaEngine; readonly theme?: Theme | false | undefined; readonly onClose?: () => void }
interface EditingCell extends CellAddress { readonly value: string }
interface ViewState { readonly zoom: number; readonly showFormula: boolean; readonly showGrid: boolean }

export const SpreadsheetComponent: FC<SpreadsheetProps> = ({ store, cmdManager, formulaEngine, theme, onClose }) => {
  const [selected, setSelected] = useState<Selection | null>(cellSelection(0, 0));
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [sheets, setSheets] = useState<readonly SheetInfo[]>(store.getSheets());
  const [activeSheetId, setActiveSheetId] = useState(store.getActiveSheetId());
  const [view, setView] = useState<ViewState>({ zoom: 100, showFormula: false, showGrid: true });
  const [storeVersion, setStoreVersion] = useState(0);
  const [formulaValue, setFormulaValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const selectSelection = useCallback((next: Selection) => {
    selectedRef.current = next;
    setSelected(next);
    setEditing(null);
  }, []);
  const selectRange = useCallback((range: RangeAddress) => selectSelection(rangeSelection(range)), [selectSelection]);
  const onCellClick = useCallback((cell: CellAddress, shift: boolean) => selectSelection(shift && selectedRef.current ? extendSelection(selectedRef.current, cell) : cellSelection(cell.r, cell.c)), [selectSelection]);
  const canvasRef = useCanvasRenderer(store, selected, onCellClick, selectSelection, view, cmdManager);
  const startEditing = (cell: CellAddress, value = cellEditValue(store, cell)): void => {
    const next = cellSelection(cell.r, cell.c);
    selectedRef.current = next;
    setSelected(next);
    setEditing({ ...cell, value });
  };
  const commitEditing = (value: string): void => { if (editing !== null) setCellText(store, cmdManager, editing, value); setEditing(null); };

  useTheme(theme);
  useFormulaSync(store, formulaEngine);
  useStoreSheets(store, setSheets, setActiveSheetId);
  useStoreVersion(store, () => setStoreVersion((value) => value + 1));
  useFormulaValue(selected, editing, store, storeVersion, setFormulaValue);
  useEffect(() => inputRef.current?.focus(), [editing]);

  return <div className="ss-root">
    <MenuBar {...menuBarProps(store, cmdManager, selected, selectRange, () => selectSelection(sheetSelection(allSheetRange())), onClose)} view={{ ...view, setZoom: (zoom) => setView((current) => ({ ...current, zoom })), setShowFormula: (showFormula) => setView((current) => ({ ...current, showFormula })), setShowGrid: (showGrid) => setView((current) => ({ ...current, showGrid })) }} />
    <InteractionToolbar selected={selected} store={store} cmdManager={cmdManager} view={view} setView={setView} selectAll={() => selectSelection(sheetSelection(allSheetRange()))} />
    <FormulaBar selected={selected} value={formulaValue} onChange={setFormulaValue} onCommit={() => commitFormulaValue(selected, formulaValue, store, cmdManager)} />
    <div className="ss-canvas-wrap"><canvas ref={canvasRef} className="ss-canvas" tabIndex={0} onKeyDown={(e) => handleCanvasKeyDown(e, selectedRef.current, store, cmdManager, startEditing, selectSelection, selectRange, setView)} onDoubleClick={(e) => editFromPointer(e.currentTarget, e.clientX, e.clientY, startEditing, view.zoom)} />
      {editing !== null && <EditorOverlay refEl={inputRef} editing={editing} setEditing={setEditing} commit={commitEditing} zoom={view.zoom} />}</div>
    <BottomBar sheets={sheets} activeSheetId={activeSheetId} onSheetChange={(id) => store.activateSheet(id)} onAddSheet={() => addSheet(store)} onRenameSheet={(id) => renameSheet(store, id)} onDeleteSheet={(id) => deleteSheet(store, id)} />
  </div>;
};

export class Spreadsheet {
  public readonly store = new Store();
  public readonly events = new EventBus();
  public readonly cmdManager = new CommandManager(this.store, this.events);
  public readonly formula = new FormulaEngine(this.store);
  private readonly plugins = new PluginManager(this);
  private root: Root | null = null;
  public constructor(private readonly mountRoot: HTMLElement, private readonly options: SpreadsheetOptions = {}) {}
  public mount(): void { this.loadInitialData(); this.root = createRoot(this.mountRoot); this.root.render(<SpreadsheetComponent store={this.store} cmdManager={this.cmdManager} formulaEngine={this.formula} theme={this.options.theme} />); }
  public destroy(): void { this.root?.unmount(); this.root = null; this.plugins.clear(); }
  public use(plugin: Plugin): this { this.plugins.use(plugin); return this; }
  public get rowCount(): number { return this.options.data?.length ?? this.options.sheets?.[0]?.data?.length ?? 0; }

  private loadInitialData(): void {
    if (this.options.sheets !== undefined) loadSheets(this.store, this.cmdManager, this.formula, this.options.sheets);
    else if (this.options.data !== undefined) loadData(this.store, this.cmdManager, this.formula, this.options.data);
    this.cmdManager.clear();
  }
}

interface EditorOverlayProps { readonly refEl: RefObject<HTMLInputElement | null>; readonly editing: EditingCell; readonly setEditing: (cell: EditingCell | null) => void; readonly commit: (value: string) => void; readonly zoom: number }
const EditorOverlay: FC<EditorOverlayProps> = ({ refEl, editing, setEditing, commit, zoom }) => <input ref={refEl} className="ss-editor-overlay" style={editorStyle(editing, zoom)} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => handleEditorKey(e, commit, () => setEditing(null))} aria-label="Cell editor" />;

function useCanvasRenderer(store: Store, selected: Selection | null, onCellClick: (cell: CellAddress, shift: boolean) => void, onSelectionChange: (selection: Selection) => void, view: ViewState, cmdManager?: CommandManager): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const callbacks = useRef({ onCellClick, onSelectionChange });
  const selectedLiveRef = useRef(selected);
  callbacks.current = { onCellClick, onSelectionChange };
  selectedLiveRef.current = selected;
  useEffect(() => {
    if (canvasRef.current === null) return undefined;
    const currentSelection = selectedLiveRef.current;
    const base = { canvas: canvasRef.current, store, zoom: view.zoom, showFormula: view.showFormula, showGrid: view.showGrid, onCellClick: (cell: CellAddress, shift?: boolean) => flushSync(() => callbacks.current.onCellClick(cell, shift === true)), onSelectionChange: (range: RangeAddress, active?: CellAddress, anchor?: CellAddress) => flushSync(() => callbacks.current.onSelectionChange(rangeSelection(range, anchor ?? selectedLiveRef.current?.anchor, active ?? { r: range.r2, c: range.c2 }))), onColumnSelect: (c: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(columnSelection(c, TOTAL_ROWS, shift && current?.kind === 'column' ? current.anchor.c : c)); }), onRowSelect: (r: number, shift: boolean) => flushSync(() => { const current = selectedLiveRef.current; callbacks.current.onSelectionChange(rowSelection(r, TOTAL_COLS, shift && current?.kind === 'row' ? current.anchor.r : r)); }), onSheetSelect: () => flushSync(() => callbacks.current.onSelectionChange(sheetSelection(allSheetRange()))), onRowResize: (r: number, height: number) => { const cmd = new SetRowHeight({ r, height }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColResize: (c: number, width: number) => { const cmd = new SetColWidth({ c, width }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onRowDblClick: (r: number) => { const fit = autoFitRowHeight(store, r); const cmd = new SetRowHeight({ r, height: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onColDblClick: (c: number) => { const fit = autoFitColWidth(store, c); const cmd = new SetColWidth({ c, width: fit }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); }, onFill: (source: RangeAddress, target: RangeAddress, ctrlKey: boolean) => { const cmd = new FillRangeCommand({ mode: ctrlKey ? 'series' : 'copy', source, target }); if (cmdManager !== undefined) cmdManager.execute(cmd); else cmd.execute(store); } };
    const renderer = new CanvasRenderer(currentSelection === null ? base : { ...base, selectedRange: currentSelection.range, selectionKind: currentSelection.kind, activeCell: currentSelection.active });
    rendererRef.current = renderer;
    return () => { renderer.destroy(); rendererRef.current = null; };
  }, [store, view.zoom, view.showFormula, view.showGrid]);
  useEffect(() => rendererRef.current?.setSelection(selected?.range, selected?.kind, selected?.active), [selected]);
  return canvasRef;
}

function autoFitRowHeight(store: Store, r: number): number {
  let hasContent = false;
  for (let c = 0; c < TOTAL_COLS; c += 1) { if (store.getCell(r, c)?.text !== undefined && store.getCell(r, c)!.text.length > 0) { hasContent = true; break; } }
  if (!hasContent) return ROW_HEIGHT;
  return clampVal(20, 15, 500);
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
function syncFormulaEvent(event: StoreEvent, engine: FormulaEngine, syncing: RefObject<boolean>): void { if (event.type !== 'cell' || syncing.current) return; syncing.current = true; syncCellFormula(engine, event.r, event.c, event.cell); engine.onCellChanged(cellId(event.r, event.c)); syncing.current = false; }

function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>, selected: Selection | null, store: Store, cmdManager: CommandManager | undefined, startEditing: (cell: CellAddress, value?: string) => void, selectSelection: (selection: Selection) => void, selectRange: (range: RangeAddress) => void, setView: Dispatch<SetStateAction<ViewState>>): void {
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
  else if (action.type === 'menu' && action.command !== undefined) handleMenuShortcut(action.command, store, cmdManager, range, selectRange, setView);
  else handleClipboardAction(action.type, store, cmdManager, range);
}

function handleEditorKey(event: ReactKeyboardEvent<HTMLInputElement>, commit: (value: string) => void, cancel: () => void): void { if (event.key === 'Enter') commit(event.currentTarget.value); if (event.key === 'Escape') cancel(); }
function editFromPointer(canvas: HTMLCanvasElement, x: number, y: number, startEditing: (cell: CellAddress) => void, zoom: number): void { const cell = canvasPointToCell(canvas, x, y, 0, 0, zoom); if (cell !== null) startEditing(cell); }
function editorStyle(cell: CellAddress, zoom: number): CSSProperties {
  const scale = zoom / 100;
  return { left: ROW_HEADER_WIDTH + cell.c * COL_WIDTH * scale + 1, top: COL_HEADER_HEIGHT + cell.r * ROW_HEIGHT * scale + 1, width: COL_WIDTH * scale - 3, height: ROW_HEIGHT * scale - 3 };
}
function setCellText(store: Store, cmdManager: CommandManager | undefined, cell: CellAddress, text: string): void { if (cmdManager === undefined) store.setCell(cell.r, cell.c, cellFromText(store.getCell(cell.r, cell.c), text)); else cmdManager.execute(new SetCellText({ r: cell.r, c: cell.c, text })); }
function cellEditValue(store: Store, cell: CellAddress): string { const current = store.getCell(cell.r, cell.c); return current?.formula ?? current?.text ?? ''; }
function syncExistingFormulas(store: Store, engine: FormulaEngine): void { store.getCells().forEach(([id, cell]) => { const formula = formulaText(cell); if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula)); }); }
function syncCellFormula(engine: FormulaEngine, r: number, c: number, cell: Cell | undefined): void { const formula = formulaText(cell); const id = cellId(r, c); if (formula === undefined) engine.removeFormula(id); else engine.setFormula(id, formula, formulaDependencies(formula)); }

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

function handleMenuShortcut(command: MenuShortcutCommand, store: Store, cmdManager: CommandManager | undefined, selected: RangeAddress, selectRange: (range: RangeAddress) => void, setView: Dispatch<SetStateAction<ViewState>>): void {
  const map: Record<MenuShortcutCommand, () => void> = { save: () => saveToLocal(store), find: () => message.info('查找快捷键已触发'), replace: () => message.info('替换快捷键已触发'), selectAll: () => selectRange(allSheetRange()), bold: () => applyShortcutStyle(store, cmdManager, selected, { bold: true }), italic: () => applyShortcutStyle(store, cmdManager, selected, { italic: true }), underline: () => applyShortcutStyle(store, cmdManager, selected, { underline: true }), zoom100: () => setView((current) => ({ ...current, zoom: 100 })), zoomIn: () => setView((current) => ({ ...current, zoom: Math.min(200, current.zoom + 10) })), zoomOut: () => setView((current) => ({ ...current, zoom: Math.max(50, current.zoom - 10) })), undo: () => cmdManager?.undo(), redo: () => cmdManager?.redo() };
  map[command]();
}
function applyShortcutStyle(store: Store, cmdManager: CommandManager | undefined, range: RangeAddress, style: Partial<Style>): void { const cmd = new SetRangeStyleCommand({ ...range, style }); if (cmdManager === undefined) cmd.execute(store); else cmdManager.execute(cmd); }
function saveToLocal(store: Store): void { window.localStorage.setItem('web-spreadsheet:workbook', JSON.stringify(store.serialize())); message.success('已保存到本地存储'); }
function dispatchThemeChanged(): void { window.dispatchEvent(new CustomEvent('ss:theme-changed')); }
function commitFormulaValue(selected: Selection | null, value: string, store: Store, cmdManager: CommandManager | undefined): void {
  if (selected === null) return;
  setCellText(store, cmdManager, { r: selected.range.r1, c: selected.range.c1 }, value);
}

const FormulaBar: FC<{ readonly selected: Selection | null; readonly value: string; readonly onChange: (value: string) => void; readonly onCommit: () => void }> = ({ selected, value, onChange, onCommit }) => {
  const label = selectionLabel(selected);
  return <div className="ss-formula-bar">
    <div className="ss-formula-name" aria-label="Selected cell">{label}</div>
    <input className="ss-formula-input" aria-label="Formula bar" value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onCommit(); }} />
  </div>;
};

const InteractionToolbar: FC<{ readonly selected: Selection | null; readonly store: Store; readonly cmdManager: CommandManager | undefined; readonly view: ViewState; readonly setView: Dispatch<SetStateAction<ViewState>>; readonly selectAll: () => void }> = ({ selected, store, cmdManager, view, setView, selectAll }) => {
  const range = selected?.range;
  const style = (next: Partial<Style>): void => { if (range !== undefined) applyShortcutStyle(store, cmdManager, range, next); };
  const setZoom = (zoom: number): void => setView((current) => ({ ...current, zoom }));
  return <div className="ss-interaction-toolbar" aria-label="Spreadsheet toolbar">
    <Space size={4} wrap>
      <Tooltip title="全选"><Button size="small" icon={<SelectOutlined />} aria-label="Select all" onClick={selectAll} /></Tooltip>
      <Tooltip title="清除内容"><Button size="small" icon={<ClearOutlined />} aria-label="Clear contents" onClick={() => { if (range !== undefined) clearRange(store, cmdManager, range); }} /></Tooltip>
      <Divider type="vertical" />
      <Tooltip title="加粗"><Button size="small" icon={<BoldOutlined />} aria-label="Bold" onClick={() => style({ bold: true })} /></Tooltip>
      <Tooltip title="斜体"><Button size="small" icon={<ItalicOutlined />} aria-label="Italic" onClick={() => style({ italic: true })} /></Tooltip>
      <Tooltip title="下划线"><Button size="small" icon={<UnderlineOutlined />} aria-label="Underline" onClick={() => style({ underline: true })} /></Tooltip>
      <Divider type="vertical" />
      <Tooltip title="左对齐"><Button size="small" icon={<AlignLeftOutlined />} aria-label="Align left" onClick={() => style({ align: 'left' })} /></Tooltip>
      <Tooltip title="居中"><Button size="small" icon={<AlignCenterOutlined />} aria-label="Align center" onClick={() => style({ align: 'center' })} /></Tooltip>
      <Tooltip title="右对齐"><Button size="small" icon={<AlignRightOutlined />} aria-label="Align right" onClick={() => style({ align: 'right' })} /></Tooltip>
      <Divider type="vertical" />
      <Tooltip title="缩小"><Button size="small" icon={<ZoomOutOutlined />} aria-label="Zoom out" onClick={() => setZoom(Math.max(50, view.zoom - 10))} /></Tooltip>
      <Select size="small" aria-label="Zoom level" value={view.zoom} popupMatchSelectWidth={false} onChange={setZoom} options={[50, 75, 100, 125, 150, 200].map((value) => ({ value, label: `${value}%` }))} />
      <Tooltip title="放大"><Button size="small" icon={<ZoomInOutlined />} aria-label="Zoom in" onClick={() => setZoom(Math.min(200, view.zoom + 10))} /></Tooltip>
      <Divider type="vertical" />
      <span className="ss-toolbar-toggle"><Switch size="small" checked={view.showFormula} onChange={(showFormula) => setView((current) => ({ ...current, showFormula }))} />公式</span>
      <span className="ss-toolbar-toggle"><Switch size="small" checked={view.showGrid} onChange={(showGrid) => setView((current) => ({ ...current, showGrid }))} />网格</span>
    </Space>
  </div>;
};
