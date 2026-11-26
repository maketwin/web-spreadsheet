# Architecture

web-spreadsheet is organized as a modern TypeScript spreadsheet SDK with a small public facade, command-based writes, a reactive store, and canvas rendering.

## Layers

Dependencies are one-directional: the canvas renderer and the React shell depend on the store/formula/commands kernel — never the other way around. The kernel does not know any UI exists.

```text
[ User / Application ]
        ↓ uses
[ Entrances ]              src/index.ts (full SDK, incl. the React shell),
                           src/core.ts (headless core — zero antd/chart.js/
                           xlsx/dexie imports)
        ↓
[ UI / delivery ]          src/components/ (React shell — depends on everything
                           below), src/renderer/ (Canvas), src/io/, src/print/,
                           src/db/ (IndexedDB autosave), src/platform/
                           (mock takeover platform)
        ↓
[ Feature services ]       selection, conditional, validation, filter, find,
 (used by the renderer,    format, fill, clipboard, sparkline, outline,
 IO and components         namedrange, protection, analysis, data, keys,
 as needed)                freeze, charts (their pure modules)
        ↓
[ Kernel ]                 src/store/, src/formula/, src/commands/, src/events/
        ↓
[ Base ]                   src/types.ts, src/util/
                           (grid constants defined once in util/gridSize)
```

### Entrances

Two package entries:

- `web-spreadsheet` (`src/index.ts`) — the full SDK including the React UI stack (antd/chart.js stay runtime-external).
- `web-spreadsheet/core` (`src/core.ts`) — the headless entry: Store/FormulaEngine/CommandManager/EventBus/CanvasRenderer and services, with **zero** antd/chart.js/xlsx/dexie imports. Host apps rendering their own chrome compose from here.

The `Spreadsheet` facade accepts an element or element id, exposes core services, and delegates plugin installation through `.use(plugin)`.

### UI / delivery

`src/renderer/` contains virtual scrolling, dirty-region tracking, and canvas painting; it depends on the store and the feature services below. `src/components/` is the React UI shell around the canvas and depends on every band below it in the diagram. The renderer has been split along painter/geometry lines — `CanvasRenderer.ts` remains the orchestrator (render loop, scroll/blit, gestures, selection chrome) and delegates to focused modules:

```text
src/renderer/
├── CanvasRenderer.ts     Orchestrator: render loop, dirty regions, scroll/blit,
│                         pointer/touch gestures, selection chrome
├── GridGeometry.ts       Stateless hit-testing & coordinates: cellVP freeze-quadrant
│                         model, pointer→cell/column/row, viewport rects, chart anchors
├── AutoFilterChrome.ts   Filter-range header buttons: paint + hit-test (injected deps)
├── SparklinePainter.ts   Line/bar/win-loss sparklines (injected deps)
├── ConditionalPainter.ts Icon-set glyphs & data bars (pure ctx functions)
├── BorderPainter.ts      Logical border-edge dedup + segment styling (pure)
├── ResizeHandler.ts      Row/col resize drag (injected deps)
├── gestureConstants.ts   Shared touch-gesture timing (LONG_PRESS_MS/SLOP)
├── coordinate.ts         Forwards the grid constants + CanvasTheme + static coordinate helpers
├── VirtualScroller.ts / AxisIndex.ts   Scroll position & prefix-sum size index
└── DirtyRegionTracker.ts / selectionFill.ts / narrowOverflow.ts / richTextLayout.ts
```

`src/components/` after the EditorOverlay and Spreadsheet.tsx splits:

