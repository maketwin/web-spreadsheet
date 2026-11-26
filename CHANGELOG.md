# Changelog

## v2.2.0 — 开发中（移动端适配）

### Breaking

- **Store events: disguised `style` events split into their own types** —
  feature changes that used to arrive disguised as
  `{ type: 'style', id: 'cf:…' }` now have dedicated `StoreEvent` types:
  `conditionalRules` (with `range`), `charts` / `images` / `sparklines`
  (with `id`), `validations` (with `range`), `namedRanges` (with `name`),
  `rowGroups`, `freeze`, `protection` (all with an optional `sheetId`), and
  workbook-level `workbookPassword` (no `sheetId`). The `style` type now
  means a real cell-style change only. The `sheet` event's `action` gained
  `'move'` (`moveSheet`) and `'recolor'` (`setSheetColor`) — those changes
  used to borrow `activate` / `rename`. **Host code that subscribed to the
  store and matched `type === 'style'` by id prefix must switch to the new
  event types.** Batch coalescing keeps the old granularity: identity-bearing
  events merge per (type, sheet, identity); `rowGroups` / `freeze` /
  `protection` / `workbookPassword` carry no identity and are always
  delivered in order.
- **Grid 1000×26 → Excel's address space (1,048,576 × 16,384)** —
  `TOTAL_ROWS` / `TOTAL_COLS` now match Excel exactly (`src/util/gridSize.ts`).
  The governing principle: **the address space is not an allocation** —
  every cost tracks stored cells / metadata entries, never the selection or
  the used range's area. Code that walked the old bounded grid must go
  through the stored cells (`Store.forEachCell` / `forEachCellInRect` /
  `getUsedBounds` / `limitToData`) instead of row/column loops.
- **`StoreEvent` gained `structure` and `cells` variants** —
  `{ type: 'structure', axis, kind: 'insert' | 'delete', start, count,
  sheetId? }` (one per structural command; the half-plane at/after `start`
  moved as one piece and moved content emits no per-cell events) and
  `{ type: 'cells', keys, sheetId? }` (a batch rewrite with numeric
  `r * TOTAL_COLS + c` keys). **Subscribers that maintain per-position
  state must handle `structure`** (rebuild from the final state) and
  `cells` (invalidate by key).
- **`Store.replaceAll` no longer emits per-cell `cell` events** — imports
  deliver one `workbook replace` plus `sheet` delete/add/activate events.
  **Hosts that tracked imported content through `cell` events must rebuild
  from the final state on `workbook` / `sheet`** — a million-cell import no
  longer allocates a million event objects.
- **Workbook records are format version 2** — `{ id, updatedAt,
  formatVersion: 2, activeSheetId, passwordHash, sheets: [{ id, name,
  color?, data: <per-sheet JSON string> }] }` (`WORKBOOK_FORMAT_VERSION = 2`).
  New builds read v1 records; **older builds refuse v2 records** and leave
  the record untouched. `loadWorkbook`'s return type
  (`SerializedStore | undefined`) and `saveWorkbook(id, data)`'s signature
  are unchanged.
- **Paste/fill writes are capped at `MAX_MATERIALIZED_CELLS` = 250,000
  cells** (exported, `src/util/limits.ts`). Excel tiles a copied block over
  a whole-column selection; here a paste lands once at the anchor and a
  fill stops at the cap instead of materializing millions of cells.
- **Clearing removes emptied cells from storage** — Delete / clear contents
  / pasting blanks / cut leave no `{ text: '' }` ghosts behind: a cell that
  ends up empty and unstyled is removed; styled blanks are kept. Hosts that
  assumed cleared cells still exist must handle `undefined` reads.
- **Whole-column/whole-row/whole-sheet style selections write axis default
  styles** — `SetRangeStyleCommand` / `SetNumberFormatCommand` /
  `SetRangeBorderCommand` detect the whole-axis selection and delegate to
  the new `SetAxisStyleCommand` / `ClearAxisStyleCommand`. Consequences for
  bounded selections too: the style merge base is the **effective** style
  (cell > row default > column default — italic on a cell in a bold column
  yields bold+italic), and a whole-column format clear drops both the
  column default and the cells' own styles in one undo step.
- **xlsx export is now deflate-compressed; import limits relaxed; row
  heights import with the right unit** — the package is re-zipped with
  fflate after the in-memory post-processing passes (SheetJS's own zip is
  uncompressed); import ceilings moved from 32/64 MiB to 128 MiB per entry /
  256 MiB total (`src/io/safeUnzip.ts`). OOXML row `ht` is **points** and
  converts ×4/3 to px — it used to be read as px, inflating imported row
  heights by a third (re-import the same file to fix them).
- **CSV export throws `CsvRangeTooLargeError`** (exported) when the used
  range's area exceeds `MAX_DENSE_RANGE_CELLS` — two far-apart cells would
  otherwise turn the dense CSV walk into billions of empty addresses.
- **`AND` / `OR` ignore blanks and text inside range arguments** (Excel
  semantics) and return `#VALUE!` when no argument contributed a logical
  value; criteria that match blanks (`COUNTIF(range, "")`, `=`) count the
  never-stored addresses of a sparse range arithmetically.
- **Open-ended references now parse** — `A:A`, `A:C`, `3:5`, `B2:B`
  (= `B2:B1048576`), `B1:1` (= `B1:XFD1`), with `$` anchors and `Sheet!`
  scopes; `INDIRECT` literals accept them too. Formulas that used to fail
  to parse may now evaluate.

### Architecture

- **Headless core entry `web-spreadsheet/core`** (`src/core.ts` + second lib
  build `vite.core.config.ts`) — Store / FormulaEngine / CommandManager /
  EventBus / CanvasRenderer and all services with zero antd / chart.js / xlsx /
  dexie imports. The root entry keeps the full React UI stack; both build off
  the same modules. `outline/rowGroups.ts` no longer imports antd `message`
  (collapse/expand return a boolean; MenuBar shows the toast).
- **CanvasRenderer first-batch split (2230 → 1963 lines)** — extracted
  `GridGeometry` (freeze-quadrant cellVP, hit-testing, viewport rects, chart
  anchors; renderer keeps thin delegates so its public surface is unchanged),
  `AutoFilterChrome`, `SparklinePainter`, `ConditionalPainter`, and
  `gestureConstants`. Six modules, each with its own unit tests (19 new cases).
  Grid constants no longer import through CanvasRenderer — importers point at
  `renderer/coordinate` / `util/gridSize` directly.
- **Layer discipline enforced by eslint** — `no-restricted-imports` blocks
  React/UI/renderer/platform/io/db imports inside `src/{store,formula,
  commands,events}`, and confines platform→engine value imports to the four
  adapter files (type imports allowed).
- **`src/plugin` + `src/plugins` merged** into the single `src/plugin/`
  directory (contracts and CsvImportPlugin together).
- **Grid-constant lint rule (layer rule ③)** — `TOTAL_ROWS / TOTAL_COLS /
  ROW_HEIGHT / COL_WIDTH / ROW_HEADER_WIDTH / COL_HEADER_HEIGHT` have their
  single definition in `src/util/gridSize.ts`; `renderer/coordinate` only
  forwards them now, and the last 23 non-renderer files that still imported
  the constants through it point at `util/gridSize` directly. A
  `no-restricted-imports` rule (with `importNames`) blocks new non-renderer
  imports of those names from `renderer/coordinate`.
- **`src/util/` is the lint-enforced bottom layer (layer rule ④)** —
  `src/util/**` value-imports only util-internal paths (`./…`, `../util/…`)
  and `../types`; type imports are unrestricted; no third-party libraries.
  Making that true took one round of verbatim moves: A1 + internal range
  notation parsing now lives in the new `util/rangeNotation.ts`
  (`parseRange`, `parseInternalRange`, `shiftInternalRange`, `shiftAxis`);
  formula-aware helpers moved beside their dependencies (`formula/
  refRewrite.ts` — `replaceRefTokens`, `remapFormulaRows`,
  `shiftFormulaRows/Cols` plus the old `util/formulaRefs.ts` `shiftFormula`;
  `formula/precedents.ts` — `formulaDependencies`, `dependenciesOfAst`;
  `format/displayText.ts` — `displayTextOf`); command-backed helpers moved
  up (`util/rangeValues.ts` → `commands/rangeValues.ts`; `util/rowAutofit.ts`
  / `util/styleAutofit.ts` → `components/`). `util/cell.ts` keeps only the
  cell-input normalization leaf functions and `util/merge.ts` no longer
  depends on `selection/Range` at runtime. The dependency analysis reports
  0 upward value-dependencies out of `util/` and 0 file-level value-import
  cycles.

### Architecture（规模与大数据）

