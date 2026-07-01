import { Spreadsheet as SpreadsheetImpl, type SpreadsheetOptions } from './components/Spreadsheet';

export { Toolbar } from './components/Toolbar';
export type { ToolbarProps } from './components/Toolbar';
export { BottomBar } from './components/BottomBar';
export type { BottomBarProps } from './components/BottomBar';
export { Editor } from './components/Editor';
export type { EditorProps } from './components/Editor';
export { Menu } from './components/Menu';
export type { MenuProps } from './components/Menu';
export { MenuBar } from './components/menu/MenuBar';
export type { MenuBarProps } from './components/menu/MenuBar';
export { InsertRowCommand } from './commands/impl/InsertRow';
export { InsertColCommand } from './commands/impl/InsertCol';
export { DeleteRowCommand } from './commands/impl/DeleteRow';
export { DeleteColCommand } from './commands/impl/DeleteCol';
export { SetCellStyleCommand } from './commands/impl/SetCellStyle';
export { SetRangeStyleCommand } from './commands/impl/SetRangeStyle';
export { SpreadsheetComponent } from './components/Spreadsheet';
export type { CellInput, SpreadsheetOptions, SpreadsheetProps } from './components/Spreadsheet';
export { DependencyGraph } from './formula/dependency';
export { evaluate } from './formula/evaluator';
export { FormulaEngine } from './formula/FormulaEngine';
export { FormulaParser } from './formula/parser';
export { registry } from './formula/registry';
export type { FunctionSpec } from './formula/registry';
export type { AstNode, CellResolver, FormulaValue } from './formula/types';
export { EventBus } from './events/EventBus';
export type { EventHandler, WildcardPayload } from './events/EventBus';
export { PluginAPI } from './plugin/PluginAPI';
export { PluginManager } from './plugin/PluginManager';
export type { Plugin } from './plugin/PluginManager';
export { CsvImportPlugin } from './plugins/CsvImportPlugin';
export { CanvasRenderer, canvasPointToCell, canvasPointToHeader } from './renderer/CanvasRenderer';
export type { CanvasRendererOptions, CellAddress } from './renderer/CanvasRenderer';
export type { RangeAddress } from './selection/Range';
export { DirtyRegionTracker } from './renderer/DirtyRegionTracker';
export type { Rect } from './renderer/DirtyRegionTracker';
export { VirtualScroller } from './renderer/VirtualScroller';
export type { PixelPosition, VisibleRange, VirtualScrollerOptions } from './renderer/VirtualScroller';
export { Store } from './store/Store';
export { SheetData } from './store/SheetData';
export { Range } from './selection/Range';
export { ClipboardService } from './clipboard/ClipboardService';
export { KeyboardHandler } from './keys/KeyboardHandler';
export type { SerializedStore } from './store/Store';
export { applyStoredTheme, getTheme, setTheme, THEMES } from './theme';
export type { Theme } from './theme';
export type { Cell, CellValue, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from './types';

export class Spreadsheet extends SpreadsheetImpl {
  public constructor(root: HTMLElement | string, options: SpreadsheetOptions = {}) {
    super(resolveRoot(root), options);
  }
}

function resolveRoot(root: HTMLElement | string): HTMLElement {
  if (typeof root !== 'string') return root;

  const element = document.getElementById(root);
  if (element === null) throw new Error(`Spreadsheet root element not found: ${root}`);
  return element;
}
