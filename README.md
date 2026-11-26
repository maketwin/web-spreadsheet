# web-spreadsheet

![version](https://img.shields.io/badge/version-v2.1.0-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)
![typescript](https://img.shields.io/badge/TypeScript-strict%20%7C%20zero--any-3178c6)
![tests](https://img.shields.io/badge/tests-2207%20passed-brightgreen)

A modern, lightweight TypeScript spreadsheet SDK — a canvas-rendered,
Excel-compatible grid with a formula engine, full undo/redo, and a plugin
system, organized as a one-way dependency graph: a headless
store/formula/commands kernel that the renderer and the React shell depend
on, never the other way around.

**[Documentation](https://maketwin.github.io/web-spreadsheet/) · [Changelog](./CHANGELOG.md)**

```ts
import { Spreadsheet } from 'web-spreadsheet';
import 'web-spreadsheet/styles.css';

const ss = new Spreadsheet('#root', {
  data: [
    [{ text: '产品' }, { text: 'Q1' }, { text: 'Q2' }, { text: '总计' }],
    [{ text: '产品A' }, { text: '100' }, { text: '120' }, { formula: '=SUM(B2:C2)' }],
  ],
});
ss.mount();
```

The stylesheet is a separate entry — the JS entry does not pull it in, so
import it once (see [Package entries](#package-entries)).

## Features

**Grid & editing**
- Excel-sized grid — 1,048,576 rows × 16,384 columns — over sparse storage: the address space is not an allocation, cost tracks the stored cells, not the selection
- Canvas renderer with virtual scrolling (O(log n) coordinate lookups; the scroller is benchmarked smooth at 10k+ rows) and dirty-region repainting
- Column/row default styles (Excel whole-column/whole-row formatting): effective style resolves cell > row default > column default, applies to blank and future cells at O(axis length)
- Excel-style chrome: menu bar, toolbar, formula bar, status bar, sheet tabs, context menu
- Cell editing with IME (Chinese input) support, find & replace, freeze panes
- Touch devices: one-finger pan, long-press context menus (cells / headers / sheet tabs), pinch zoom, and soft-keyboard-aware editing (desktop mouse behavior is untouched)
- Find & replace: case/whole-cell/regex matching, sheet or workbook scope, find-all list with cross-sheet jumps, single-undo replace-all, yellow highlights with an orange current-match outline
- Row/column drag-resize, double-click auto-fit, merged cells, borders
- Hide/unhide rows and columns from the header context menus (one-step unhide-all)
- Rich text in cells (per-run fonts/colors), hyperlinks (插入 → 链接, Ctrl+click to open), cell strikethrough / indent / text rotation
- Editable name box: jump to `A1`, ranges, `Sheet2!A1` or defined names; full name manager dialog
- Accessibility: ARIA roles across the UI, keyboard navigation, `focus-visible` outlines, dark mode

**Excel-parity fill handle**
- Plain drag smart-fills: numeric trends (least-squares for non-arithmetic sources, like Excel's TREND), dates, weekday/month lists (en + zh), text+number (`Item1 → Item2`)
- Lone numbers and plain text copy; **Ctrl toggles** like Excel (series-able sources copy, a lone number increments)
- Fills in all four directions — upward/leftward drags continue the series backwards
- Formula references shift along the fill (`$A$1` / `$A1` / `A$1` absolute semantics respected); cell styles carry over

**Formula engine**
- 96 built-in functions (SUM, AVERAGE, IF, VLOOKUP, XLOOKUP, INDEX/MATCH, SUBTOTAL, COUNTBLANK, date/time, text, …)
- Dynamic-array spill, Excel-365 style: `SEQUENCE` / `FILTER` / `UNIQUE` / `SORT` and multi-cell `XLOOKUP` results overflow into neighbouring cells (`#SPILL!` when blocked, auto-recovers)
- Dependency graph with automatic recalculation
- Whole-column/whole-row and open-ended references (`=SUM(A:A)`, `=SUM(B2:B)`) evaluate exactly over huge ranges by walking the stored cells only
- Cross-sheet references (`=Sheet2!A1`, `=SUM(Sheet2!A1:A5)`)
- Custom functions can declare a `FunctionContext` (the calling cell/sheet); volatile functions (`NOW` / `TODAY`) re-evaluate on every recalc pass that has work, so a sheet open across midnight stays current; per-engine private function registries keep plugin registrations from leaking

**Commands & undo**
- Command pattern for every mutation — **all 42 commands are undoable**, with test coverage for each
- Undo restores formula results too (batched deferred recalc)
- Every command carries a stable `kind()` identity; 31 kinds are replayable from recorded arguments (the mock platform's timeline replay)

**Data features**
- AutoFilter with criteria dropdowns and range sorting (Ctrl+Shift+L toggles)
- Data validation, conditional formatting (data bars, color scales, icon sets, cell-value & formula rules)
- Named ranges with a name manager, sheet protection (hashed password), row grouping outline
- Data tools: 删除重复项, 分列 (delimiter mode), sort by range
- Charts (Chart.js, 插入 → 图表) and in-cell sparklines (line/bar/win-loss, 插入 → 迷你图)
- Custom number format strings — Excel syntax: `#,##0.00`, `0.00E+00`, `yyyy-mm-dd`, `h:mm AM/PM`, `正;负;零;文本` sections, with xlsx round-trip

**I/O & persistence**
- Real xlsx import/export (SheetJS + fflate, deflate-compressed output): number formats, cell styles and borders, column/row widths & heights and axis default styles, freeze panes, the autofilter range, conditional formats and data validations round-trip (charts, comments and hyperlinks import; images/sparklines and filter criteria are not exported)
- CSV/TSV and JSON import, CSV export (BOM'd UTF-8, displayed values), JSON/xlsx export
- Auto-save to IndexedDB (1.5 s after the last change, at the latest 5 s after the first unsaved one, and immediately when the page is left) with startup restore
- Paginated printing: print preview with paper/orientation/margins/scale settings, merged-cell-aware page breaks, 192-dpi offscreen page rendering with progressive page-by-page rendering (cancelable, floating data-URL images printed), 当前工作表 / 整个工作簿 scope (`Ctrl+P`), PDF export

**Extensibility**
- Plugin system with a typed `PluginAPI` (see `src/plugin/CsvImportPlugin.ts` for an example)
- The building blocks are exported from the package root: Store, EventBus, FormulaEngine, VirtualScroller, the row/column, style and chart commands, theming

## Architecture

```
[User]
   ↓
[Entrances]                  src/index.ts (full SDK)  src/core.ts (headless)
   ↓
[UI / delivery]              src/components/  src/renderer/  src/io/
                             src/print/  src/db/  src/platform/
   ↓
[Kernel]                     src/commands/   (42 commands + undo)
                             src/store/  src/formula/  src/events/
   ↓
[Base]                       src/types.ts  src/util/ (grid constants)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full breakdown.

## Scale & experiments

The grid is Excel's address space (1,048,576 × 16,384) over sparse storage, so
large workbooks stay interactive. Two repeatable harnesses live in the repo:

```bash
pnpm bench:scale         # Node benchmarks (store / many sheets / formulas / I/O) → coverage/scale-bench/*.json
pnpm e2e:scale           # real-browser timings: time-to-screen and longest main-thread block (opt-in; not part of `pnpm e2e`)
```

Representative numbers (Apple-Silicon laptop, Node): one million-cell column
fills in ~0.9 s and `forEachCell` walks it in ~10 ms; a row insert above it +
undo ~0.3 s / 0.26 s (was 1.2 s / 1.0 s); Delete on that column + undo ~0.2 s
/ 0.26 s (was 2.6 s / 3.3 s with formulas attached); whole-column bold ~0.3
ms; `=SUM(A:A)` over a million numbers ~60 ms; a 1M-cell xlsx round-trip
exports in 6.9 s / 9.6 MB and imports in 2.7 s; in a real browser scrolling
that sheet never drops a frame and the auto-save no longer blocks the main
thread. Details, the full tables and what is still slow:
[docs/guide/scale.md](./docs/guide/scale.md).

## Getting started

```bash
# Install (not yet on npm — install from git)
# React 18 or 19 is a peer dependency and must be installed in the host app.
pnpm add react react-dom
pnpm add github:maketwin/web-spreadsheet

# Or run the demo locally
git clone https://github.com/maketwin/web-spreadsheet.git
cd web-spreadsheet
pnpm install --ignore-scripts
pnpm dev
```

The `Spreadsheet` facade accepts an element, an element id (`'app'`) or a CSS
selector (`'#app'`, `'.sheet-host'`) as its first argument — a string is looked
up as an id first, then as a selector, and throws a descriptive `Error` when
neither matches. Options (`data`, `theme`, callbacks for every UI event) come
second. The instance exposes `store` / `formula` / a command manager, and
destroys cleanly with `ss.destroy()`. The component fills its container
(`width: 100%; height: 100%`), so give the container a size of its own.

## Package entries

| Entry | Contents |
|-------|----------|
| `web-spreadsheet` | The full SDK with the React UI: ESM (`import`) and CommonJS / UMD (`require`) |
| `web-spreadsheet/core` | Headless: `Store`, `FormulaEngine`, `CommandManager`, `EventBus`, `CanvasRenderer` and services — no antd / chart.js / xlsx / dexie (ESM only) |
| `web-spreadsheet/styles.css` | Component styles: theme variable tokens plus the layout and appearance rules |

```ts
import { Spreadsheet } from 'web-spreadsheet';
import 'web-spreadsheet/styles.css'; // once, from the app entry
```

The styles are not part of the JS entry: Vite's library build emits them as a
separate file and adds no import to the JS, so bundlers do not pick the CSS up
on their own. The UMD bundle (`dist/web-spreadsheet.umd.cjs`) does not inline
them either — when loading it through a `<script>` tag, add a `<link>` to
`dist/web-spreadsheet.css` as well.

## Development

```bash
pnpm dev            # dev server with HMR
pnpm test           # vitest — 2,207 tests, 295 files
pnpm e2e            # Playwright (chromium desktop + chromium-touch 390×844) — context menus, dialogs & touch gestures in a real browser
pnpm e2e:scale      # real-browser scale experiment (opt-in): a million cells and 50 sheets, longest main-thread block per action
pnpm typecheck      # tsc --noEmit (strict, noUncheckedIndexedAccess)
pnpm lint           # eslint
pnpm build          # typecheck + library build (ESM, CommonJS/UMD, CSS + d.ts)
pnpm check:dist     # smoke-check the built package: ESM import, CommonJS require, stylesheet, type entries
pnpm coverage       # test coverage report
pnpm docs:dev       # VitePress documentation site
```

Quality gates: zero `any`, zero `eslint-disable`, every module tested, and
the layering rules lint-enforced (see [ARCHITECTURE.md](./ARCHITECTURE.md)).

## Credits

Rewritten from scratch, with the project history originating from
[x-spreadsheet](https://github.com/myliang/x-spreadsheet) by myliang (MIT).
Original work © myliang; this codebase is an independent, full rewrite.

## License

[MIT](./LICENSE) © sunxin
