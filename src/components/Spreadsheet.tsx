import { message } from 'antd';
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FC, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { ClipboardService } from '../clipboard/ClipboardService';
import { CommandManager } from '../commands/CommandManager';
import { SetCellText } from '../commands/impl/SetCellText';
import { SetRangeValues } from '../commands/impl/SetRangeValues';
import { EventBus } from '../events/EventBus';
import { FormulaEngine } from '../formula/FormulaEngine';
import { KeyboardHandler } from '../keys/KeyboardHandler';
import { PluginManager, type Plugin } from '../plugin/PluginManager';
import { CanvasRenderer, COL_HEADER_HEIGHT, COL_WIDTH, ROW_HEADER_WIDTH, ROW_HEIGHT, TOTAL_COLS, TOTAL_ROWS, canvasPointToCell, type CellAddress } from '../renderer/CanvasRenderer';
import { Range, type RangeAddress } from '../selection/Range';
import { Store, type SheetInfo } from '../store/Store';
import { applyStoredTheme, setTheme, type Theme } from '../theme';
import { cellFromText, cellId, formulaDependencies, formulaText, normalizeCellInput, type CellInput as CellDataInput } from '../util/cell';
import { BottomBar } from './BottomBar';
import { Toolbar } from './Toolbar';
import type { Cell, StoreEvent } from '../types';

export type CellInput = CellDataInput;
export interface SheetInput { readonly id?: string; readonly name: string; readonly data?: readonly (readonly CellInput[])[] }
export interface SpreadsheetOptions { readonly data?: readonly (readonly CellInput[])[]; readonly sheets?: readonly SheetInput[]; readonly theme?: Theme | false }
export interface SpreadsheetProps { readonly store: Store; readonly cmdManager?: CommandManager; readonly formulaEngine?: FormulaEngine; readonly theme?: Theme | false | undefined }
interface EditingCell extends CellAddress { readonly value: string }

export const SpreadsheetComponent: FC<SpreadsheetProps> = ({ store, cmdManager, formulaEngine, theme }) => {
  const [selected, setSelected] = useState<RangeAddress | null>(Range.single(0, 0).toAddress());
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [sheets, setSheets] = useState<readonly SheetInfo[]>(store.getSheets());
  const [activeSheetId, setActiveSheetId] = useState(store.getActiveSheetId());
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const selectRange = useCallback((range: RangeAddress) => { setSelected(Range.normalize(range)); setEditing(null); }, []);
  const onCellClick = useCallback((cell: CellAddress, shift: boolean) => selectRange(shift && selectedRef.current ? extendRange(selectedRef.current, cell) : Range.single(cell.r, cell.c).toAddress()), [selectRange]);
  const canvasRef = useCanvasRenderer(store, selected, onCellClick, selectRange, setSelected);
  const startEditing = (cell: CellAddress, value = cellEditValue(store, cell)): void => { setSelected(Range.single(cell.r, cell.c).toAddress()); setEditing({ ...cell, value }); };
  const commitEditing = (value: string): void => { if (editing !== null) setCellText(store, cmdManager, editing, value); setEditing(null); };

  useTheme(theme);
  useFormulaSync(store, formulaEngine);
  useStoreSheets(store, setSheets, setActiveSheetId);
  useEffect(() => inputRef.current?.focus(), [editing]);

  return <div className="ss-root">
    <Toolbar {...toolbarActions()} />
    <div className="ss-canvas-wrap"><canvas ref={canvasRef} className="ss-canvas" tabIndex={0} onKeyDown={(e) => handleCanvasKeyDown(e, selected, store, cmdManager, startEditing, selectRange)} onDoubleClick={(e) => editFromPointer(e.currentTarget, e.clientX, e.clientY, startEditing)} />
      {editing !== null && <EditorOverlay refEl={inputRef} editing={editing} setEditing={setEditing} commit={commitEditing} />}</div>
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

interface EditorOverlayProps { readonly refEl: RefObject<HTMLInputElement | null>; readonly editing: EditingCell; readonly setEditing: (cell: EditingCell | null) => void; readonly commit: (value: string) => void }
const EditorOverlay: FC<EditorOverlayProps> = ({ refEl, editing, setEditing, commit }) => <input ref={refEl} className="ss-editor-overlay" style={editorStyle(editing)} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => handleEditorKey(e, commit, () => setEditing(null))} aria-label="Cell editor" />;