```text
src/components/
├── Spreadsheet.tsx         Orchestration root — state wiring, canvas gestures, dialog scheduling
├── keyboard.ts             Key → action dispatch table (pure function, injected via KeyboardContext)
├── spreadsheetActions.ts   Pure actions: AutoSum, menu shortcuts, chart/image/sparkline
│                           submits, name-box jump, hide/unhide, commitFormulaValue …
├── InteractionToolbar.tsx  Toolbar/format-painter interaction state machine
├── EditorOverlay.tsx       In-cell editor surface (plain / rich text / point mode)
├── formulaSync.ts          Cell ⇄ FormulaEngine sync (pure, unit-tested)
├── workbookInit.ts         Initial data / restore wiring (pure, unit-tested)
├── menu/                   MenuBar + dialog components
├── hooks/                  useClipboardSession, useMultiSelection, useCanvasRenderer
└── Toolbar / FormulaBar / BottomBar / StatusBar / ContextMenu / PrintPreview / …
```

`keyboard.ts` and `spreadsheetActions.ts` are React-free and unit-tested; `Spreadsheet.tsx` keeps only React wiring (handlers delegate into the two modules).

`src/platform/` is the mock takeover platform. ESLint rule ② keeps its core files at zero engine dependencies; engine access is confined to the 4 adapter files apiFunctions/replay/deps/PlatformPanel.

### Feature services

Between the UI band and the kernel sit the per-feature services, used by the renderer, IO and components as needed: `selection`, `conditional`, `validation`, `filter`, `find`, `format`, `fill`, `clipboard`, `sparkline`, `outline`, `namedrange`, `protection`, `analysis`, `data`, `keys`, `freeze`, and the pure modules of `charts` (types/geometry). Several of them depend on the formula engine (conditional/validation rule evaluation); conversely, commands pull in some of them (fill/filter/outline/charts helpers), so this band is a dependency web, not a strict tier.

### Kernel: Store / Formula / Commands / Events

`src/store/Store.ts` owns spreadsheet data and exposes reactive subscriptions plus serialization. `src/formula/` parses, evaluates, registers functions, tracks dependencies, and recalculates affected cells. `src/commands/` contains all write operations; commands mutate the store through `CommandManager`, so undo/redo and command events are centralized. `src/events/EventBus.ts` provides app-level events and wildcard subscriptions.

### Base: types / util

Below the kernel sit `src/types.ts` and `src/util/`. The grid geometry constants (`TOTAL_ROWS`, `TOTAL_COLS`, `ROW_HEIGHT`, `COL_WIDTH`, `ROW_HEADER_WIDTH`, `COL_HEADER_HEIGHT`) are defined once in `util/gridSize.ts` so the formula engine, commands and renderer can share them without reaching into the renderer; `renderer/coordinate` only forwards them. The grid is Excel's address space — 1,048,576 rows × 16,384 columns — and the governing principle is that **the address space is not an allocation**: nothing may loop over it, and every cost tracks stored cells / metadata entries instead of the selection or the used range's area. `util/limits.ts` holds the ceilings on materialising cells (`MAX_MATERIALIZED_CELLS`, `MAX_DENSE_RANGE_CELLS`). `util/` is a pure leaf of the graph now: its only value imports are util-internal (`./…`, `../util/…`) and `../types`, enforced by layer rule ④. Notations both worlds need live here too — `util/rangeNotation.ts` parses the A1 notation (`parseRange`) and the internal `"r,c"` / `"r1,c1:r2,c2"` notation (`parseInternalRange`) that named ranges, conditional formats, validations, charts, sparklines and the autofilter all key on.

### Scale: sparse storage, structural moves, and the harnesses that measure it