- **Sparse cell storage** (`src/store/SheetData.ts`) — cells live in one
  Map keyed by the number `r * TOTAL_COLS + c` (never a string); the public
  `getCells()` / `serialize()` keep the `"r,c"` string keys. New
  stored-cell-only APIs on `Store`: `forEachCell(fn, sheetId?)`,
  `forEachCellInRect(rect, fn, sheetId?)` (cost tracks min(rect area,
  stored cells)), `getCellCount(sheetId?)`, `getUsedBounds(sheetId?)`
  (`{ r1, c1, r2, c2 }`, undefined on an empty sheet) and
  `limitToData(range, sheetId?)` (range ∩ used bounds; a disjoint range
  falls back to its first cell). `CellRect` / `MergeRect` types are
  exported from both entries. Merges are indexed in 64-row bands
  (`mergesByRow`), so `Store.getMergeRectAt` stays allocation-free on the
  big grid (a whole-column merge costs ~16k band entries, not one per row).
- **Structural move primitives** (`src/store/Store.ts`) — `insertRows(at,
  count, sheetId?)` / `insertCols` / `deleteRows` / `deleteCols` move the
  half-plane as one piece and deliver ONE `{ type: 'structure', axis, kind,
  start, count, sheetId }` event (`bulkSetCells(entries, sheetId?)` writes a
  batch and delivers one `{ type: 'cells', keys, sheetId }`). They do not
  touch row/col metadata, merges, formulas or features — that remains the
  commands' job. The four structural commands and `RemoveDuplicatesCommand`
  build on them, so undo no longer keeps whole-band snapshots (only the
  removed cells, formulas whose text was rewritten, features, and the
  metadata band); spill shadow cells (`spillOf`) are dropped on the move
  and their anchors re-spill.
- **Export pipeline rebuilt around one in-memory file table**
  (`src/io/XlsxExporter.ts`) — SheetJS writes the base package, fflate
  unpacks it once (it is this export's own output, so import-side zip
  limits do not apply), four post-processors patch it in place (packed
  coordinate restore → styles → sheet features → charts, comments), and
  fflate compresses once at the end. The worksheet build is sparse (one
  SheetJS cell per stored cell, `!ref` clamped to the used bounds), and
  past `MAX_DENSE_EXPORT_EMPTY_CELLS` (1,000,000, internal) empty
  addresses in the used range the cells take the packed-export path
  (`src/io/sheetPackingExport.ts`): dense block + coordinate restore in
  the sheet XML, output byte-identical to the plain path.
- **Sharded auto-save encoder** (`src/db/autoSave.ts`,
  `src/db/workbookEncoder.ts`) — store events mark sheets dirty, only
  changed sheets re-encode, each sheet encodes in ~20,000-cell chunks that
  yield the main thread between chunks (`AUTOSAVE_ENCODE_CHUNK_CELLS`),
  unchanged sheets reuse their committed JSON string, and leaving the page
  (`pagehide` / hidden / `stop()`) writes everything in one synchronous
  shot. `startAutoSave(store, id?, options?)` takes an injectable
  `yieldFn`.

### Features

- **Touch gesture layer (canvas)** — one-finger drag now PANS the sheet
  (touch devices previously had no way to scroll the grid); it disengages
  the tap-selection drag after a 6px slop and never triggers the drag-origin
  selection flip. A 550ms long-press opens the context menu through the
  ordinary right-click routing (cell / row / column headers); movement
  >12px, a second finger, lift, or any in-flight object drag cancels it.
  Sheet tabs gain the same long-press menu (with the trailing synthetic
  click suppressed so the menu doesn't instantly close). Mouse behavior is
  untouched — the whole layer lives behind `pointerType !== 'mouse'`.
- **Soft-keyboard support** — while a cell editor is open, `visualViewport`
  resize/scroll scrolls the editing cell above the keyboard
  (`CanvasRenderer.scrollCellIntoView` with the reduced visible height) and
  repositions the editor overlay. Desktop (no visualViewport) is unaffected.
- **Responsive demo shell** — `dvh` viewport height, `viewport-fit=cover` +
  `interactive-widget=resizes-content`, `@media (pointer: coarse)` touch
  targets (32–36px buttons, 34px menu items, taller tabs/formula bar),
  `@media (max-width: 768px)` narrow-screen compaction, bottom safe-area
  inset, `overscroll-behavior: none`.
- **xlsx sheet features round trip** — borders, freeze panes, the autofilter
  range, conditional formats and data validations now export to xlsx and
  import back (`styles.xml` border table, `<pane>`, `<autoFilter ref>`,
  `<conditionalFormatting>` dxfs, `<dataValidations>`); chart titles decode
  XML entities (named + numeric) on import. Known gaps stay listed in
  docs/guide/io.md (images/sparklines not exported, autofilter criteria not
  exported, a few rule/operator types skipped on import).
- **Per-sheet freeze panes** — freeze moved from pure view state
  (`FreezeManager`) to `SheetData.freeze` (`SheetFreeze { rows, cols }`),
  serialized with the sheet and round-tripped through xlsx;
  `store.getFreeze(sheetId?)` / `store.setFreeze(freeze, sheetId?)`, and the
  view follows the active sheet (`useSheetFreeze`).
- **Band-scoped undo for insert/delete row/column** — the undo snapshot
  covers only the affected half-plane (rows/columns from the insertion point
  on) instead of the whole sheet; floating images/charts/sparklines shift
  with the operation and are included.
- **Relative CF/validation formulas** — conditional-format formula rules and
  data-validation custom formulas follow Excel semantics: written relative
  to the rule range's top-left cell, shifted per evaluated cell (`$` refs
  stay); validation runs with `{ store, r, c, sheetId? }` context from the
  editor (`ValidationContext`).
- **Progressive print with images** — `renderWorkbookPrintPagesAsync(store,
  settings, scope, onProgress?, signal?)` renders page by page (yields to the
  main thread between pages, cancelable, progress callback); floating
  data-URL images print, the print area includes floating images/charts, and
  fit-width never enlarges above 100% (Excel); `planWorkbookPrintPages` gives
  the dialog a cheap pagination pass.
- **Dark chrome completion** — sheet-tab context menu, panels, popovers and
  the remaining chrome surfaces tokenized (`--ss-surface*`, `--ss-hover-bg`,
  `--ss-tab-hover-bg`, `--ss-chart-*`, toolbar gradient tokens); dark
  `--ss-header-text` fixed to `#b3b3b3` for contrast. antd popups stay light
  (separate decision).
- **Programmatic command execution** — `CommandManager.execute` is now
  `execute(cmd, options?: ExecuteOptions): boolean` (was `execute(cmd):
  void`). Default (`record: true`) keeps the old behavior: protection check,
  `command:*` events, undo history, F4 repeat source. `record: false` applies
  the command as a programmatic edit (timeline replay, import, migration) —
  the same Store batch and exception boundary, but no undo stack, no redo
  clearing, no repeat source, no `command:*` events, and no protection check.
  Returns `true` when the command body ran (no-ops included), `false` when
  protection rejected it or the body threw. `ExecuteOptions` is exported from
  both package entries.
- **New Store queries** — `getMergeRectAt(r, c, sheetId?)` returns the merge
  covering a cell with parsed bounds (`MergeRect { r1, c1, r2, c2, range }`;
  the type is exported from both entries); `getMergeAt` keeps its signature
  and returns that rect's `range`. `getRowEntries(sheetId?)` /
  `getColEntries(sheetId?)` return `[index, meta]` pairs of the rows/columns
  that carry metadata (fresh arrays). The `SerializedSheetData` format is
  unchanged.
- **Typed event bus** — `EventBus<TEvents extends object =
  SpreadsheetEvents>`: the built-in event table `SpreadsheetEvents` types
  the known names (`command:executing/executed/undoing/undone/redoing/
  redone` carry `{ cmd }`, `command:failed` a `CommandFailedPayload`,
  `command:rejected` `{ reason: 'protected' }`, `csv:import` the raw CSV
  string), so `on('command:executed', …)` types the handler's payload
  precisely while plugin-defined names stay `unknown`. `emit` is unchanged
  and runtime behavior is identical. `api.on` in the plugin API is typed
  the same way. New exports: `SpreadsheetEvents`, `EventPayload`.