function useCanvasRenderer(store: Store, selected: RangeAddress | null, onCellClick: (cell: CellAddress, shift: boolean) => void, onSelectionChange: (range: RangeAddress) => void, setSelected: (range: RangeAddress) => void): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const callbacks = useRef({ onCellClick, onSelectionChange, setSelected });
  callbacks.current = { onCellClick, onSelectionChange, setSelected };
  useEffect(() => {
    if (canvasRef.current === null) return undefined;
    const base = { canvas: canvasRef.current, store, onCellClick: (cell: CellAddress, shift?: boolean) => callbacks.current.onCellClick(cell, shift === true), onSelectionChange: (range: RangeAddress) => callbacks.current.onSelectionChange(range), onColumnSelect: (c: number, shift: boolean) => callbacks.current.setSelected(columnRange(c, shift ? selected?.c1 : undefined)), onRowSelect: (r: number, shift: boolean) => callbacks.current.setSelected(rowRange(r, shift ? selected?.r1 : undefined)) };
    const renderer = new CanvasRenderer(selected === null ? base : { ...base, selectedRange: selected });
    rendererRef.current = renderer;
    return () => { renderer.destroy(); rendererRef.current = null; };
  }, [store]);
  useEffect(() => rendererRef.current?.setSelectedRange(selected ?? undefined), [selected]);
  return canvasRef;
}

function useTheme(theme: Theme | false | undefined): void { useEffect(() => { if (theme === false) return; if (theme === undefined) applyStoredTheme(); else setTheme(theme); dispatchThemeChanged(); }, [theme]); }
function useStoreSheets(store: Store, setSheets: (s: readonly SheetInfo[]) => void, setActive: (id: string) => void): void { useEffect(() => store.subscribe((event) => { if (event.type !== 'sheet') return; setSheets(store.getSheets()); setActive(store.getActiveSheetId()); }), [store, setSheets, setActive]); }
function useFormulaSync(store: Store, formulaEngine: FormulaEngine | undefined): void { const syncing = useRef(false); useEffect(() => { if (formulaEngine === undefined) return undefined; return store.subscribe((e) => syncFormulaEvent(e, formulaEngine, syncing)); }, [store, formulaEngine]); }
function syncFormulaEvent(event: StoreEvent, engine: FormulaEngine, syncing: RefObject<boolean>): void { if (event.type !== 'cell' || syncing.current) return; syncing.current = true; syncCellFormula(engine, event.r, event.c, event.cell); engine.onCellChanged(cellId(event.r, event.c)); syncing.current = false; }

function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>, selected: RangeAddress | null, store: Store, cmdManager: CommandManager | undefined, startEditing: (cell: CellAddress, value?: string) => void, selectRange: (range: RangeAddress) => void): void {
  if (selected === null || event.altKey) return;
  const action = KeyboardHandler.fromReactEvent(event, selected);
  if (action === null) return;
  event.preventDefault();
  if (action.type === 'move' && action.range !== undefined) selectRange(action.range);
  else if (action.type === 'edit' || event.key === 'Enter') startEditing({ r: selected.r1, c: selected.c1 });
  else if (action.type === 'clear') clearRange(store, cmdManager, selected);
  else if (action.type === 'cancel') selectRange(Range.single(selected.r1, selected.c1).toAddress());
  else if (action.type === 'type' && action.text !== undefined) { setCellText(store, cmdManager, { r: selected.r1, c: selected.c1 }, action.text); startEditing({ r: selected.r1, c: selected.c1 }, action.text); }
  else handleClipboardAction(action.type, store, cmdManager, selected);
}

