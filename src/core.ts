/**
 * Headless core entry (`web-spreadsheet/core`).
 *
 * Everything here is free of antd / @ant-design/icons / chart.js / xlsx /
 * dexie — no React components, no IndexedDB persistence, no xlsx round-trip.
 * Host apps that render their own chrome compose Store + CommandManager +
 * FormulaEngine + EventBus (and optionally CanvasRenderer) from this entry;
 * the full UI stack stays behind the package root (`web-spreadsheet`).
 *
 * Import surface mirrors src/index.ts minus the UI/IO chains. The eslint
 * layer rules (eslint.config.js) keep the underlying modules clean; this
 * file must not import from components/, charts/Floating*, io/xlsx*, or db/.
 */

// ── Data layer ──────────────────────────────────────────────────────────────
export { Store } from './store/Store';
export type { SerializedStore } from './store/Store';
export { SheetData } from './store/SheetData';
export type { Cell, CellValue, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from './types';

// ── Selection ───────────────────────────────────────────────────────────────
export { Range } from './selection/Range';
export type { RangeAddress } from './selection/Range';
export { currentRegion, excelSelectAll } from './selection/currentRegion';
export { parseNameBoxInput } from './selection/nameBox';
export { parseInternalRange, type InternalRange } from './util/rangeNotation';
export type { NameBoxTarget } from './selection/nameBox';
export { skipHiddenCells } from './selection/visibleStep';

// ── Formula engine ──────────────────────────────────────────────────────────
export { FormulaEngine, type FormulaEngineOptions } from './formula/FormulaEngine';
export { FormulaParser } from './formula/parser';
export { evaluate } from './formula/evaluator';
export { RANGE_DEP_CELLS } from './formula/precedents';
export { registry, FunctionRegistry } from './formula/registry';
export type { FunctionSpec, FunctionContext } from './formula/registry';
export { isSparseRange } from './formula/types';
export type { AstNode, CellResolver, FormulaValue, SparseRangeValue } from './formula/types';
export { DependencyGraph } from './formula/dependency';
/** Keeps the engine in step with store events — attach once, before the first edit. */
export { createFormulaSync } from './formula/formulaSync';

// ── Commands (all writes, undo/redo) ────────────────────────────────────────
export { CommandManager, MAX_HISTORY_RETAINED_CELLS } from './commands/CommandManager';
export type { ExecuteOptions, HistoryEntry } from './commands/CommandManager';
export { isReplayableKind, buildReplayableCommand, REPLAYABLE_KINDS, type ReplayableCommandKind } from './commands/replayRegistry';
export { InsertRowCommand } from './commands/impl/InsertRow';
export { InsertColCommand } from './commands/impl/InsertCol';
export { DeleteRowCommand } from './commands/impl/DeleteRow';
export { DeleteColCommand } from './commands/impl/DeleteCol';
export { SetCellStyleCommand } from './commands/impl/SetCellStyle';
export { SetRangeStyleCommand } from './commands/impl/SetRangeStyle';
export { SetRangeBorderCommand, edgesForPreset } from './commands/impl/SetRangeBorder';
export type { BorderPreset, BorderLine } from './commands/impl/SetRangeBorder';
export { SetAxisStyleCommand, ClearAxisStyleCommand, axisSelectionOf, reservedAxisStyleId } from './commands/impl/SetAxisStyle';
export type { SetAxisStyleArgs, ClearAxisStyleArgs, StyleAxis, AxisSelection } from './commands/impl/SetAxisStyle';
export { SetConditionalFormatCommand } from './commands/impl/SetConditionalFormat';
export { CreateChartCommand } from './commands/impl/CreateChart';
export { RemoveChartCommand } from './commands/impl/RemoveChart';
export { SetChartAnchorCommand } from './commands/impl/SetChartAnchor';
export { SetRowsHiddenCommand, SetColsHiddenCommand } from './commands/impl/SetHidden';
export { SetValidationCommand } from './commands/impl/SetValidation';
export { SetSparklineCommand } from './commands/impl/SetSparkline';

// ── Events / plugins ────────────────────────────────────────────────────────
export { EventBus } from './events/EventBus';
export type { EventHandler, WildcardPayload, SpreadsheetEvents, EventPayload } from './events/EventBus';
export { PluginAPI, type PluginHost } from './plugin/PluginAPI';
export { PluginManager } from './plugin/PluginManager';
export type { Plugin } from './plugin/PluginManager';
export { CsvImportPlugin } from './plugin/CsvImportPlugin';

// ── Canvas renderer (no React) ──────────────────────────────────────────────
export { CanvasRenderer, canvasPointToCell, canvasPointToHeader } from './renderer/CanvasRenderer';
export type { CanvasRendererOptions, CellAddress } from './renderer/CanvasRenderer';
export { DirtyRegionTracker } from './renderer/DirtyRegionTracker';
export type { Rect } from './renderer/DirtyRegionTracker';
export { VirtualScroller } from './renderer/VirtualScroller';
export type { PixelPosition, VisibleRange, VirtualScrollerOptions } from './renderer/VirtualScroller';

// ── Services ────────────────────────────────────────────────────────────────
export { ClipboardService } from './clipboard/ClipboardService';
export { KeyboardHandler } from './keys/KeyboardHandler';
export { applyStoredTheme, getTheme, setTheme, THEMES } from './theme';
export type { Theme } from './theme';
export { ConditionalService } from './conditional/ConditionalService';
export type { ConditionalOverlay, ConditionalRule } from './conditional/ConditionalRule';
export { DataValidationService, type ValidationContext } from './validation/DataValidationService';
export type { ValidationRule, ValidationType } from './validation/types';
export { FilterService } from './filter/FilterService';
export { toggleAutoFilterCommand } from './filter/toggleFilter';
export { NamedRangeService } from './namedrange/NamedRangeService';
export type { NamedRangeDef } from './namedrange/types';
export { hashPassword, protectSheet, unprotectSheet, verifyPassword } from './protection/SheetProtection';
export type { SheetProtectionState } from './protection/SheetProtection';

// ── Charts (spec & geometry only — FloatingChart stays in the UI entry) ─────
export type { ChartSpec, ChartType, ChartAnchor, ChartAnchorEdge } from './charts/types';
export type { SparklineSpec, SparklineType } from './sparkline/types';
export { sparklineValues, parseInternalRangeKey } from './sparkline/values';

// ── CSV (hand-rolled; xlsx round-trip stays in the UI entry via io/) ────────
export { exportCsv, exportCsvBlob, csvQuote, CsvRangeTooLargeError } from './io/CsvExporter';

// ── Ceilings on materialising cells (paste tiling, fill, range references) ─
export { MAX_MATERIALIZED_CELLS, MAX_DENSE_RANGE_CELLS } from './util/limits';

// ── Sheet-level view state that travels with the workbook ──────────────────
export type { CellRect, MergeRect, SheetFreeze } from './store/SheetData';
