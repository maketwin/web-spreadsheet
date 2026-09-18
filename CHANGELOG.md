# Changelog

## Unreleased

### New Features (Excel parity batch 2)

- **Charts & sparklines wired into the UI** — 插入 → 图表... opens the chart
  dialog (柱状/折线/饼) and creates a floating `ChartPanel` over the grid
  (data range = current selection); the panel's × deletes the chart as an
  undoable `RemoveChartCommand`. 插入 → 迷你图... anchors a sparkline at the
  active cell from a typed A1 range — the canvas renderer now paints
  line/bar/win-loss sparklines directly inside cells (new
  `sparkline/values.ts` series reader, blank/text cells skipped). The orphaned
  `ChartStubDialog` placeholder is gone.
- **CSV export** — 文件 → 导出 CSV writes the active sheet's used range as
  RFC 4180 CSV (CRLF rows, quoted fields, displayed values with number formats
  applied, so formulas and formatted numbers export as shown) with a UTF-8 BOM for Excel CJK round-trips; download name
  follows the sheet name. New module `io/CsvExporter.ts`.
- **Hide/unhide rows & columns** — Row/column header context menus gain
  隐藏 / 取消隐藏 (multi-select aware). Hidden rows/cols collapse to zero via
  new undoable `SetRowsHiddenCommand` / `SetColsHiddenCommand` (meta `hide`
  flag, previous metas restored on undo); the renderer collapses hidden
  columns exactly like filtered rows and skips their headers. 取消隐藏 is
  Excel-scoped: it restores the hidden rows/columns covered by the header
  selection (select across the collapsed gap, then unhide). Arrow-key and
  shift+arrow navigation skips hidden rows/columns like Excel
  (`selection/visibleStep.ts`).
- **Ctrl+Shift+L toggles AutoFilter** — Excel's 数据 → 筛选 shortcut; the
  toggle logic is shared with the data menu through `filter/toggleFilter.ts`.
  Also listed in the shortcuts dialog.
- **Editable name box** — The formula bar's cell label is now an input:
  type `A1`, `B2:D5` (either endpoint order), whole columns (`A`, `A:C`),
  whole rows (`3`, `3:5`), `Sheet2!A1` or a defined name and press Enter to
  jump (selection + sheet switch). New parser `selection/nameBox.ts` with
  grid clamping; Escape cancels.

### Technical Details

- New tests: CsvExporter (7), SetHidden (6), RemoveChart (3), nameBox (6),
  toggleFilter (2), sparkline/values (6); name-box assertions updated for the
  editable input
- Renderer: hidden-column collapse in `syncSizesFromStore`/`onStoreEvent`,
  header skip, cell-paint skip, and a `paintSparklines` pass per quadrant
- 828 tests passing; `tsc --noEmit` and eslint clean; GUI-verified end to end
  (chart insert/delete/undo, sparkline, hide/unhide rows+cols, filter toggle,
  name box jump, CSV export)

### New Features (Excel parity batch)

- **Find & Replace, rebuilt** — The dialog (Ctrl+F / Ctrl+H) gains match
  options (case-sensitive, match entire cell, regex with `$1` group
  references and `InvalidFindPatternError` reporting), a sheet/workbook
  scope selector (workbook search walks sheets from the active one), a
  clickable find-all result list with sheet-tagged addresses, and
  previous/next navigation. The canvas highlights every hit in yellow with
  an orange outline on the current match, clipped to the viewport, cleared
  on dialog close and on sheet switches. Replace All now counts
  occurrences (not cells, Excel-style), reports both counts, writes per
  sheet as single undoable commands (dense blocks = one undo step), and
  cross-sheet undo/redo restore to their original sheets
  (`SetRangeValues` records its execution-time sheet). Live 250 ms
  re-scan on query/option change keeps the current match selected.
