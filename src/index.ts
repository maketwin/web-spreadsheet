// Component styles (layout rules + theme variable tokens). The library build
// extracts this into dist/web-spreadsheet.css; package consumers import the
// published file: `import 'web-spreadsheet/styles.css'`. The headless `./core`
// entry has no CSS.
import './styles/spreadsheet.css';
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
export { SetRangeBorderCommand, edgesForPreset } from './commands/impl/SetRangeBorder';
export type { BorderPreset, BorderLine } from './commands/impl/SetRangeBorder';
export { SpreadsheetComponent } from './components/Spreadsheet';
export { ErrorBoundary } from './components/ErrorBoundary';
export type { CellInput, SpreadsheetOptions, SpreadsheetProps, StorageOptions } from './components/Spreadsheet';
export { DependencyGraph } from './formula/dependency';
export { evaluate } from './formula/evaluator';
export { FormulaEngine } from './formula/FormulaEngine';
export { FormulaParser } from './formula/parser';
export { registry } from './formula/registry';
export type { FunctionSpec } from './formula/registry';
export type { AstNode, CellResolver, FormulaValue } from './formula/types';
export { EventBus } from './events/EventBus';
export type { EventHandler, WildcardPayload } from './events/EventBus';
export { PluginAPI, type PluginHost } from './plugin/PluginAPI';
export { PluginManager } from './plugin/PluginManager';
export type { Plugin } from './plugin/PluginManager';
export { CsvImportPlugin } from './plugin/CsvImportPlugin';
export { CanvasRenderer, canvasPointToCell, canvasPointToHeader } from './renderer/CanvasRenderer';
export type { CanvasRendererOptions, CellAddress } from './renderer/CanvasRenderer';
export type { RangeAddress } from './selection/Range';
export { DirtyRegionTracker } from './renderer/DirtyRegionTracker';
export type { Rect } from './renderer/DirtyRegionTracker';
export { VirtualScroller } from './renderer/VirtualScroller';
export type { PixelPosition, VisibleRange, VirtualScrollerOptions } from './renderer/VirtualScroller';
export { Store } from './store/Store';
export { SheetData } from './store/SheetData';
export type { SheetFreeze } from './store/SheetData';
export { Range } from './selection/Range';
export { currentRegion, excelSelectAll } from './selection/currentRegion';
export { ClipboardService } from './clipboard/ClipboardService';
export { KeyboardHandler } from './keys/KeyboardHandler';
export type { SerializedStore } from './store/Store';
export { applyStoredTheme, getTheme, setTheme, THEMES } from './theme';
export type { Theme } from './theme';
export type { Cell, CellValue, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from './types';
export { ConditionalService } from './conditional/ConditionalService';
export type { ConditionalOverlay, ConditionalRule } from './conditional/ConditionalRule';
export { SetConditionalFormatCommand } from './commands/impl/SetConditionalFormat';
export { CreateChartCommand } from './commands/impl/CreateChart';
export { RemoveChartCommand } from './commands/impl/RemoveChart';
export { SetChartAnchorCommand } from './commands/impl/SetChartAnchor';
export { SetRowsHiddenCommand, SetColsHiddenCommand } from './commands/impl/SetHidden';
export type { ChartSpec, ChartType, ChartAnchor, ChartAnchorEdge } from './charts/types';
export { FloatingChart } from './charts/FloatingChart';
export type { FloatingChartProps } from './charts/FloatingChart';
export { exportCsv, exportCsvBlob, csvQuote } from './io/CsvExporter';
export { parseNameBoxInput } from './selection/nameBox';
export { skipHiddenCells } from './selection/visibleStep';
export type { NameBoxTarget } from './selection/nameBox';
export { toggleAutoFilterCommand } from './filter/toggleFilter';
export { sparklineValues, parseInternalRangeKey } from './sparkline/values';
export { SetValidationCommand } from './commands/impl/SetValidation';
export { DataValidationService, type ValidationContext } from './validation/DataValidationService';
export type { ValidationRule, ValidationType } from './validation/types';
export { FilterService } from './filter/FilterService';
export { Sparkline } from './sparkline/Sparkline';
export type { SparklineProps } from './sparkline/Sparkline';
export type { SparklineSpec, SparklineType } from './sparkline/types';
export { SetSparklineCommand } from './commands/impl/SetSparkline';
export { NamedRangeService } from './namedrange/NamedRangeService';
export type { NamedRangeDef } from './namedrange/types';
export { hashPassword, protectSheet, unprotectSheet, verifyPassword } from './protection/SheetProtection';
export type { SheetProtectionState } from './protection/SheetProtection';
// IndexedDB persistence: hosts that seed initial data (options.data/options.sheets)
// opt the SDK out of its own restore — they can still read the last autosave
// and apply it themselves.
export { loadWorkbook, deleteWorkbook } from './db/WorkbookDB';
export { DEFAULT_ID } from './db/WorkbookDB';

export class Spreadsheet extends SpreadsheetImpl {
  public constructor(root: HTMLElement | string, options: SpreadsheetOptions = {}) {
    super(resolveRoot(root), options);
  }
}

/**
 * Resolves the mount target: an element, an element id (`'app'`), or a CSS
 * selector (`'#app'`, `'.sheet-host'`). A bare id is looked up first so that
 * pre-selector callers keep resolving to the same element.
 */
function resolveRoot(root: HTMLElement | string): HTMLElement {
  if (typeof root !== 'string') return root;

  const element = document.getElementById(root) ?? querySelector(root);
  if (element === null) {
    throw new Error(
      `Spreadsheet 挂载根元素未找到：文档中既没有 id 为 "${root}" 的元素，也没有匹配选择器 "${root}" 的元素。`
      + '请传入已存在于文档中的 HTMLElement、元素 id（如 "app"）或 CSS 选择器（如 "#app"、".container"）。',
    );
  }
  if (!(element instanceof HTMLElement)) {
    throw new Error(
      `Spreadsheet 挂载根元素必须是 HTMLElement："${root}" 匹配到的是 <${element.tagName.toLowerCase()}> 元素。`,
    );
  }
  return element;
}

/** `document.querySelector`, with an invalid selector reported as a plain-language error. */
function querySelector(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SyntaxError') {
      throw new Error(
        `Spreadsheet 挂载根元素参数无效："${selector}" 不是合法的 CSS 选择器，也不是文档中存在的元素 id。`,
      );
    }
    throw error;
  }
}
