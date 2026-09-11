# web-spreadsheet

![version](https://img.shields.io/badge/version-v1.5.0-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)
![typescript](https://img.shields.io/badge/TypeScript-strict%20%7C%20zero--any-3178c6)
![tests](https://img.shields.io/badge/tests-442%20passed-brightgreen)

A modern, lightweight TypeScript spreadsheet SDK — a canvas-rendered,
Excel-compatible grid with a formula engine, full undo/redo, and a plugin
system, wrapped in a clean 4-layer architecture.

**[Documentation](https://maketwin.github.io/web-spreadsheet/) · [Changelog](./CHANGELOG.md)**

```ts
import { Spreadsheet } from 'web-spreadsheet';

const ss = new Spreadsheet('#root', {
  data: [
    [{ text: '产品' }, { text: 'Q1' }, { text: 'Q2' }, { text: '总计' }],
    [{ text: '产品A' }, { text: '100' }, { text: '120' }, { formula: '=SUM(B2:C2)' }],
  ],
});
ss.mount();
```

## Features

**Grid & editing**
- Canvas renderer with virtual scrolling (1000 × 26, smooth at 10k-row benchmarks) and dirty-region repainting
- Excel-style chrome: menu bar, toolbar, formula bar, status bar, sheet tabs, context menu
- Cell editing with IME (Chinese input) support, find & replace, freeze panes
- Row/column drag-resize, double-click auto-fit, merged cells, borders
- Accessibility: ARIA roles across the UI, keyboard navigation, `focus-visible` outlines, dark mode

**Excel-parity fill handle**
- Plain drag smart-fills: numeric trends (least-squares for non-arithmetic sources, like Excel's TREND), dates, weekday/month lists (en + zh), text+number (`Item1 → Item2`)
- Lone numbers and plain text copy; **Ctrl toggles** like Excel (series-able sources copy, a lone number increments)
- Fills in all four directions — upward/leftward drags continue the series backwards
- Formula references shift along the fill (`$A$1` / `$A1` / `A$1` absolute semantics respected); cell styles carry over

**Formula engine**
- 32 built-in functions (SUM, AVERAGE, IF, VLOOKUP, INDEX/MATCH, date/time, text, …)
- Dependency graph with automatic recalculation
- Cross-sheet references (`=Sheet2!A1`, `=SUM(Sheet2!A1:A5)`)

**Commands & undo**
- Command pattern for every mutation — **all 22 commands are undoable**, with test coverage for each
- Undo restores formula results too (batched deferred recalc)

**Data features**
- AutoFilter with criteria dropdowns and range sorting
- Data validation, conditional formatting (data bars, color scales, formula rules)
- Named ranges, sheet protection (hashed password), sparklines, charts (Chart.js)
- Custom number format strings — Excel syntax: `#,##0.00`, `0.00E+00`, `yyyy-mm-dd`, `h:mm AM/PM`, `正;负;零;文本` sections, with xlsx round-trip

**I/O & persistence**
- Real xlsx import/export (SheetJS) including number formats
- CSV/TSV and JSON import, auto-save to IndexedDB with startup restore

**Extensibility**
- Plugin system with a typed `PluginAPI` (see `src/plugins/CsvImportPlugin.ts` for an example)
- Everything is exported from the package root: Store, EventBus, FormulaEngine, VirtualScroller, every Command class, theming

## Architecture

```
[User]
   ↓
[Layer 4: API / Facade]      src/index.ts
   ↓
[Layer 3: Commands]           src/commands/   (22 commands + undo)
   ↓
[Layer 2: Store + Formula]    src/store/  src/formula/
[Layer 2b: Event Bus]         src/events/
   ↓
[Layer 1: Renderer]           src/renderer/  src/components/
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full breakdown.

## Getting started

```bash
# Install (not yet on npm — install from git)
pnpm add github:maketwin/web-spreadsheet

# Or run the demo locally
git clone https://github.com/maketwin/web-spreadsheet.git
cd web-spreadsheet
pnpm install --ignore-scripts
pnpm dev
```

The `Spreadsheet` facade accepts an element (or selector) plus options
(`data`, `theme`, callbacks for every UI event), exposes `store` /
`formula` / a command manager, and destroys cleanly with `ss.destroy()`.

## Development

```bash
pnpm dev            # dev server with HMR
pnpm test           # vitest — 442 tests, 88 files
pnpm typecheck      # tsc --noEmit (strict, noUncheckedIndexedAccess)
pnpm lint           # eslint
pnpm build          # typecheck + library build (ESM/UMD + d.ts)
pnpm coverage       # test coverage report
pnpm docs:dev       # VitePress documentation site
```

Quality gates: zero `any`, zero `as` without justification, 300-line file
limit, every module tested.

## Credits

Rewritten from scratch, with the project history originating from
[x-spreadsheet](https://github.com/myliang/x-spreadsheet) by myliang (MIT).
Original work © myliang; this codebase is an independent, full rewrite.

## License

[MIT](./LICENSE) © sunxin