- **Printing, rebuilt** — `文件 → 打印...` and `Ctrl/Cmd+P` open a real print
  preview instead of dumping the viewport through `window.print()`. The sheet
  is paginated from its used range (paper A4/Letter/A3, portrait/landscape,
  narrow/normal/wide margins, fit-to-width or custom 50–200% scale) and each
  page is rendered offscreen at 192 dpi with cell fills, conditional
  formatting/data bars, borders, merged cells, wrap/overflow text and number
  formats in a fixed light palette. Page boundaries avoid slicing merged
  cells when the merge fits a page. Printing injects `@page` rules plus a
  hidden `#ss-print-root` (one paper-sized div per page) and cleans up on
  `afterprint`; PDF export is the system dialog's "Save as PDF". New modules:
  `src/print/` (types, PrintPaginator, PrintPainter, PrintPipeline); the old
  dead `PrintPreview` placeholder is now the live preview dialog.
- **Formula point mode** — While typing a formula that awaits an operand
  (`=`, after `+`/`-`/`*`/`(`/`,`…), arrow keys and canvas clicks insert or
  move a cell reference instead of committing the edit. `F4` cycles `$`
  anchors on the reference at the caret (`A1` → `$A$1` → `A$1` → `$A1`).
  New module: `src/formula/pointMode.ts`.
- **Multi-selection (Ctrl+click/drag)** — Extra ranges are painted like the
  main selection (no active cell / fill handle) and tint matching row/column
  headers. Copy/cut from a multi-selection follows Excel rules (ranges must
  align by rows or columns, otherwise「不能对多重选定区域使用此命令」);
  `Delete` clears all areas as one undoable composite command.
- **Excel edit/keyboard semantics** — `Enter` commits and moves down (was:
  start edit); `F2`/double-click enter edit mode; `Backspace` clears and
  opens an empty editor; Enter/Tab cycle the active cell through a
  multi-cell selection; `PageUp`/`PageDown` move one zoom-aware viewport;
  End mode (End then arrow edge-jumps); `Ctrl+;` inserts the current date;
  `Ctrl+1` opens Format Cells; `Ctrl+PgUp/PgDn` switch sheets; `Alt+=`
  generates an AutoSum formula.
- **Session paste upgrade** — The in-app clipboard session now snapshots
  full cells: copy-paste shifts relative formula references to the target
  and keeps styles; cut-paste moves formulas verbatim; paste fully replaces
  target cells (no stale formula/value/style); exact-multiple targets tile
  with per-tile reference shifts. `SetRangeValues` gains a `CellPatch` type
  where explicit `undefined` clears a field.
- **Trackpad pinch zoom** (v1.5.0 post-release commit) — `Ctrl` + wheel
  (trackpad pinch) zooms the grid 50%–200% in 10% steps, like Excel.
- **Keyboard parity round 1** (v1.5.0 post-release commit) — Ctrl+arrow
  edge jumps, Ctrl+Home/End, two-stage Ctrl+A, fill/drag-copy shortcuts.
- **Clipboard session + marching ants** (v1.5.0 post-release commit) —
  Excel-style copy/cut session with animated ants replacing the selection
  border; Enter pastes once; Esc cancels.
- **Rendering engine overhaul** (v1.5.0 post-release commit) — AxisIndex
  lookups, dirty-rect invalidation, freeze-quadrant selection segments.

### Technical Details

- New tests: `pointMode.test.ts` (4), `sessionPaste.test.ts` (7)
- Docs updated: keyboard, formulas, io, rendering guides
- 519 tests passing; `tsc --noEmit` clean

## v1.5.0 (2026-07-02)

### New Features

- **React ErrorBoundary** — Any component render error now shows a friendly
  "出错了" error UI with a "刷新" button instead of a white screen. Wraps
  the entire Spreadsheet root. Uses antd `Result` component.

- **Accessibility (a11y) Improvements** — ARIA roles and labels added across
  the UI for screen reader support:
  - MenuBar: `role="menubar"` with `aria-orientation="horizontal"`
  - InteractionToolbar: `role="toolbar"` with `aria-label`
  - BottomBar sheet tabs: `role="tablist"` / `role="tab"` / `aria-selected`
  - Canvas: `aria-label="Spreadsheet canvas, use arrow keys to navigate"`
  - All Toolbar buttons have `aria-label` attributes
  - `:focus-visible` outline styles for keyboard navigation