- **Formula functions: volatility, function context, private registries** —
  `FunctionSpec.volatile?: boolean` marks a function as wall-clock/world
  dependent (Excel's rule): its cell is re-evaluated on every recalculation
  pass that already has other work (`NOW` / `TODAY` are marked).
  `FunctionSpec.evaluate(args, ctx?)` takes an optional second parameter
  `FunctionContext { cell: { r, c }, sheetId }` so a function can know
  where its calling formula lives — always supplied on the engine path,
  `undefined` for bare `evaluate()` calls (conditional-format / validation
  rules). Existing one-parameter functions and plugin specs compile
  unchanged. `FunctionRegistry` is now an exported class: `new
  FunctionRegistry(registry)` builds a private table that falls back to the
  shared one for unknown names without leaking its own registrations; `new
  FormulaEngine(store, { registry })` points the engine at it
  (`engine.registry` is readable) and `api.registerFunction` registers on
  the host engine's own table (restored on undo). The default is unchanged —
  without the option the engine still uses the shared `registry`;
  `installApiFunctions(hub, table?)` takes the table the same way. Known
  limits: conditional-format and validation rule formulas are evaluated via
  bare `evaluate()` without the engine's table, so private-table functions
  apply to cell formulas only; formula autocomplete (`autoCompleteNames`)
  still reads the shared table by default. New exports: `FunctionRegistry`,
  `FunctionContext`, `FormulaEngineOptions`.
- **Stable command identities + replay coverage (29 kinds)** — `Command.kind()`
  returns the minification-invariant identity of a command, overridden by
  all 39 command classes (`CompositeCommand` stays `null`); `Command.args`
  is now `public readonly` so the platform can sample it by type. These
  names enter the persisted timeline / repro-bundle format — they can only
  be added to, never renamed. The replay whitelist
  (`src/commands/replayRegistry.ts`) covers 29 kinds — edits, row/column
  structure, styles/borders/number formats, merges, validations,
  conditional formats, hyperlinks, comments, move/fill/sort/dedupe/
  text-to-columns, autofilter (state + criteria), table style; chart/image/
  sparkline commands, whole-block value payloads, `autoRowHeights` and
  composites are deliberately excluded (rationale in the file header).
  Timeline payloads: the former 5 shapes keep their old form, other
  whitelisted commands record `{ kind: 'command', command, args }` (only
  when args are plain data — functions/class instances mean no payload);
  platform sampling ("动了哪里" display strings) dispatches on `kind()`
  instead of guessing from argument shapes; replay skips unknown command
  names into the `skipped` counter and keeps going; undo entries with a
  `command`-shaped payload carry no inverse (counted as skipped). New
  exports: `isReplayableKind`, `buildReplayableCommand`, `REPLAYABLE_KINDS`,
  `ReplayableCommandKind`.
- **Workbook format version** — `WORKBOOK_FORMAT_VERSION = 1`, exported from
  the package root. `saveWorkbook` stamps each record with `formatVersion`;
  records without the field read as version 1; `loadWorkbook` refuses a
  newer version with an error naming both versions (the record is left
  untouched, Dexie schema unchanged). The host's existing `.catch` handles
  it — the SDK's own restore logs a `console.error` and the demo shows its
  "读取失败" bar.

### Features（规模与大数据）

- **Excel reference syntax** — whole-column `A:A` / `A:C`, whole-row `1:1` /
  `3:5`, and open-ended `B2:B` (= `B2:B1048576`) / `B1:1` (= `B1:XFD1`),
  with `$` anchors, `Sheet!` scopes and `INDIRECT` literals. On row/col
  insert/delete the anchored end rewrites like an ordinary reference and
  the open end stays open (`shiftFormulaRows` / `shiftFormulaCols`).
- **Sparse evaluation over huge ranges** — a range reference beyond
  `MAX_DENSE_RANGE_CELLS` (2,000,000, exported) becomes a `SparseRangeValue`
  (guard `isSparseRange`, both exported) that carries the rectangle's shape
  and a walk of its stored cells. Exact over stored cells: SUM, AVERAGE,
  MIN, MAX, COUNT, COUNTA, COUNTBLANK, PRODUCT, MEDIAN, LARGE, SMALL, the
  STDEV family, RANK, TEXTJOIN, CONCAT, the COUNTIF/SUMIF family with
  IFS/AVERAGEIF(S)/MAXIFS/MINIFS, SUMPRODUCT, AND, OR, SUBTOTAL, VLOOKUP,
  HLOOKUP. `#VALUE!` for what would need the full grid: UNIQUE / SORT /
  FILTER / the IS* family, a big range used as a scalar or in binary
  arithmetic, MATCH and XLOOKUP — except INDEX with scalar row and column
  arguments, which reads by address (`INDEX(A1:C1048576, 5, 2)` works;
  out-of-bounds is `#REF!`). New function `COUNTBLANK` (over a sparse range
  the blank total is area − stored non-blanks).
- **Rectangle dependencies for big ranges** — a range over
  `RANGE_DEP_CELLS` = 256 cells (exported, `src/formula/precedents.ts`)
  registers as ONE rectangular dependency instead of one edge per cell;
  formulas already inside the rectangle keep exact edges for cycle
  detection, and a scalar-lookup formula (INDEX/VLOOKUP/HLOOKUP/MATCH/
  XLOOKUP) sitting inside its own big range is not a self-reference.
- **Column/row default styles** (`src/commands/impl/SetAxisStyle.ts`) —
  `RowMeta` / `ColMeta` gain an optional `styleId`. A selection spanning
  every row formats the columns, every column the rows, the whole sheet
  writes column defaults for all 16,384 columns — O(axis length), zero
  cell writes, effective immediately on blank and future cells. Effective
  style resolves cell > row default > column default via the new exported
  `Store.getCellStyle(r, c, cell?, sheetId?)`; cells with their own style
  keep winning. New exports: `SetAxisStyleCommand`, `ClearAxisStyleCommand`,
  `axisSelectionOf`, `reservedAxisStyleId` (reserved ids `colstyle-<c>` /
  `rowstyle-<r>`); consecutive indices sharing a base share one style-table
  entry per write and undo records only the exceptions. The toolbar shows
  axis defaults under whole-column/whole-row selections
  (`src/components/InteractionToolbar.tsx`).
- **Effective-range rule for per-cell commands**
  (`src/commands/impl/effectiveRange.ts`) — a selection at or under
  `MAX_MATERIALIZED_CELLS` is honored verbatim (blanks included); larger
  selections collapse to the used part (`Store.limitToData`) and past the
  cap inside it, only stored cells are touched. Style commands on a
  selection disjoint from the data fall back to one anchor cell.
- **Undo history memory budget** (`src/commands/CommandManager.ts`) —
  besides `MAX_HISTORY = 100` steps, `MAX_HISTORY_RETAINED_CELLS = 2,000,000`
  (exported) caps the cells kept across both stacks by `Command.historyWeight()`
  (base default 0); the oldest undo steps are evicted over budget, always
  keeping the newest. `CommandManager.historyWeight()` reports the current
  total.
- **xlsx axis metadata round-trip** — column widths, column hiding,
  column default styles (`<cols>` with `width` / `hidden` / `style=`) and
  row heights, row hiding, row default styles (`<row>` `ht` / `hidden` /
  `s` + `customFormat`) now export and import. Column width converts from
  the raw `<col width>` attribute (chars ×7 px +5 px) instead of SheetJS's
  re-derived `wpx`/`wch`. Hyperlink targets import without the stray
  `&amp;` (SheetJS reads attributes raw; the importer decodes entities
  once).
- **CSV guardrails** — export uses the effective style (column/row default
  number formats apply) and throws the exported `CsvRangeTooLargeError`
  beyond a 2,000,000-cell used-range area.
- **Replay whitelist grows to 31 kinds** — `setAxisStyle` and
  `clearAxisStyle` join `src/commands/replayRegistry.ts` (was 29).

### Performance

- **Merge lookup via a per-row index** — `getMergeAt` / `getMergeRectAt` are
  served by a row → merges index in `SheetData` instead of a linear scan over
  the merge set with an A1 string parse per candidate (the index covers grid
  rows only, so a whole-column merge still costs one entry). Painting a
  1040-cell viewport twice over a sheet with 20/100/200 merges: 8.0 / 38.9 /
  69.6 ms per frame → ≤ 0.12 ms.
- **Structural commands touch only rows/columns carrying metadata** —
  insert/delete row/column and RemoveDuplicates now emit store events only
  for indexes that actually have row/column metadata (at most 2 per index);
  the resulting state is identical to the old per-index walk. Inserting a row
  above a 130-cell sheet with no row heights: 1,158 delivered events → 158.
- **Conditional-format overlay cache** — `ConditionalService.computeOverlay`
  returns the previous result object for repeat calls within one store
  revision (per-sheet Map keyed `r * TOTAL_COLS + c`, capacity-capped, no
  store subscription). Callers must treat returned overlays as immutable.
  With rules unchanged: 1.2–2.3 ms per frame → 0.02–0.04 ms.
- **Replay applies payloads through one batch** — mock-platform replay runs
  every payload through a replay-private `CommandManager` with
  `record: false`, sharing the user-edit batch and exception boundary:
  replaying one insert-row performs a single recalculation round instead of
  ~1,003 (53.8 ms → 3.2 ms). Successful replays produce the same timeline
  events as before.
- **Selection changes repaint headers only** — a selection change dirties
  just the row/column header tint bands, and dirty rectangles inside the
  header strips now take a fast path (headers + freeze separators, no
  cell-paint pipeline); a frame that repaints only headers no longer copies
  the whole grid into the scroll cache. `setExtraRanges` is a no-op when
  the incoming ranges equal the current ones (an ordinary click used to
  "clear" the always-empty multi-selection and invalidate the whole canvas),
  and the status bar's filled-cell count is memoized per (store, active
  sheet, `store.revision`) so selection changes no longer scan the sheet.
  Measured on a full 1000×26 styled sheet over 300 clicks (Playwright +
  headless Chromium): canvas repaint 3.75 ms → 0.68 ms per click; dev build
  click-to-settle median 7.3 → 6.1 ms, p90 16.5 → 14.0 ms; production build
  median 3.2 ms / p90 3.7 ms; on a 120 Hz display the worst frame interval
  dropped 33 ms → 16.8 ms (no dropped frames). Pixel-identical: per-region
  checksums match across 30 clicks × 4 regions.