`src/store/SheetData.ts` keys cells by `r * TOTAL_COLS + c` in one Map and exposes stored-cell-only walks (`forEachCell`, `forEachCellInRect` — cost tracks min(rect area, stored cells)), `getCellCount` and `getUsedBounds`; `Store.limitToData` intersects a selection with the used bounds (falling back to the selection's first cell). Structural edits go through the move primitives `insertRows` / `insertCols` / `deleteRows` / `deleteCols` (`Store.ts`): the half-plane shifts in one piece and ONE `structure` event is delivered (`bulkSetCells` batches writes into one `cells` event); `replaceAll` emits workbook/sheet events only, no per-cell events. The structural commands and `RemoveDuplicatesCommand` build on these primitives — undo no longer keeps a whole-band snapshot, only the removed cells, rewritten formulas, features and the metadata band. Whole-column/whole-row selections write axis default styles (`RowMeta`/`ColMeta.styleId`, `commands/impl/SetAxisStyle.ts`; effective style resolves cell > row > column via `Store.getCellStyle`, frame-cached in the renderer's `cellStyle`). Two harnesses keep this honest and repeatable: `pnpm bench:scale` (Node benchmarks in `test/scale/*.bench.ts`, results under `coverage/scale-bench/`) and `pnpm e2e:scale` (`e2e/scale.spec.ts`, real-browser time-to-screen and longest main-thread block).

### What is not enforced yet

The bands above describe the intent; one edge does not match them cleanly and is honest about it:

- The kernel ↔ feature-services band is crossed in both directions: `commands/` value-imports `charts`, `sparkline`, `filter`, `outline`, `fill`, `selection` and `data` helpers, while `conditional`, `validation`, `filter` and `find` value-import `formula`. No lint rule pins this band yet.

`src/util/` used to be the other offender (`util/cell.ts` reached into the formula parser and number formatter, `util/rangeValues.ts` / `util/rowAutofit.ts` / `util/styleAutofit.ts` built on the command layer). That debt is cleared: formula-aware helpers moved beside their dependencies (`formula/refRewrite.ts`, `formula/precedents.ts`, `format/displayText.ts`), the command-backed ones moved up (`commands/rangeValues.ts`, `components/rowAutofit.ts`, `components/styleAutofit.ts`), and rule ④ now locks `util/` as the bottom of the graph — the dependency analysis reports zero upward value-dependencies out of `util/` and zero file-level value-import cycles.

Layer discipline is CI-enforced via `eslint.config.js` `no-restricted-imports`:

- **Rule ①** — `src/{store,formula,commands,events}` may not import React/UI/renderer/platform/io/db (nor antd/chart.js).
- **Rule ②** — `src/platform/` core files may not value-import the engine (type imports allowed; engine access confined to the 4 adapter files).
- **Rule ③** — outside `src/renderer/`, the six grid constants may not be imported from `renderer/coordinate`; they must come from `util/gridSize`.
- **Rule ④** — `src/util/**` value-imports only util-internal paths (`./…`, `../util/…`) and `../types`; type imports are unrestricted. This pins `util/` as the bottom layer of the graph.

## Data flow

1. User or app code interacts with the UI or `Spreadsheet` facade.
2. UI/facade creates a command such as `SetCellText` or `SetRangeValues`.
3. `CommandManager.execute()` runs the command and records it for undo/redo (with `{ record: false }` it applies the same batch without history, events or the protection check — for replay, imports and migrations).
4. The command mutates `Store` data.
5. `Store` subscribers and `EventBus` listeners observe the change.
6. Formula recalculation and renderer dirty-region updates react to the changed cells, then canvas rendering paints the current state.

## Extension points

- `spreadsheet.use(plugin)` installs a `Plugin` through `PluginManager`.
- `api.registerFunction(name, spec)` adds formula functions to the registry.
- `api.on(event, handler)` subscribes to events such as `csv:import`.
- New commands can be added under `src/commands/impl/` and executed through `CommandManager`.
- Store subscribers can observe low-level `StoreEvent` changes.
- Themes can extend the CSS variable tokens under `src/theme/`.

## Testing