- **Performance Benchmark** — VirtualScroller benchmark for 10,000 rows × 50
  columns. Tests verify `getVisibleRange()` < 0.5ms per call and simulated
  scroll > 50 FPS.

- **VitePress Documentation Site** — Full documentation site at
  https://maketwin.github.io/web-spreadsheet/ with:
  - Homepage with feature overview
  - Getting Started guide
  - API reference (Spreadsheet, Store, FormulaEngine, CommandManager, etc.)
  - Plugin development guide
  - GitHub Actions workflow for automatic deployment to GitHub Pages

### Technical Details

- New component: `src/components/ErrorBoundary.tsx` (class component, React 18)
- New tests: `ErrorBoundary.test.tsx`, `a11y.test.tsx`, `perf/10000-rows.test.ts`
- Added `vitepress@1` and `vitest-axe` devDependencies
- Added `docs:dev` / `docs:build` / `docs:preview` scripts
- 260 tests passing (7 new tests across 3 new test files)

## v1.1.0 (2026-07-01)

### New Features

- **Auto-save to IndexedDB** — Workbook data is automatically saved to IndexedDB
  with 1.5s debounce after every change. On startup, the last saved state is
  restored. File menu "Save" now writes to IndexedDB with status confirmation.

- **Real xlsx Import/Export** — Added SheetJS-powered import and export of
  real `.xlsx` files. File menu now includes "导入 xlsx" and "导出 xlsx"
  options alongside the existing JSON/CSV actions.

- **Sticky Bottom Sheet Tabs** — Sheet tabs now use `position: sticky; bottom: 0`
  so they stay visible at the bottom of the viewport when scrolling.

- **Status Bar** — New status bar below the canvas showing:
  - Filled cell count for the active sheet
  - Selection statistics (SUM, AVG, count) for multi-cell selections
  - Zoom percentage
  - Auto-save status indicator

- **IME-Aware Cell Editor** — The cell editor overlay now handles
  `compositionstart`/`compositionend` events for proper IME (Chinese input
  method) support. During composition, Enter finalizes the IME text rather
  than committing the cell value.

### Technical Details

- Added `dexie@4.4.4` for IndexedDB (`src/db/WorkbookDB.ts`, `src/db/autoSave.ts`)
- Added `xlsx@0.18.5` for real spreadsheet I/O (`src/io/XlsxExporter.ts`, `src/io/XlsxImporter.ts`)
- New component: `src/components/StatusBar.tsx`
- Added `fake-indexeddb@6.2.5` for testing IndexedDB in jsdom
- 204 tests passing (11 new tests across 4 new test files)

## 1.0.0 (2026-07-01)

### Features
- 4-layer architecture (facade/commands/store/renderer)
- Store with reactive subscribe + snapshot/deserialize
- EventBus with wildcard
- Command pattern with undo/redo (CommandManager)
- 5 concrete commands (SetCellText/SetRangeValues/SetRowHeight/SetColWidth/SetMerge)
- VirtualScroller + DirtyRegionTracker + CanvasRenderer
- 5 React components (Toolbar/BottomBar/Editor/Menu/Spreadsheet)
- Formula engine v1 with 32 functions
- Dependency graph for incremental recalculation
- FormulaEngine integration with Store
- Plugin system (PluginManager + PluginAPI)
- CsvImport example plugin
- Dark mode CSS variables
- 76 tests passing
- TypeScript strict + noUncheckedIndexedAccess

### Tech Stack
- Vite 5 + TypeScript 5 + vitest 2 + jsdom 25
- React 18 + antd 5
- ESM full stack

### Build Output
- es: ~950KB / 233KB gzipped
- umd: ~621KB / 196KB gzipped