### Performance（规模与大数据，Node 本机实测 / 无头 Chromium）

- **Structural commands at a million cells** — top insert row above a
  1M-cell column 289 ms / undo 258 ms; delete row 251 ms / undo 232 ms
  (before: 1,186 / 1,022 / 1,126 / 945 ms). A 100k×10 block: insert column
  277 ms / undo 269 ms.
- **Whole-column formatting** — bold on a whole column 0.3 ms, undo 0.1 ms;
  styling a 500k-row selection ~300–360 ms while adding one style-table
  entry.
- **Sort at scale** — 500,000 rows × 3 columns 3.07 s, undo 1.98 s.
- **Formulas at scale** — entering 100k `=A{r}*2` formulas ~0.7–1.7 s;
  full recalc ~0.9 s; 100k chained formulas from scratch 339 ms; editing
  one number that feeds 8 million-cell aggregates 522 ms; exact-match
  VLOOKUP over a whole column 85–90 ms; MATCH ~290 ms; `=SUM(A:A)` over a
  million numbers ~60 ms.
- **Storage walks** — a 1M-cell column fills in 0.9 s; `forEachCell` 10 ms;
  whole-column range walk 13.5 ms; serialize ~75 ms; deserialize ~0.25 s;
  `replaceAll` ~0.27 s; sheet copy ~0.14 s.
- **Import/export at a million cells** — A1 + XFD1048576 exports in 3 ms
  (an hour+ before); 2,000 far-apart cells 8.6 ms; one column of a million
  numbers exports 6.9 s / 9.6 MB (53.7 MB and unreadable before) and
  imports in 2.7 s; 100k×10 exports 3.2 s / 7.3 MB, imports 2.2 s; 50
  sheets with a million cells total export 2.3 s / 7.2 MB, import 1.7 s;
  CSV export of 100k×10 130 ms. Importing a million cells peaks at
  ~1.1–1.4 GB Node RSS.
- **Browser measurements (headless Chromium)** — a million cells hold
  ~60 MB of live heap (~60 bytes/cell); auto-save went from one ~260 ms
  main-thread long task per save to no task ≥ 50 ms in four measurements;
  the undo history costs ~110–145 bytes per retained cell.
- **Clearing a whole column** — Delete on a million-cell column took 950 ms
  and its undo 806 ms with no formula engine attached, 2,629 / 3,297 ms with
  one attached (the clear wrote and announced every cell, and the formula
  sync built one deferred entry per cell). The sparse clear now takes the
  cells out in one sweep with a single `cells` event
  (`Store.takeCellsInRect`), its undo puts them back through `bulkSetCells`,
  and the formula sync answers a `cells` event of more than 256 keys by its
  bounding rectangle: 154–177 ms / 156–194 ms. In the real page (dev build)
  the longest main-thread block is 567 ms for the Delete and 400 ms for the
  undo.
- **Real browser, dev build (headless Chromium)** — one sheet of 1,000,000
  cells (100,000 × 10): open to screen 2.2 s, reopen from IndexedDB after a
  reload 1.2 s; scrolling 300 wheel ticks, jumping to XFD1048576 and typing
  there never block the main thread longer than two 60 Hz frames (16.7–33
  ms); whole-column bold 33 ms; a row inserted through the header menu 267
  ms, undo 233 ms; no long task during the auto-save. 50 sheets with a
  million cells: open 1.7 s, switching sheets 17 ms.
