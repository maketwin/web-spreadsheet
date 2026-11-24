# Architecture

web-spreadsheet is organized as a modern TypeScript spreadsheet SDK with a small public facade, command-based writes, a reactive store, and canvas rendering.

## 4 Layers

```text
[ User / Application ]
        ↓
[ Layer 4: API / Facade ]      src/index.ts, src/components/Spreadsheet.tsx
        ↓
[ Layer 3: Commands ]          src/commands/
        ↓
[ Layer 2: Store / Formula ]   src/store/, src/formula/, src/events/
        ↓
[ Layer 1: Renderer / UI ]     src/renderer/, src/components/
        ↓
[ Canvas / DOM ]
```

### Layer 1: Renderer / UI

`src/renderer/` contains virtual scrolling, dirty-region tracking, and canvas painting. `src/components/` is the React UI shell around the canvas. The renderer has been split along painter/geometry lines — `CanvasRenderer.ts` remains the orchestrator (render loop, scroll/blit, gestures, selection chrome) and delegates to focused modules:

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
├── coordinate.ts         Grid constants + CanvasTheme + static coordinate helpers
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

### Layer 2: Store / Formula / Events

`src/store/Store.ts` owns spreadsheet data and exposes reactive subscriptions plus serialization. `src/formula/` parses, evaluates, registers functions, tracks dependencies, and recalculates affected cells. `src/events/EventBus.ts` provides app-level events and wildcard subscriptions.

### Layer 3: Commands

`src/commands/` contains all write operations. Commands mutate the store through `CommandManager`, so undo/redo and command events are centralized.

### Layer 4: API / Facade

Two package entries:

- `web-spreadsheet` (`src/index.ts`) — the full SDK including the React UI stack (antd/chart.js stay runtime-external).
- `web-spreadsheet/core` (`src/core.ts`) — the headless entry: Store/FormulaEngine/CommandManager/EventBus/CanvasRenderer and services, with **zero** antd/chart.js/xlsx/dexie imports. Host apps rendering their own chrome compose from here.

The `Spreadsheet` facade accepts an element or element id, exposes core services, and delegates plugin installation through `.use(plugin)`.

Layer discipline is CI-enforced via `eslint.config.js` `no-restricted-imports`: `src/{store,formula,commands,events}` may not import React/UI/renderer/platform/io/db, and `src/platform/` core files may not value-import the engine (type imports allowed; engine access is confined to the 4 adapter files apiFunctions/replay/deps/PlatformPanel).

## Data flow

1. User or app code interacts with the UI or `Spreadsheet` facade.
2. UI/facade creates a command such as `SetCellText` or `SetRangeValues`.
3. `CommandManager.execute()` runs the command and records it for undo/redo.
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

- **Unit** — vitest + jsdom (`test/`): 194 files / 1309 tests; `pnpm coverage` reports ≈92% on `src/`. Canvas paths use a stubbed 2D context; IndexedDB uses `fake-indexeddb`.
- **E2E** — Playwright (`e2e/`, `pnpm e2e`) for the interaction surfaces jsdom cannot reach: right-click context menus, row/column-header menus, the sheet-tab menu, hover submenus and the dialogs behind them (chromium project), plus touch gestures on a 390×844 viewport (`chromium-touch` project: tap-select, long-press menus, one-finger pan, pinch zoom, sheet-tab long-press). The config reuses a dev server on `:5199` when one is running, otherwise boots one for the run.

## File map

| Path | Purpose |
| --- | --- |
| `src/store/` | Reactive spreadsheet data, snapshots, deserialize |
| `src/commands/` | Command interface, command manager, undo/redo operations |
| `src/formula/` | Parser, evaluator, registry, dependency graph, formula engine |
| `src/renderer/` | Virtual scroller, dirty-region tracker, canvas renderer |
| `src/components/` | React shell: Spreadsheet root, keyboard dispatch, pure actions, editor overlay, menu/dialogs, toolbar chrome |
| `src/print/` | Print pipeline: used-range detection, page pagination, offscreen page painter, print DOM + `@page` injection |
| `src/io/` | xlsx round-trip (SheetJS + style/chart/comment XML), CSV import/export, PDF export |
| `src/outline/` `src/analysis/` `src/find/` | Row groups / pivot table / find & replace |
| `src/plugin/` | PluginManager, PluginAPI, public plugin contract, built-in plugins (CsvImportPlugin) |
| `src/events/` | EventBus with direct and wildcard subscriptions |
| `src/theme/` | CSS variables, light/dark theme utilities |
| `e2e/` | Playwright e2e scripts (real-browser context menus, dialogs) |
