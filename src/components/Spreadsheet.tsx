import { message } from 'antd';
import { createRoot, type Root } from 'react-dom/client';
import {
  useCallback,
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
import { CanvasRenderer, canvasPointToCell, type CanvasRendererOptions, type CellAddress } from '../renderer/CanvasRenderer';
import { Store } from '../store/Store';
import { applyStoredTheme, setTheme, type Theme } from '../theme';
import { cellFromText, cellId, formulaDependencies, formulaText, normalizeCellInput, type CellInput as CellDataInput } from '../util/cell';
import { BottomBar } from './BottomBar';
import { Toolbar } from './Toolbar';

import type { Cell, StoreEvent } from '../types';

const ROW_HEADER_WIDTH = 46;
const COL_HEADER_HEIGHT = 25;
const ROW_HEIGHT = 25;
const COL_WIDTH = 100;

export type CellInput = CellDataInput;

export interface SpreadsheetOptions {
  readonly data?: readonly (readonly CellInput[])[];
  readonly theme?: Theme | false;
}

export interface SpreadsheetProps {
  readonly store: Store;
  readonly cmdManager?: CommandManager;
  readonly formulaEngine?: FormulaEngine;
  readonly theme?: Theme | false | undefined;
}

interface EditingCell extends CellAddress {
  readonly value: string;
}

export const SpreadsheetComponent: FC<SpreadsheetProps> = ({ store, cmdManager, formulaEngine, theme }) => {
  const [selected, setSelected] = useState<CellAddress | null>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCellClick = useCallback((cell: CellAddress) => {
    setSelected(cell);
    setEditing(null);
  }, []);
  const canvasRef = useCanvasRenderer(store, selected, onCellClick);

  useTheme(theme);
  useFormulaSync(store, formulaEngine);
  useEffect(() => inputRef.current?.focus(), [editing]);

  const startEditing = (cell: CellAddress, value = cellEditValue(store, cell)): void => {
    setSelected(cell);
    setEditing({ ...cell, value });
  };
  const commitEditing = (value: string): void => {
    if (editing === null) return;
    setCellText(store, cmdManager, editing, value);
    setEditing(null);
  };

  return (
    <div className="ss-root">
      <Toolbar {...toolbarActions()} />
      <div className="ss-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="ss-canvas"
          tabIndex={0}
          onKeyDown={(event) => handleCanvasKeyDown(event, selected, store, cmdManager, startEditing)}
          onDoubleClick={(event) => editFromPointer(event, startEditing)}
        />
        {editing !== null && <EditorOverlay refEl={inputRef} editing={editing} setEditing={setEditing} commit={commitEditing} />}
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
  private root: Root | null = null;

  public constructor(
    private readonly mountRoot: HTMLElement,
    private readonly options: SpreadsheetOptions = {},
  ) {}

  public mount(): void {
    this.loadInitialData();
    this.root = createRoot(this.mountRoot);
    this.root.render(<SpreadsheetComponent store={this.store} cmdManager={this.cmdManager} formulaEngine={this.formula} theme={this.options.theme} />);
  }

  public destroy(): void {
    this.root?.unmount();
    this.root = null;
    this.plugins.clear();
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

    const values = data.map((row) => row.map(normalizeCellInput));
    const maxCols = values.reduce((max, row) => Math.max(max, row.length), 0);
    if (values.length === 0 || maxCols === 0) return;

    this.cmdManager.execute(new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: maxCols - 1, values }));
    this.cmdManager.clear();
    syncExistingFormulas(this.store, this.formula);
  }
}

interface EditorOverlayProps {
  readonly refEl: RefObject<HTMLInputElement | null>;
  readonly editing: EditingCell;
  readonly setEditing: (cell: EditingCell | null) => void;
  readonly commit: (value: string) => void;
}

const EditorOverlay: FC<EditorOverlayProps> = ({ refEl, editing, setEditing, commit }) => (
  <input
    ref={refEl}
    className="ss-editor-overlay"
    style={editorStyle(editing)}
    value={editing.value}
    onChange={(event) => setEditing({ ...editing, value: event.target.value })}
    onBlur={(event) => commit(event.target.value)}
    onKeyDown={(event) => handleEditorKey(event, commit, () => setEditing(null))}
    aria-label="Cell editor"
  />
);

function useCanvasRenderer(store: Store, selectedCell: CellAddress | null, onCellClick: (cell: CellAddress) => void): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const clickRef = useRef(onCellClick);
  clickRef.current = onCellClick;

  useEffect(() => {
    if (canvasRef.current === null) return undefined;
    const options = rendererOptions(canvasRef.current, store, selectedCell, clickRef);
    const renderer = new CanvasRenderer(options);
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [store]);

  useEffect(() => rendererRef.current?.setSelectedCell(selectedCell ?? undefined), [selectedCell]);
  return canvasRef;
}