- **Many sheets with formulas** — 50 sheets × 2,000 rows × 4 columns with a
  SUM per row (100k formulas) and a cross-sheet summary: inserting a row at
  the top of one data sheet (its formulas and the summary's reference move)
  ~115 ms, undo ~64 ms; editing one number updates its sheet total and the
  grand total in ~2 ms; `replaceAll` with the engine attached ~1.5 s.
- **Not yet resolved** — the same workbook shape at 200 sheets (250k
  formulas) enters in 8.9 s, recalculates in 8.1 s and reloads in 10.1 s
  with a ~1.9 GB Node heap: superlinear against the 50-sheet figures, cause
  not yet located. Also still slow by nature of the work: a 500,000 × 3
  sort 1.3–3.1 s (the sort engine writes every cell of the block), and one
  edit that feeds several million-cell aggregates costs ~65 ms per
  aggregate.

### Fixes

- **Pinch zoom clamped to the floor** — `pinchBase.zoom` was captured from
  `zoom()` (a fraction) but `onZoomTo` expects a percent, so every pinch
  collapsed the zoom to the 50% minimum. Caught by the new mobile e2e.
- **Spill × structural operations (debt clearance)** — three data-level
  defects from the 09-28 review: editing an anchor formula to a scalar left
  orphan shadows (stale values persisted and blocked future spills);
  inserting/deleting rows or columns transported shadow cells verbatim so
  the shifted anchor hit `#SPILL!` forever; filling/copying a spilled block
  pasted shadow texts as real values that blocked the new anchor. All
  move/copy paths now DROP derived shadow cells (`util/spillShadow`) — the
  anchor formula re-spills fresh — and `recalculate` retires a spill before
  writing a scalar result. Shadows also preserve the target cell's
  styleId/type, spilled Dates keep their type, sheet deletion clears the
  engine's bookkeeping, and `writeSpill`'s idempotence gate runs BEFORE any
  clearing so echo re-evaluations are side-effect-free.
- **PRODUCT advertised but not callable** — the autocomplete catalog listed
  PRODUCT, yet it was only ever implemented as SUBTOTAL's op 6, so a
  standalone `=PRODUCT(2,3,4)` evaluated to `#NAME?`. Now registered in the
  function registry with the same operand rules (text/blank ignored, all-empty
  → 0).
- **Row groups shift with row insert/delete** — group intervals were left
  verbatim, so inserting above a group detached it from its rows and deleting
  through one left a stale range. Pure shift helpers
  (`src/outline/rowGroupShift.ts`, merge-shift semantics: top-edge insert
  pushes the group down, interior insert grows it, fully covered groups are
  dropped) run in both commands, and the sheet snapshot captures/restores the
  groups so undo brings the pre-edit intervals back.
- **Formula evaluator** — matrix operands flatten into the element-wise
  list math (`=SUM(A1:A3*SEQUENCE(3))` used to be `#VALUE!`); `#SPILL!`
  and `#CALC!` join `EXCEL_ERRORS` so `IFERROR`/`ISERROR` catch them;
  `firstErrorIn` scans the whole matrix instead of element 0.
- **Touch gesture exits** — every non-default exit (second finger,
  multi-finger lift, pointercancel, destroy) funnels through
  `resetGesture()`, which CANCELS in-flight fill/resize drags instead of
  abandoning them (an abandoned drag committed a phantom fill on the next
  tap). Touch selection is deferred to the lift (`pendingTap`), so
  pressing to pan no longer collapses a multi-cell selection, and the
  long-press menu runs the deferred selection first. Pinch rebases on
  every pointer-set change (no more zoom jumps from a stale base).
- **Sheet-tab suppress flag / keyboard-avoidance coords** —
  `suppressTabClick` resets on pointerdown (a long-press whose synthetic
  click never arrived used to swallow the NEXT real tab click), and the
  `visualViewport` sync no longer mixes document and layout-viewport
  coordinates (keyboard reflow + page scroll used to over-scroll the
  editing cell).
- **Plugin install failure no longer leaks registrations** —
  `PluginManager.use()` records the `PluginAPI` before `install()`; a plugin
  that throws mid-install gets its already-registered formula functions and
  event subscriptions disposed, is not listed, and the error propagates.
- **Scientific custom formats no longer throw on non-finite cells** —
  `formatValue(NaN|±Infinity, '0.00E+00')` (and the built-in `scientific`)
  substituted the plain text instead of raising `TypeError` mid-paint;
  zero-padded integer formats keep the sign in front (`-5` with `000`
  prints `-005`, not `0-5`).
- **Number formats round the decimal value half away from zero** — `1.005`
  with `0.00` prints `1.01` (binary-noise `1.00` before), including the
  scientific mantissa (`9.995` → `1.00E+01`).
- **Fill keeps leading zeros** — a pure-number series takes the anchor
  cell's zero padding (`001`, `002` → `003`); a lone `0012` copies on drag
  and increments padded under Ctrl (`0013`, `0014`).
- **Proxy spy dashboard survives a server restart** — the spy API tags
  responses with a per-boot `bootId`; the dashboard drops its remembered
  sequence numbers when the proxy restarts instead of never matching again.
- **Auto-save no longer starves while editing continues** — the debounce
  (1500 ms, `AUTOSAVE_DEBOUNCE_MS`) was the only trigger, so a steady edit
  stream never reached IndexedDB; a second timer now forces a save at most
  5000 ms after the first unsaved change (`AUTOSAVE_MAX_WAIT_MS`), even while
  changes keep coming. `pagehide` and `visibilitychange` → hidden flush
  immediately, even with a save in flight (IndexedDB commits writes to one
  record in creation order, so the newer snapshot wins); outside those paths
  only one write runs at a time. `stop()` flushes pending changes and removes
  the listeners; failures surface as `console.error`, never an unhandled
  rejection. `startAutoSave` / `AutoSaveHandle` signatures unchanged.
- **Replayed undo no longer replays the original edit (mock platform)** —
  timeline entries with `via: 'undo'` carry the inverse payload now (they used
  to carry the original command's payload, so a replay turned the undo back
  into the edit): `setCell` writes back the value the undo restored (formula
  cells their formula text; an originally empty cell stays empty),
  `insertRow`/`insertCol` become the matching `deleteRow`/`deleteCol`, and an
  undone delete cannot resurrect its content — payload `null`, counted as
  skipped. `via: 'user'` / `'redo'` entries are unchanged. A payload that
  fails to apply throws `Replay failed at seq <seq> (<payload kind>)` and
  aborts the replay, which closes the causal window — a previously thrown
  error left it open and mis-attributed later traffic to the stale cause.
- **`Store.isFlushing` is depth-counted** — when a flush-time listener opens
  a batch of its own (formula spill writes do), the outer flush's remaining
  events no longer report "not flushing" mid-delivery; the boolean became a
  nesting count. Public signature and flush-time semantics otherwise
  unchanged.
- **`=TODAY()` showed yesterday after midnight** — a sheet left open across
  midnight kept its volatile cells' stale results because nothing dirtied
  them. `FunctionSpec.volatile` (see Features) re-evaluates them on every
  recalculation pass that has other work, so `NOW` / `TODAY` track the wall
  clock like Excel.
- **Internal range keys parsed once, strictly** — all 14 call sites of the
  internal `"r,c"` / `"r1,c1:r2,c2"` notation (named ranges, conditional
  formats, validations, charts, sparklines, autofilter) go through one
  parser, `parseInternalRange` in `src/util/rangeNotation.ts`: coordinates
  must be decimal integer literals (a leading `-` is fine), no whitespace,
  exactly two per corner, at most one `:`; corners are normalized
  (r1 ≤ r2, c1 ≤ c2); anything else returns null. Behavior changes:
  reversed-corner keys used to be kept verbatim — validation / conditional
  rules never matched, named ranges resolved to a backwards A1 span, and
  named-range formulas evaluated to nothing — and now match; malformed keys
  used to degrade into wrong shapes (`"2,3:"` matched cell (0,0) because
  `Number('')` is 0; `"2,3:5"` fell back to a partial corner) and are now
  invalid — only externally hand-edited JSON carries such shapes; the
  conditional-format / validation dialogs accept single-cell keys;
  `NamedRangeService` no longer throws on junk keys nor injects `NaN` into
  formulas; xlsx export skips rules with unparsable keys instead of writing
  degenerate references. The public `parseInternalRangeKey` wrapper keeps
  its return shapes for invalid input.
- **Re-applying an AutoFilter runs in one store batch** — re-applying a
  filter that hides a few hundred rows triggered one refresh per hidden
  row; the menu action now wraps `applyFilters()` in `store.batch` (one
  refresh). Also dropped a stale `MenuBar.tsx` comment pointing at a
  since-moved file.
- **Replay cancels operations that were undone (mock platform)** — undo
  entries whose command has no inverse payload (row height, styles, merges:
  the old values are not in the arguments) used to be skipped while the
  forward entry was replayed, so a replayed session kept effects the user
  had undone — silently, with no deviation reported. An undo entry now
  records the `seq` of the entry it reverses (`undoes`), and replay skips
  both; an undo that does carry an inverse (cell edits, row/column
  structure) is still replayed as that inverse. Undo is last-in-first-out,
  so nothing still standing can depend on a cancelled entry. Timelines
  without `undoes` replay exactly as before.
- **The view follows a freeze set through the store** — `store.setFreeze(…)`
  on the active sheet used to be ignored
  by the view until the next sheet switch; the freeze hook now reloads the
  view from the sheet on the store's `freeze` event. Its load and write-back
  paths were merged into one effect that runs exactly one branch per commit:
  besides breaking the event → view → write → event echo, this removes a
  transient write of the previous sheet's freeze into the sheet being
  switched to.
- **Every sheet shared one scroll position and one selection** — a sheet
  switched to after scrolling another one opened at the same offset, with
  the active cell at the other sheet's coordinates. As in Excel, the view
  (scroll position, at the zoom it was left at) and the selection now belong
  to each sheet (`CanvasRenderer.switchViewTo`, `useSheetSelection`): the
  sheet entered returns to where it was left, or opens at the top-left with
  A1; the sheet left keeps both for when it comes back — whichever way the
  switch happens (tab, hyperlink, Find, `Store.activateSheet`). The sheet's
  own view outranks its selection coming back, so wheeling away from the
  active cell before leaving is preserved. A replaced workbook starts over at
  the top-left and A1; Ctrl-added extra ranges do not outlive their sheet.
  Behaviour change: an edit still open when a host switches sheets
  programmatically is cancelled — it used to stay open on a cell of the
  sheet switched to and commit there.
- **Typing into an active cell that had been scrolled out of sight opened the
  editor off-canvas** — the draft went into a cell nobody could see (found by
  real-page acceptance once sheets kept their own views). An edit — a typed
  character or F2 — now brings its cell into view first, freeze-aware like
  the scroll that follows an arrow key. Jumps do the same: the name box,
  Find and hyperlinks reveal their target even where the active cell does
  not move (`CanvasRenderer.setSelection(…, reveal)`, `revealCell`).

### Fixes（规模与大数据）

- **`MAX` / `MIN` blew the call stack on million-argument ranges** —
  `Math.max(…spread)` over a materialized million-cell range overflowed;
  the aggregates now reduce in a loop (`extremeOf`).
- **SUMIFS mismatched its criteria ranges on the sparse branch** — the
  aligned criteria group now keys stored values by row-major offset from
  each range's top-left corner, exactly like the dense loop indexes both
  lists at `i`.
- **Hyperlink targets kept `&amp;` after import** — SheetJS escapes `&`
  into the rels Target on write but never decodes entities on read; the
  importer now decodes once (idempotent for internal links, which SheetJS
  does decode).
- **Column widths / row heights imported with the wrong units** — row `ht`
  is points and is now converted ×4/3 to px (was read as px); column width
  converts from the raw `<col width>` attribute (chars ×7 + 5 px) instead
  of the drifted `wpx`/`wch` guesses.
- **Million-cell import/export lost sheets, hung, or produced unreadable
  files** — the old dense worksheet build walked every address of the used
  range (a workbook whose only cells sat at A1 and XFD1048576 kept the
  writer busy for hours and hit the old 32 MiB entry cap on import, so the
  sheet was skipped or the file could not be read back). The sparse build,
  packed export and raised ceilings fix the family; "beyond the grid"
  truncation warnings are gone (the grid is Excel's whole address space).
- **An aggregate over a big range stopped updating once a formula appeared
  inside the range** — a formula landing inside an existing rectangle
  dependency now becomes a precedent of the rectangle's owner, so the
  owner recalculates when the interior formula's result changes.
- **Typing a range into the name box scrolled the view to the range's last
  cell** — a range selected without an explicit active cell took its
  bottom-right cell as active, and the viewport follows the active cell:
  `A:A` meant A1048576, so the view jumped to the last row (hard to notice
  on the old 1,000-row grid). The active cell now defaults to the range's
  top-left cell, as in Excel.
- **Clicking the name box threw an uncaught `TypeError`** — the deferred
  select-all read `event.currentTarget`, which React clears once the handler
  returns (`Cannot read properties of null (reading 'select')` on every
  first click into the name box). The handler now keeps the element.
- **Remove duplicates left outline row groups behind** — the removed rows
  moved up, the row groups above and below them did not; groups now shift
  with the deleted spans and come back on undo.
- **Four callable functions were missing from the formula AutoComplete
  catalog** — `NA`, `ISERR`, `MINUTE` and `SECOND` evaluated but were never
  offered or described; the catalog now lists all 96 built-in functions.
- **Deleting the row of a spill anchor left the anchor's value and shadows
  behind** — found by acceptance while the bulk structural move was being
  built (it never shipped): the formula sync now unregisters the formulas of
  a deleted band before waking spill anchors, so a deleted array is gone and
  its undo restores it whole.

**Known gap (pre-existing, not addressed here)**: a spilled array
(`=SEQUENCE(…)`) does not survive an xlsx round trip — the export writes the
anchor formula and the spill values as independent cells, so the re-imported
anchor finds its neighbours occupied and shows `#SPILL!`. The same happens
on the last release. Fixing it means exporting the spill as an array formula
over its range (and reading Excel's dynamic-array metadata on import).

### Refactoring

- **Grid constants to `util/gridSize`** — `TOTAL_ROWS/COLS` & co. lived in
  the renderer, forcing formula/command layers to import upward for
  numbers; `renderer/coordinate` re-exports for compat. The dead
  `layoutTick` prop on EditorOverlay is gone (positioning is fully derived
  from the fresh `cellRect` the host recomputes).
- **Editor/exporter dead code** — removed a duplicated `setEditing` effect in
  `Spreadsheet.tsx` along with the doc comments orphaned by functions that
  had moved out, and moved one `io/XlsxExporter.ts` comment onto the function
  it actually describes.

### Testing

- Playwright `chromium-touch` project (390×844): 5 specs — tap-select +
  double-tap edit, long-press context menu + 清除内容, one-finger pan
  (top-left cell becomes a far row), two-finger pinch > 100% via the status
  bar, sheet-tab long-press menu. jsdom gesture unit tests (pan/tap/
  long-press/cancel paths, `scrollCellIntoView` incl. keyboard-reduced
  height and frozen panes), BottomBar long-press suite, FillHandle touch
  tolerance. Suite 183 files / 1213 tests; desktop e2e unchanged (8/8).
  Real-device QA checklist: docs/plan/2026-09-28-mobile-adaptation.md.
- **Debt-clearance regression suites** — `spillStructural.test.ts` (11
  cases: scalar-ize, delete/insert row, fill, paste, Ctrl-drag copy,
  style/Date preservation, `IFERROR` over `#SPILL!`, sheet deletion), 5
  new gesture tests (pan-press keeps the selection, mid-drag cancel ×2,
  pinch rebase), adjacent/escaped-literal `argIndex` cases for
  `stripLiterals`. CI caches Playwright browsers keyed on the lockfile;
  the pan e2e asserts a 13–17 row landing band instead of any far row.
  Suite 185 files / 1240 tests.
- 8 new test files / 56 cases for this batch: auto-save scheduling
  (debounce/max-wait/pagehide), merge index, structural-axis events,
  `CommandManager` programmatic execution, batch-flush nesting, overlay
  cache, replay batching and undo replay. Suite now 251 files / 1,828 tests.
- 12 new test files / 95 cases for this batch: the unified internal-range
  parser matrix (`internalRange.test.ts`), typed event bus, function
  context, registry scoping (private tables), volatile functions, `kind()`
  identities, replayable-command replay, the de-disguised store events,
  the selection fast-path repaint and the status bar memo, undone-operation
  cancellation in replay, and the freeze hook following host-side changes.
  Suite now 263 files / 1,923 tests.
- **Scale round** — suite 263 → 295 files, 1,923 → 2,207 tests (33 new
  files with 286 cases; one 2-case file that only tested a dead helper went
  with it). The new suites cover sparse store walks and the structural
  primitives, the undo memory budget, whole-column and row default styles
  (commands, renderer, toolbar, copy, print), sparse range evaluation,
  rectangle dependencies, whole-column / open-ended references, bulk
  `cells`-event sync, the structural move and its formula sync, packed xlsx
  export, axis metadata and hyperlink round trips, the sliced auto-save
  encoder, the command scale guards, and the per-sheet views and selections
  (`test/renderer/sheetView.test.ts`,
  `test/components/sheetSelection.test.ts`). Every wall-clock assertion added
  on a scale path leaves an order of magnitude over the local measurement
  (CI runs the suite under coverage on a shared runner) and is paired with an
  exact guard. One such wall was wrong in both directions and got fixed
  while closing the round: the million-read guard in
  `test/store/scale.test.ts` sat at 60 ms, above what string keys cost
  (≈55 ms) and below what numeric keys cost on a loaded runner (76 ms) — it
  guarded nothing and failed under load. It now leaves an order of magnitude
  (400 ms against ≈40 ms under coverage) and says what it guards; the key
  type is asserted deterministically in the test above it.
- **Scale experiments (opt-in, not part of the pass/fail suite)** —
  `pnpm bench:scale` (Node: store, many sheets, formulas, I/O; tables in
  `coverage/scale-bench/*.json`) and `pnpm e2e:scale` (real
  browser: time-to-screen and the longest main-thread block per action; its
  own `playwright.scale.config.ts`). The scale experiment is therefore not a
  project of the main Playwright config, so a plain `playwright test` — what
  CI runs — still runs the 13 interaction specs only.

### Build & CI

- **`packageManager: pnpm@11.25.0`** — both workflows' `pnpm/action-setup`
  no longer pin `version: 9` and follow `packageManager` instead; the docs
  deploy moved from Node 20 to Node 22.
- **Coverage counts `src/` only** — `coverage.include: ['src/**']` stops the
  demo, proxy and scripts from inflating the report. `pnpm coverage`
  currently reports 87.1% statements / lines, 82.7% branches, 80.5%
  functions. CI has not yet run under the new configuration (not pushed).

## v2.1.0 — 2026-09-28

> 发布要点：动态数组溢出（SEQUENCE/FILTER/UNIQUE/SORT/XLOOKUP 向量）、
> antd 6 + React 19 升级、打印与查找替换重建、Excel 对齐大批量特性
> （富文本、超链接、条件格式、名称管理器、行组、工作表保护、分列/去重）、
> Playwright e2e 基建、整个工作簿打印。对应 post-A+ 计划 M1–M3 里程碑
> （docs/plan/2026-09-28-post-a-plus-roadmap.md，已全部完成）。

### Features

- **Workbook-scope printing** — the print preview gains a
  当前工作表 / 整个工作簿 scope switch: every sheet is paginated in tab
  order with workbook-global `{page}`/`{pages}` numbering (fitWidth scaling
  stays per-sheet), the print-area input applies to single-sheet scope only,
  PDF export names the file 工作簿.pdf, and the summary line shows the
  sheet count. `renderWorkbookPrintPages` composes per-sheet
  `PrintPagesResult`s; `printPages`/`exportPagesToPdf` take a structural
  `{ canvases }` so both scopes feed them unchanged.

### Fixes

- **Fill-drag selection lands on the fill result (Excel parity)** — after
  dragging the fill handle (or double-click fill), the selection now covers
  source ∪ target with the active cell still in the source and the
  Shift+Arrow pivot on the far edge; previously the selection stayed on the
  source range. `selectionAfterFill` is a pure function wired into the
  renderer's `onFill` path and reported through `onSelectionChange` so the
  name box / formula bar follow.
- **Formula autocomplete signature mis-counted args after string literals** —
  `stripLiterals` masked string content by stuffing quote characters, which
  made the paren scanner swallow real commas between adjacent literals
  (`=SUBSTITUTE("a,b",` reported arg 0 instead of 1). The mask now preserves
  length and the outer quotes while replacing the content.
- **demo: IndexedDB restore failure is now visible** — a fixed warning bar
  (role=alert) explains the seed table is showing and offers 清除本地存档并刷新
  (deleteWorkbook → reload, falling back to deleteDatabase when the store is
  unreadable). Previously only a console error appeared.

### Testing

- **Coverage close-out** — `formulaAssist` 64% → 98.3% (28 cases:
  suggestion anchors/boundaries, innermost-signature comma depth, key
  contract, `parseFormulaRefs`) and `useClipboardSession` 66% → 100%
  statements (13 hook-level cases: session ants, cut=paste-once with
  single-step undo, external-clipboard fallback, multi-area combine +
  refusal, paste special matrix incl. cut-clears/formats-keeps). Fill
  selection gained pure-function tests plus a renderer-level drag
  simulation; workbook printing 4 pipeline tests. Suite now
  **182 files / 1201 tests** green; tsc + eslint clean.
- **Real-browser e2e (Playwright/Chromium)** — `pnpm e2e` runs 8 specs in
  ~8s covering the surfaces jsdom cannot reach: canvas/contextmenu via
  real right-click (cell menu 清除内容/插入-dialog insert, row/column
  header hide), the sheet-tab context menu into 移动或复制工作表, 插入 →
  迷你图 (store-level assertion), 分列/图标集 dialogs incl. the
  hover-submenu chain. Config reuses a running :5199 dev server (or boots
  one); assertions lean on the demo `window.__ss` handle. Playwright's
  native events handle the antd-6 popups fine — the earlier
  actionability timeouts were a limitation of the in-app browser tooling,
  not the app.

### Fixes

- **Invalid print area collapsed to A1** — `util/cell.parseRange` is
  forgiving (garbage resolves to {0,0}), so a typo like `not a range` in the
  打印区域 input silently shrunk the printout to a single empty cell instead
  of falling back to the used range. The pipeline now validates the A1 shape
  before parsing; covered in the new PrintPipeline suite (19.5% → 97.7%:
  per-page canvas sizing at print DPI, printArea intersect/clamp/fallback,
  landscape band math, print DOM structure, @page rule, afterprint cleanup
  idempotence, stale-DOM removal on reprint).

### Refactor

- **Spreadsheet.tsx split phase 3 (1160 → 811 lines, ≤900 target met)** —
  `InteractionToolbar` + `ProtectionModal` + font constants moved to
  `components/InteractionToolbar.tsx`, the renderer lifecycle to
  `components/hooks/useCanvasRenderer.ts`, the formula-engine sync to
  `components/formulaSync.ts` (`createFormulaSync` re-exported for
  compatibility), initial-data loading to `components/workbookInit.ts`, and
  `applyMoveOrCopySheet` into `spreadsheetActions.ts`. Phase 2 (1449 → 1160)
  had already extracted `keyboard.ts` + `spreadsheetActions.ts` (React-free,
  unit-tested key → action routing, 16 dispatch tests).

### Features

- **Dynamic-array spill (P0-1)** — `SEQUENCE` / `FILTER` / `UNIQUE` / `SORT`
  now return a shaped matrix and a TOP-LEVEL matrix result spills into the
  neighbouring cells Excel-365 style: shadows carry `spillOf` (anchor ref,
  serialized with the workbook), any blocker collapses the spill to
  `#SPILL!` with the expected extent still recorded — clearing the blocker
  or deleting the anchor retracts/rewrites the shadows via the ordinary
  cell-change recalc path; `XLOOKUP` with a multi-column/-row return array
  spills the aligned vector. Inside expressions matrices flatten (SUM over
  SEQUENCE nests), the spill writer is idempotent (no event echo loops) and
  circular-recalc is guarded by the eval stack. Shadows render with a light
  accent tint. v1 scope: FILTER/SORT/UNIQUE treat their input as a column.

### Dependencies

- **React 18.3.1 → 19.3.0 (+ @types 19)** — the codebase was already on the
  modern APIs (createRoot, no findDOMNode/render/UNSAFE lifecycles/defaultProps),
  so the port is two global `JSX.Element` → `React.JSX.Element` annotations and
  widening two `RefObject<T>` prop types for React 19's nullable
  `useRef<T>(null)`. Full suite 176 files / 1117 tests green on React 19;
  `tsc` and `vite build` clean; browser smoke (click / F2 / Esc-refocus /
  arrows) verified. SDK peer range stays `react >= 18` — hosts on 18 keep
  working.
- **antd 5.29.3 → 6.6.5 (+ @ant-design/icons 5.6.1 → 6.3.4)** — the rc-\*
  family moves to `@rc-component/*`, which also removes the React 18.3
  `findDOMNode` deprecation warning at its source (zero occurrences in the
  loaded module graph). App-side adaptations: `Dropdown overlayClassName` →
  `classNames.root`, last `destroyOnClose` → `destroyOnHidden`; tests gained a
  global jsdom env (`test/setupEnv.ts`) stubbing `ResizeObserver` (antd 6
  popup alignment) and `matchMedia`, and one Select test no longer depends on
  the removed `.ant-select-selector` internal node (antd 6 renders
  `.ant-select-content`). Full suite 176 files / 1117 tests green; tsc and
  `vite build` clean; browser smoke: canvas clicks, menu open, hover submenu,
  data-bar apply + paint all verified.

### Fixes (P0 回归与体验批)

- **React 18.3 `findDOMNode` deprecation warning — diagnosed, dev-only.** The
  toolbar-mount console warning comes from the antd 5.29 dependency chain's
  defensive fallback (rc-motion 2.9.5 / rc-resize-observer resolve a motion
  child without a forwarded ref via `findDOMNode`); our own code calls it
  nowhere, rc-select already avoids it, and rc-motion 2.9.5 is the latest
  2.x — no fixed upgrade exists below antd 6. Production builds never
  include it (verified: zero occurrences in `dist`), and it has no
  functional effect; the clean removal path is the antd v6 upgrade.
- **Corrupt autosave bricked the app on load (P0)** — `Store.replaceAll`
  cleared the sheet maps BEFORE deserializing the incoming sheets, so a
  corrupt autosave blob (sheet data missing `cells` — e.g. saved from a
  half-dead HMR page) aborted the swap mid-way with `activeSheetId` still
  pointing at a cleared sheet. The demo's restore `.catch` swallowed the
  error and every later read threw `Unknown sheet: sheet-1` — a canvas
  double-click crashed the React tree and the page went dead. `replaceAll`
  now deserializes every sheet first and swaps atomically: corrupt data
  throws with the live store untouched; `caretOffsetAtClick` additionally
  degrades to caret 0 instead of crashing on a transiently broken store.
- **Protected sheet edit entry (UX)** — with sheet protection on, F2 /
  double-click / typing now refuse to open the cell editor outright (one
  warning per attempt, Excel semantics) instead of opening it and rejecting
  each keystroke on commit — which spammed one toast per character typed.
  The commit-path guard remains as a backstop for protection enabled mid-edit.
- **Editor Escape dropped grid focus (P0)** — after cancelling a cell edit with
  Escape, focus fell to `<body>` (the unmounting textarea takes it with it):
  arrows, F2 and undo stayed dead until the next canvas click. Cancel now
  refocuses the canvas exactly like commit does, clearing `editingRef` first so
  the refocus-blur cannot re-commit the cancelled draft through the editor's
  blur-commit path. Covers the plain editor, the rich editor and the formula
  bar's Escape (which also returns to the grid now). Regression-tested in
  `Spreadsheet.test.tsx` (cell stays empty + `activeElement` is the canvas).
- **Name box first-click select-all** — clicking into an already-focused name
  box placed the caret mid-reference, so typing produced `Z7B774`-style garbage
  refs. The first click into an unfocused name box now selects all (Excel
  semantics); a second click positions the caret as before.
- **Modal close freeze (P0)** — rc-motion leave animations can freeze in
  embedded webviews (no `animationend`); a closed dialog left a full-viewport
  `.ant-modal-wrap` swallowing every click until reload. Closed modal layers
  now hide immediately via the same guard the dropdown fix uses
  (`.ant-modal.ant-zoom-leave` / `.ant-modal-mask.ant-fade-leave` / wrap
  `.ss-modal-leave-hide`, mirrored onto the wrap by a page script — engines
  without `:has()` stay covered and re-open still works).
- **Editor caret regression (P0)** — re-opening the same cell (F2 / double-click
  after a committed edit) left the caret at position 0, so typing prepended
  (`SUM(B2:B4)=`). Root cause: the caret guard key never reset on unmount.
- **Hyperlink Ctrl/Cmd+click follow** — the follow navigates during mousedown,
  but the trailing mouseup re-applied the clicked cell and stomped the target;
  navigation now survives the mouseup (macOS: use Cmd+click — Ctrl+click is the
  system right-click). The mouseup-suppress flag is scoped to a single gesture
  (reset on the next mousedown), so a swallowed mouseup cannot leak into later
  clicks. Dead `onHyperlinkClick` gesture option removed.
- **Demo autosave restore** — the demo seeded `options.data`, which opts the
  SDK out of its own restore; a refresh silently lost all edits while IndexedDB
  held them. The demo now restores the last autosave itself (`loadWorkbook`
  exported for hosts with the same need); restore failures are caught
  (private-mode IndexedDB) and the undo stack is cleared across the restore
  boundary, matching the SDK's own restore.
- **Row/column drag origin** — dragging row headers 2:4 left the active cell on
  the LAST row (formula bar showed A4); Excel puts it on the drag origin (A2).
  `onSelectionChange` now carries the selection kind so row/column drags keep
  their kind.
- **Collapse/expand row groups by intersection** — after collapsing, the
  member rows are invisible so "展开选区组" could never fire; it now acts on
  every group intersecting the selection (Excel's outline `[+]` substitute),
  emitting one coalesced store event (`store.batch`) instead of one per row.
- **Hyperlink paste/fill** — session + system clipboard carry `hyperlink`; overwrite clears stale links; fill handle keeps links on straight copy; clipboard HTML uses `<a href>`.
- **In-sheet link sheet names** — Excel-style `'O''Brien'!A1` apostrophe escaping.
- **Comments UI removed** — context menu / dialog / red-triangle paint dropped (product: no comments).

### Features (Excel parity)

- **Tier-1 热门公式补齐（+24 个，总数 82）** — `SUMPRODUCT`；`FIND`（区分
  大小写）/ `SEARCH`（不区分大小写 + `*` `?` 通配）；`SUBSTITUTE` / `REPLACE` /
  `EXACT`；`DATE` / `TIME` / `DATEDIF`（Y/M/D/YM/YD/MD）；`LARGE` / `SMALL` /
  `MEDIAN`；`RANK.EQ` / `RANK`（并列最优名次）；`STDEV.S` / `STDEV.P`（含
  `STDEV` / `STDEVP` 别名）；`MAXIFS` / `MINIFS`；`ROW` / `COLUMN`（无参返回
  公式所在行列）/ `ROWS` / `COLUMNS`。parser 支持带点函数名（`RANK.EQ`）。

- **Decimal-places toolbar buttons** — 增加/减少小数位数 (`.0→.00` / `.00→.0`),
  Excel Number-group behavior via `adjustDecimalPlaces` (general → `0.0`;
  number/percent lower to custom strings; currency/date/time/scientific no-op).

- **Review fixes (P2/P3)** — icon-set percent stats cached per range (invalidated on
  store events); left-aligned text pads right of icon glyphs; named ranges keep the
  referenced sheet in `def.sheetId` so `FormulaEngine.nameResolver` evaluates
  cross-sheet; name-rename conflicts ask before overwrite.

- **Phase D conditional formatting** — icon sets (3 arrows / 3 traffic lights, percent
  or number thresholds), highlight shortcut dialogs (大于/小于/介于/等于), and
  管理规则… dialog (`SetSheetConditionalRulesCommand`, single-step undo; rules can be
  reordered / toggled disabled / deleted).

- **Phase E name manager** — 公式(M) → 名称管理器…: list / create / edit / delete
  named ranges (A1 input via `parseNameBoxInput`); not undoable, matching Excel.

- **Hyperlinks (no comments)** — `Cell.hyperlink`; 插入 → 链接…; Ctrl+click opens;
  blue underline paint; SheetJS `l` round-trip best-effort. Comments explicitly out of scope.

- **Phase B data tools** — 数据 → 删除重复项… / 分列… (delimiter mode);
  undoable commands `RemoveDuplicatesCommand` / `TextToColumnsCommand`.

- **Phase A hot formulas** — `HLOOKUP`, `XLOOKUP` (exact + wildcard, no spill),
  `AVERAGEIF`/`AVERAGEIFS`, `SUBTOTAL` (skips hidden rows; STDEV/VAR → `#N/A`),
  `TEXTJOIN`. Plan: `docs/plan/2026-09-20-excel-parity-hot-features.md`.

- **Indent / text rotation / numfmt color** — `Style.indent` + toolbar; `textRotation` select; custom formats `[Red]`/`[>100]` with paint color.
- **CF cellValue + expanded DV** — 单元格值规则; validation decimal / textLength / custom.
- **Cross-app HTML paste styles** — `<td>` bold/color/fill → `pasteStyle` → styleId.

- **Cell strikethrough** — `Style.strike` mid-line on canvas, toolbar 删除线,
  editor `line-through`; rich runs inherit cell strike.

- **Formula high-freq + circular** — `SUMIF`/`SUMIFS`/`COUNTIFS`, `IFERROR`/`IFNA`,
  `TEXT`/`VALUE`/`ROUNDUP`/`ROUNDDOWN`/`POWER`/`SQRT`/`PI`, `IS*` helpers,
  `CONCATENATE`; circular refs yield `0` (Excel iteration-off). Docs: error
  values already first-class (guide was stale).

- **Sheet Move or Copy dialog** — Sheet tab context menu 「移动或复制…」 opens
  Excel-style dialog (insert before / end, optional create copy). `Store.copySheet`
  deep-clones via serialize; copy names `Sheet1 (2)`, `Sheet1 (3)`, …

### Bug Fixes (Excel parity, GUI 体验回归)

- **公式数组运算 + 三处新函数修正（review 跟进）** — 二元运算符升级为
  数组感知（任一侧为数组即逐元素求值、标量广播）：`SUMPRODUCT((区域="x")*区域)`
  等经典条件求和模式从"只取首元素"静默出错变为正确结果；`DATEDIF` 改用
  EDATE 式钳位月加法（1月31日+1月=2月29日而非3月2日，`M`/`MD`/`YM`/`YD`
  月末行为对齐 Excel）；`SUBSTITUTE` 第 n 个实例改为非重叠计数
  （`SUBSTITUTE("aaa","aa","x",2)` 保持原文，与 Excel 一致）。

- **P1 超链接：编辑文本丢链接 / 点击无响应** — `cellFromText` 不再在每次
  文本提交时删除 `hyperlink`（Excel：编辑链接单元格的显示文字保留链接，
  仅清空内容才移除；Delete 删格仍走 `clearRange` → 删除链接）。渲染器新增
  `onHyperlinkClick`：在链接单元格上**普通按下并松开（无拖动）即打开链接**
  （Google Sheets 习惯），Ctrl/Cmd+click 依旧可用；拖拽扩展选区不触发。

- **P0 跨表撤销数据丢失** — 所有命令（26 处实现 + sheetSnapshot / merge /
  shiftFormulas / chart-anchor 辅助）在执行时捕获所在工作表并在该表上撤销/重做：
  修复"在 Sheet2 编辑 → 切回 Sheet1 → Ctrl+Z 把 Sheet1 同坐标数据清空"的
  数据损毁路径（`RestoreSheet` 恢复时也不再误清源表）。
- **P0 撤销隔离回归测试** — `CrossSheetUndo.test.ts`：单元格 / 样式 / 插入行 /
  列宽四类命令的跨表 undo/redo 隔离。
- **F4 重复过期命令** — `CommandManager.clear()` 同时清空 `lastExecuted`，
  导入新工作簿后 F4 不再重放旧命令。
- **缩放重建渲染器** — Ctrl+滚轮缩放 / 显示公式 / 网格切换改为
  `CanvasRenderer.setViewOptions` 就地更新（`AxisIndex`/`VirtualScroller`
  支持默认行列尺寸更新），不再每步销毁重建渲染器、重绑 DOM 事件。
- **浮动图表手势监听器** — 组件在手势中途卸载时立即解绑 window
  pointermove/pointerup（此前要等下一次 pointerup 才移除）。

- **Rich text P0 vs Excel** — Formula-bar edits keep run styles via
  `applyTextChangeToRuns`; collapsed caret Ctrl+B/I/U arms typing style;
  double-click places caret near the click; in-cell paste accepts HTML runs.

- **Rich text P1 vs Excel** — Ctrl+Enter fills selection with the anchor cell's
  `richText` runs; double-click caret uses Y for Alt+Enter / wrap lines
  (`caretOffsetFromLocalPoint`); theme `<color theme tint>` applies OOXML tint
  on the built-in Office palette (still no theme1.xml).

- **P2 theme lock (Excel green)** — Tokens document Excel green as final; add
  `--ss-outside` gray beyond the sheet, `--ss-font-size: 11px`. Default font
  size centralized as `DEFAULT_FONT_SIZE = 11`.
- **General alignment** — Unset `style.align` now follows Excel General:
  numbers right, booleans center, text/formula-view left (explicit align wins).

- **Merged active-cell selection fill** — Selection tint now punches out the
  whole merged active area (not just the anchor cell), matching Excel.
- **Narrow numeric columns show ###** — Numbers/dates that do not fit the
  column width render as Excel-style hash fill instead of overflowing.
- **Sheet tab context menu** — Right-click a sheet tab opens 重命名 / 删除
  (delete still confirms); no longer deletes immediately on contextmenu.
- **Sheet tab drag reorder + color** — Drag tabs to reorder; context menu
  picks a tab tint (persisted in workbook serialize).

- **F2 upgrades enter → edit mode** — While typing (enter mode), F2 switches
  to edit mode so arrows move the caret instead of committing; formula-bar Esc
  in ready mode restores the active cell draft.

- **Formula bar ↔ cell editor lockstep** — While editing, formula-bar typing
  updates the in-cell draft; Esc cancels the edit (same as cell Esc). Formula
  bar / commit target the active cell, not only the selection origin.

- **Cell editor caret position** — Opening the editor (typing, F2, double-click)
  now places the caret after the typed text / at the end of the content,
  matching Excel; previously it stayed at position 0, so F2-edits prepended
  ("100" + "5" → "5100") and continued typing reversed order. Verified via DOM
  selectionStart on all three entry paths.
- **Point-mode arrow interception in edit mode** — Arrow keys with the caret
  after a formula operator no longer enter reference-pointing while in edit
  mode (F2/double-click); they move the caret like Excel. The stray references
  previously spliced into the formula (the "broken F4" symptom) are gone; F4
  itself now toggles the reference under the caret (`B2` → `$B$2`) correctly.
- **Add/rename sheet modal** — The sheet tab "+" and double-click rename used
  `window.prompt`, which embedded browsers auto-dismiss (the button silently
  did nothing). Both now open an in-app antd modal (default `Sheet<N>` name,
  Enter confirms); 删除工作表 uses `Modal.confirm`.
- **Conditional formatting range scoping** — dataBar/colorScale/formula rules
  now paint only cells inside the range the rule was created for
  (`ConditionalService` parses the stored `r1,c1:r2,c2` key); previously a
  data bar applied to B2:B5 painted every numeric cell on the sheet.
- **公式条件 dialog** — 格式 → 条件格式 → 公式条件 opens an in-app modal
  (required formula, =A1>0 default) instead of `window.prompt`, which was
  suppressed in embedded browsers and made the menu item a no-op.

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