function handleEditorKey(event: ReactKeyboardEvent<HTMLInputElement>, commit: (value: string) => void, cancel: () => void): void { if (event.key === 'Enter') commit(event.currentTarget.value); if (event.key === 'Escape') cancel(); }
function editFromPointer(canvas: HTMLCanvasElement, x: number, y: number, startEditing: (cell: CellAddress) => void): void { const cell = canvasPointToCell(canvas, x, y); if (cell !== null) startEditing(cell); }
function editorStyle(cell: CellAddress): CSSProperties { return { left: ROW_HEADER_WIDTH + cell.c * COL_WIDTH + 1, top: COL_HEADER_HEIGHT + cell.r * ROW_HEIGHT + 1, width: COL_WIDTH - 3, height: ROW_HEIGHT - 3 }; }
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
function extendRange(range: RangeAddress, cell: CellAddress): RangeAddress { return new Range({ r1: range.r1, c1: range.c1, r2: cell.r, c2: cell.c }).toAddress(); }
function columnRange(c: number, anchor?: number): RangeAddress { const c1 = anchor ?? c; return Range.normalize({ r1: 0, c1, r2: TOTAL_ROWS - 1, c2: c }); }
function rowRange(r: number, anchor?: number): RangeAddress { const r1 = anchor ?? r; return Range.normalize({ r1, c1: 0, r2: r, c2: TOTAL_COLS - 1 }); }
function addSheet(store: Store): void { const name = window.prompt('Sheet name', `Sheet${store.getSheets().length + 1}`); if (name !== null) store.addSheet(name); }
function renameSheet(store: Store, id: string): void { const current = store.getSheets().find((s) => s.id === id)?.name ?? ''; const name = window.prompt('Rename sheet', current); if (name !== null) store.renameSheet(id, name); }
function deleteSheet(store: Store, id: string): void { if (window.confirm('Delete this sheet?')) store.deleteSheet(id); }
function loadData(store: Store, cmd: CommandManager, formula: FormulaEngine, data: readonly (readonly CellInput[])[]): void { loadValues(cmd, data); syncExistingFormulas(store, formula); }
function loadSheets(store: Store, cmd: CommandManager, formula: FormulaEngine, sheets: readonly SheetInput[]): void { sheets.forEach((sheet, index) => { const id = index === 0 ? store.getActiveSheetId() : store.addSheet(sheet.name); store.renameSheet(id, sheet.name); store.activateSheet(id); loadValues(cmd, sheet.data ?? []); syncExistingFormulas(store, formula); }); const first = store.getSheets()[0]; if (first !== undefined) store.activateSheet(first.id); }
function loadValues(cmd: CommandManager, data: readonly (readonly CellInput[])[]): void { const values = data.map((row) => row.map(normalizeCellInput)); const maxCols = values.reduce((max, row) => Math.max(max, row.length), 0); if (values.length === 0 || maxCols === 0) return; cmd.execute(new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: maxCols - 1, values })); }
function toolbarActions(): React.ComponentProps<typeof Toolbar> { return { onBold: styleStub('Bold'), onItalic: styleStub('Italic'), onUnderline: styleStub('Underline'), onFontSize: styleStub('Font Size'), onAlign: styleStub('Align'), onToggleDark: toggleTheme }; }
function styleStub(label: string): () => void { return () => { message.info(`${label} style command coming soon`); }; }
function toggleTheme(): void { const cur = document.documentElement.getAttribute('data-spreadsheet-theme') || 'light'; setTheme(cur === 'light' ? 'dark' : 'light'); dispatchThemeChanged(); }
function dispatchThemeChanged(): void { window.dispatchEvent(new CustomEvent('ss:theme-changed')); }
