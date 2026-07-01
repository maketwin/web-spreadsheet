import { createRoot, type Root } from 'react-dom/client';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { CommandManager } from '../commands/CommandManager';
import { SetCellText } from '../commands/impl/SetCellText';
import { SetRangeValues } from '../commands/impl/SetRangeValues';
import { EventBus } from '../events/EventBus';
import { FormulaEngine } from '../formula/FormulaEngine';
import { PluginManager, type Plugin } from '../plugin/PluginManager';
import { CanvasRenderer, type CellAddress } from '../renderer/CanvasRenderer';
import { Store } from '../store/Store';
import { applyStoredTheme, setTheme, type Theme } from '../theme';
import { alpha2num } from '../util/alphabet';
import { BottomBar } from './BottomBar';
import { Toolbar } from './Toolbar';

import type { Cell, CellValue, StoreEvent } from '../types';

const ROW_HEADER_WIDTH = 46;
const COL_HEADER_HEIGHT = 25;
const ROW_HEIGHT = 25;
const COL_WIDTH = 100;

export type CellInput = string | Partial<Cell>;

export interface SpreadsheetOptions {
  readonly data?: readonly (readonly CellInput[])[];
  readonly theme?: Theme | false;
}

export interface SpreadsheetProps {
  readonly store: Store;
  readonly cmdManager?: CommandManager;
  readonly theme?: Theme | false | undefined;
}

interface EditingCell extends CellAddress {
  readonly value: string;
}

export const SpreadsheetComponent: FC<SpreadsheetProps> = ({ store, cmdManager, theme }) => {
  const [selected, setSelected] = useState<CellAddress | null>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const canvasRef = useCanvasRenderer(store, selected);
  const inputRef = useRef<HTMLInputElement>(null);

  useTheme(theme);
  useEffect(() => inputRef.current?.focus(), [editing]);

  const startEditing = (cell: CellAddress, value = store.getCell(cell.r, cell.c)?.formula ?? store.getCell(cell.r, cell.c)?.text ?? ''): void => {
    setSelected(cell);
    setEditing({ ...cell, value });
  };

  const commitEditing = (value: string): void => {
    if (editing === null) return;
    setCellText(store, cmdManager, editing, value);
    setEditing(null);
  };

  return (
    <div className="ss-root" onKeyDown={(event) => handleKeyDown(event, selected, store, cmdManager, startEditing)}>
      <Toolbar onToggleDark={() => setTheme('dark')} />
      <div className="ss-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="ss-canvas"
          tabIndex={0}
          onClick={(event) => selectFromPointer(event, setSelected, setEditing)}
          onDoubleClick={(event) => editFromPointer(event, startEditing)}
        />
        {editing !== null && (
          <input
            ref={inputRef}
            className="ss-editor-overlay"
            style={editorStyle(editing)}
            value={editing.value}
            onChange={(event) => setEditing({ ...editing, value: event.target.value })}
            onBlur={(event) => commitEditing(event.target.value)}
            onKeyDown={(event) => handleEditorKey(event, commitEditing, () => setEditing(null))}
            aria-label="Cell editor"
          />
        )}
      </div>
      <BottomBar />
    </div>
  );
};

export class Spreadsheet {
  public readonly store = new Store();
  public readonly events = new EventBus();
  public readonly cmdManager = new CommandManager(this.store, this.events);
  public readonly formula = new FormulaEngine(this.store);
  private readonly plugins = new PluginManager(this);
  private readonly unsubscribeStore: () => void;
  private root: Root | null = null;
  private syncingFormulas = false;

  public constructor(
    private readonly mountRoot: HTMLElement,
    private readonly options: SpreadsheetOptions = {},
  ) {
    this.unsubscribeStore = this.store.subscribe((event) => this.onStoreEvent(event));
  }

  public mount(): void {
    this.loadInitialData();
    this.root = createRoot(this.mountRoot);
    this.root.render(<SpreadsheetComponent store={this.store} cmdManager={this.cmdManager} theme={this.options.theme} />);
  }

  public destroy(): void {
    this.root?.unmount();
    this.root = null;
    this.plugins.clear();
    this.unsubscribeStore();
  }

  public use(plugin: Plugin): this {
    this.plugins.use(plugin);
    return this;
  }

  public get rowCount(): number {
    return this.options.data?.length ?? 0;
  }

  private loadInitialData(): void {
    const data = this.options.data;
    if (data === undefined) return;

    const values = data.map((row) => row.map(normalizeCell));
    const maxCols = values.reduce((max, row) => Math.max(max, row.length), 0);
    if (values.length === 0 || maxCols === 0) return;

    this.cmdManager.execute(new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: maxCols - 1, values }));
    this.cmdManager.clear();
  }

  private onStoreEvent(event: StoreEvent): void {
    if (event.type !== 'cell' || this.syncingFormulas) return;

    this.syncingFormulas = true;
    this.syncCellFormula(event.r, event.c, event.cell);
    this.formula.onCellChanged(cellId(event.r, event.c));
    this.syncingFormulas = false;
  }

  private syncCellFormula(r: number, c: number, cell: Cell | undefined): void {
    const formula = formulaText(cell);
    const id = cellId(r, c);
    if (formula === undefined) {
      this.formula.removeFormula(id);
      return;
    }
    this.formula.setFormula(id, formula, formulaDependencies(formula));
  }
}

