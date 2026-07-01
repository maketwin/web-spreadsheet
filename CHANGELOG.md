# Changelog

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
