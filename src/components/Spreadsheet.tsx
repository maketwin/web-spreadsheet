import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useRef, type FC, type RefObject } from 'react';
import { CommandManager } from '../commands/CommandManager';
import { SetRangeValues } from '../commands/impl/SetRangeValues';
import { EventBus } from '../events/EventBus';
import { FormulaEngine } from '../formula/FormulaEngine';
import { PluginManager, type Plugin } from '../plugin/PluginManager';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import { Store } from '../store/Store';
import { applyStoredTheme, setTheme, type Theme } from '../theme';
import { BottomBar } from './BottomBar';
import { Toolbar } from './Toolbar';

import type { Cell } from '../types';

export type CellInput = Pick<Cell, 'text'> & Partial<Omit<Cell, 'text'>>;

export interface SpreadsheetOptions {
  readonly data?: readonly (readonly (CellInput | string)[])[];
  readonly theme?: Theme | false;
}

export interface SpreadsheetProps {
  readonly store: Store;
  readonly theme?: Theme | false | undefined;
}

export const SpreadsheetComponent: FC<SpreadsheetProps> = ({ store, theme }) => {
  const canvasRef = useCanvasRenderer(store);

  useTheme(theme);

  return (
    <div className="ss-root">
      <Toolbar onToggleDark={() => setTheme('dark')} />
      <div className="ss-canvas-wrap">
        <canvas ref={canvasRef} className="ss-canvas" />
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
    this.root.render(<SpreadsheetComponent store={this.store} theme={this.options.theme} />);
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

    const values = data.map((row) => row.map(normalizeCell));
    const maxCols = values.reduce((max, row) => Math.max(max, row.length), 0);
    if (values.length === 0 || maxCols === 0) return;

    this.cmdManager.execute(
      new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: maxCols - 1, values }),
    );
  }
}

function useCanvasRenderer(store: Store): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current === null) return undefined;

    const renderer = new CanvasRenderer({ canvas: canvasRef.current, store });
    return () => renderer.destroy();
  }, [store]);

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

function normalizeCell(cell: CellInput | string): Cell {
  if (typeof cell === 'string') return { text: cell };
  return cell;
}
