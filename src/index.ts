import { Spreadsheet as SpreadsheetImpl, type SpreadsheetOptions } from './components/Spreadsheet';

export { Toolbar } from './components/Toolbar';
export type { ToolbarProps } from './components/Toolbar';
export { BottomBar } from './components/BottomBar';
export type { BottomBarProps } from './components/BottomBar';
export { Editor } from './components/Editor';
export type { EditorProps } from './components/Editor';
export { Menu } from './components/Menu';
export type { MenuProps } from './components/Menu';
export { SpreadsheetComponent } from './components/Spreadsheet';
export type { CellInput, SpreadsheetOptions, SpreadsheetProps } from './components/Spreadsheet';
export { EventBus } from './events/EventBus';
export type { EventHandler, WildcardPayload } from './events/EventBus';
export { CanvasRenderer } from './renderer/CanvasRenderer';
export type { CanvasRendererOptions } from './renderer/CanvasRenderer';
export { DirtyRegionTracker } from './renderer/DirtyRegionTracker';
export type { Rect } from './renderer/DirtyRegionTracker';
export { VirtualScroller } from './renderer/VirtualScroller';
export type { PixelPosition, VisibleRange, VirtualScrollerOptions } from './renderer/VirtualScroller';
export { Store } from './store/Store';
export type { SerializedStore } from './store/Store';
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