function rendererOptions(
  canvas: HTMLCanvasElement,
  store: Store,
  selectedCell: CellAddress | null,
  clickRef: RefObject<(cell: CellAddress) => void>,
): CanvasRendererOptions {
  const onCellClick = (cell: CellAddress): void => clickRef.current?.(cell);
  if (selectedCell === null) return { canvas, store, onCellClick };
  return { canvas, store, selectedCell, onCellClick };
}

function useTheme(theme: Theme | false | undefined): void {
  useEffect(() => {
    if (theme === false) return;
    if (theme === undefined) applyStoredTheme();
    else setTheme(theme);
    dispatchThemeChanged();
  }, [theme]);
}

function useFormulaSync(store: Store, formulaEngine: FormulaEngine | undefined): void {
  const syncing = useRef(false);
  useEffect(() => {
    if (formulaEngine === undefined) return undefined;
    const sub = store.subscribe((event) => syncFormulaEvent(event, formulaEngine, syncing));
    return () => sub();
  }, [store, formulaEngine]);
}

function syncFormulaEvent(event: StoreEvent, engine: FormulaEngine, syncing: RefObject<boolean>): void {
  if (event.type !== 'cell' || syncing.current) return;
  syncing.current = true;
  syncCellFormula(engine, event.r, event.c, event.cell);
  engine.onCellChanged(cellId(event.r, event.c));
  syncing.current = false;
}

function handleCanvasKeyDown(
  event: ReactKeyboardEvent<HTMLCanvasElement>,
  selected: CellAddress | null,
  store: Store,
  cmdManager: CommandManager | undefined,
  startEditing: (cell: CellAddress, value?: string) => void,
): void {
  if (selected === null || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'Enter' || event.key === 'F2') {
    event.preventDefault();
    startEditing(selected);
  } else if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
    setCellText(store, cmdManager, selected, '');
  } else if (event.key.length === 1) {
    event.preventDefault();
    setCellText(store, cmdManager, selected, event.key);
    startEditing(selected, event.key);
  }
}

function handleEditorKey(event: ReactKeyboardEvent<HTMLInputElement>, commit: (value: string) => void, cancel: () => void): void {
  if (event.key === 'Enter') commit(event.currentTarget.value);
  if (event.key === 'Escape') cancel();
}

function editFromPointer(event: ReactMouseEvent<HTMLCanvasElement>, startEditing: (cell: CellAddress) => void): void {
  const cell = canvasPointToCell(event.currentTarget, event.clientX, event.clientY);
  if (cell !== null) startEditing(cell);
}

function editorStyle(cell: CellAddress): CSSProperties {
  return { left: ROW_HEADER_WIDTH + cell.c * COL_WIDTH + 1, top: COL_HEADER_HEIGHT + cell.r * ROW_HEIGHT + 1, width: COL_WIDTH - 3, height: ROW_HEIGHT - 3 };
}

function setCellText(store: Store, cmdManager: CommandManager | undefined, cell: CellAddress, text: string): void {
  if (cmdManager === undefined) store.setCell(cell.r, cell.c, cellFromText(store.getCell(cell.r, cell.c), text));
  else cmdManager.execute(new SetCellText({ r: cell.r, c: cell.c, text }));
}

function cellEditValue(store: Store, cell: CellAddress): string {
  const current = store.getCell(cell.r, cell.c);
  return current?.formula ?? current?.text ?? '';
}

function syncExistingFormulas(store: Store, engine: FormulaEngine): void {
  store.getCells().forEach(([id, cell]) => {
    const formula = formulaText(cell);
    if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula));
  });
}

function syncCellFormula(engine: FormulaEngine, r: number, c: number, cell: Cell | undefined): void {
  const formula = formulaText(cell);
  const id = cellId(r, c);
  if (formula === undefined) engine.removeFormula(id);
  else engine.setFormula(id, formula, formulaDependencies(formula));
}

function toolbarActions(): React.ComponentProps<typeof Toolbar> {
  return { onBold: styleStub('Bold'), onItalic: styleStub('Italic'), onUnderline: styleStub('Underline'), onFontSize: styleStub('Font Size'), onAlign: styleStub('Align'), onToggleDark: toggleTheme };
}

function styleStub(label: string): () => void {
  return () => {
    message.info(`${label} style command coming soon`);
  };
}

function toggleTheme(): void {
  const cur = document.documentElement.getAttribute('data-spreadsheet-theme') || 'light';
  setTheme(cur === 'light' ? 'dark' : 'light');
  dispatchThemeChanged();
}

function dispatchThemeChanged(): void {
  window.dispatchEvent(new CustomEvent('ss:theme-changed'));
}