- **Unit** — vitest + jsdom (`test/`): 295 files / 2,207 tests; `pnpm coverage` measures `src/` only (`coverage.include: ['src/**']`) and currently reports 87.1% statements / 82.7% branches / 80.5% functions (the React shell and the platform panel carry most of the uncovered lines; nothing enforces a threshold). Canvas paths use a stubbed 2D context; IndexedDB uses `fake-indexeddb`. CI runs the suite under coverage instrumentation on a shared runner, so every wall-clock assertion that guards a scale path leaves an order of magnitude over the local measurement and is paired with an exact guard (event or call counts); the measured numbers live in the opt-in `pnpm bench:scale`, not in the pass/fail suite.
- **E2E** — Playwright (`e2e/`, `pnpm e2e`) for the interaction surfaces jsdom cannot reach: right-click context menus, row/column-header menus, the sheet-tab menu, hover submenus and the dialogs behind them (chromium project), plus touch gestures on a 390×844 viewport (`chromium-touch` project: tap-select, long-press menus, one-finger pan, pinch zoom, sheet-tab long-press). The config reuses a dev server on `:5199` when one is running, otherwise boots one for the run. The real-browser scale experiment is opt-in (`pnpm e2e:scale`, its own `playwright.scale.config.ts` built on this one): it loads a million-cell workbook and measures time-to-screen and the longest main-thread block per action, so it is a measurement, not a CI smoke test.

## File map

| Path | Purpose |
| --- | --- |
| `src/store/` | Reactive spreadsheet data (sparse: numeric `r * TOTAL_COLS + c` keys, stored-cell-only walks, structural move primitives, 64-row merge bands), snapshots, deserialize |
| `src/commands/` | Command interface, command manager (undo/redo with a retained-cells memory budget), undo/redo operations; `rangeValues.ts` (composite range writes / clears), `impl/effectiveRange.ts` (selection shrinking for per-cell commands), `impl/SetAxisStyle.ts` (column/row default styles), `replayRegistry.ts` (replayable command whitelist) |
| `src/formula/` | Parser, evaluator, registry, dependency graph, formula engine; `refRewrite.ts` (formula reference rewriting/shifting), `precedents.ts` (formula dependency extraction, `RANGE_DEP_CELLS` rectangle deps), sparse-range evaluation over huge ranges |
| `src/renderer/` | Virtual scroller, dirty-region tracker, canvas renderer (frame-level effective-style cache) |
| `src/components/` | React shell: Spreadsheet root, keyboard dispatch, pure actions, editor overlay, menu/dialogs, toolbar chrome |
| `src/print/` | Print pipeline: used-range detection, page pagination, offscreen page painter, print DOM + `@page` injection |
| `src/io/` | xlsx round-trip (SheetJS write → fflate unpack → in-memory post-processors → compressed re-zip; sparse packed export with coordinate restore; `safeUnzip.ts` import ceilings), CSV import/export, PDF export |
| `src/outline/` `src/analysis/` `src/find/` | Row groups / pivot table / find & replace |
| `src/plugin/` | PluginManager, PluginAPI, public plugin contract, built-in plugins (CsvImportPlugin) |
| `src/events/` | EventBus with direct and wildcard subscriptions |
| `src/theme/` | CSS variables, light/dark theme utilities |
| `src/db/` | IndexedDB persistence (Dexie): v2 records (one JSON string per sheet, `WORKBOOK_FORMAT_VERSION = 2`), the chunked auto-save encoder (per-sheet dirty tracking, ~20k-cell chunks, flush on page exit) |
| `src/platform/` | Mock takeover platform: rule engine, timeline hub, operation recorder, replay, repro bundles, panel |
| `src/util/` | Shared leaf helpers: grid constants (`gridSize.ts` — Excel's address space), materialization ceilings (`limits.ts`), A1 + internal range notation (`rangeNotation.ts`), cell input normalization (`cell.ts`), rich text, merges, hyperlinks; the graph's bottom layer (rule ④) |
| `test/scale/` | `pnpm bench:scale` Node benchmarks (store / many sheets / formulas / I/O), results in `coverage/scale-bench/` |
| `e2e/` | Playwright e2e scripts (real-browser context menus, dialogs); `scale.spec.ts` (the `scale` project) measures time-to-screen and main-thread blocking at scale |