function useCanvasRenderer(store: Store, selectedCell: CellAddress | null): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current === null) return undefined;

    const options = selectedCell === null ? { canvas: canvasRef.current, store } : { canvas: canvasRef.current, store, selectedCell };
    const renderer = new CanvasRenderer(options);
    return () => renderer.destroy();
  }, [store, selectedCell]);

  return canvasRef;
}

function useTheme(theme: Theme | false | undefined): void {
  useEffect(() => {
    if (theme === false) return;
    if (theme === undefined) {
      applyStoredTheme();
      return;
    }
    setTheme(theme);
  }, [theme]);
}

function handleKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  selected: CellAddress | null,
  store: Store,
  cmdManager: CommandManager | undefined,
  startEditing: (cell: CellAddress, value?: string) => void,
): void {
  if (selected === null || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'Enter') startEditing(selected);
  if (event.key === 'Backspace' || event.key === 'Delete') setCellText(store, cmdManager, selected, '');
  if (event.key.length === 1) startEditing(selected, event.key);
}

function handleEditorKey(event: ReactKeyboardEvent<HTMLInputElement>, commit: (value: string) => void, cancel: () => void): void {
  if (event.key === 'Enter') commit(event.currentTarget.value);
  if (event.key === 'Escape') cancel();
}

function selectFromPointer(
  event: ReactMouseEvent<HTMLCanvasElement>,
  setSelected: (cell: CellAddress) => void,
  setEditing: (cell: EditingCell | null) => void,
): void {
  const cell = pointerCell(event);
  if (cell === null) return;
  setSelected(cell);
  setEditing(null);
  event.currentTarget.focus();
}

function editFromPointer(event: ReactMouseEvent<HTMLCanvasElement>, startEditing: (cell: CellAddress) => void): void {
  const cell = pointerCell(event);
  if (cell !== null) startEditing(cell);
}

function pointerCell(event: ReactMouseEvent<HTMLCanvasElement>): CellAddress | null {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left - ROW_HEADER_WIDTH;
  const y = event.clientY - rect.top - COL_HEADER_HEIGHT;
  if (x < 0 || y < 0) return null;
  return { r: Math.floor(y / ROW_HEIGHT), c: Math.floor(x / COL_WIDTH) };
}

function editorStyle(cell: CellAddress): CSSProperties {
  return {
    left: ROW_HEADER_WIDTH + cell.c * COL_WIDTH + 1,
    top: COL_HEADER_HEIGHT + cell.r * ROW_HEIGHT + 1,
    width: COL_WIDTH - 3,
    height: ROW_HEIGHT - 3,
  };
}

function setCellText(store: Store, cmdManager: CommandManager | undefined, cell: CellAddress, text: string): void {
  if (cmdManager === undefined) {
    store.setCell(cell.r, cell.c, normalizeCell({ text }));
    return;
  }
  cmdManager.execute(new SetCellText({ r: cell.r, c: cell.c, text }));
}

function normalizeCell(cell: CellInput): Cell {
  if (typeof cell === 'string') return cellWithValue(cell);
  const text = cell.text ?? cell.formula ?? '';
  const base: Cell = { ...cell, text };
  const formula = formulaText(base);
  if (formula !== undefined) return { ...base, formula };
  const value = valueFromText(text);
  return value === undefined ? base : { ...base, value };
}

function cellWithValue(text: string): Cell {
  const value = valueFromText(text);
  return value === undefined ? { text } : { text, value };
}

function valueFromText(text: string): CellValue | undefined {
  if (text.trim() === '' || text.startsWith('=')) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function formulaText(cell: Cell | undefined): string | undefined {
  if (cell?.formula !== undefined) return cell.formula;
  return cell?.text.startsWith('=') === true ? cell.text : undefined;
}

function cellId(r: number, c: number): string {
  return `${r},${c}`;
}

function formulaDependencies(formula: string): string[] {
  const deps = new Set<string>();
  const pattern = /([A-Za-z]+[1-9]\d*)(?::([A-Za-z]+[1-9]\d*))?/g;
  for (const match of formula.matchAll(pattern)) addDependencyMatch(deps, match);
  return [...deps];
}

function addDependencyMatch(deps: Set<string>, match: RegExpMatchArray): void {
  const start = match[1];
  if (start === undefined) return;
  const end = match[2];
  if (end === undefined) {
    deps.add(exprToCellId(start));
    return;
  }
  addRangeDependencies(deps, start, end);
}

function addRangeDependencies(deps: Set<string>, start: string, end: string): void {
  const a = exprToCoords(start);
  const b = exprToCoords(end);
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r += 1) {
    for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c += 1) deps.add(cellId(r, c));
  }
}

function exprToCellId(expr: string): string {
  const coords = exprToCoords(expr);
  return cellId(coords.r, coords.c);
}

function exprToCoords(expr: string): CellAddress {
  const match = expr.match(/^([A-Za-z]+)([1-9]\d*)$/);
  const col = match?.[1];
  const row = match?.[2];
  if (col === undefined || row === undefined) return { r: 0, c: 0 };
  return { r: Number(row) - 1, c: alpha2num(col.toUpperCase()) };
}
