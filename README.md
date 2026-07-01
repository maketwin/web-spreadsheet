# web-spreadsheet v2.0

![version](https://img.shields.io/badge/version-v1.1.0-brightgreen)

A modern, lightweight TypeScript spreadsheet SDK with 4-layer architecture.
Built from scratch based on the original [x-spreadsheet](https://github.com/myliang/x-spreadsheet)
(MIT, 14.6k ⭐) — but with TypeScript strict, virtual scrolling, formula
engine, and plugin system.

> **Status:** v1.1.0 released. See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## Features

### Core
- [x] TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [x] Vite 5 + vitest
- [x] Dark mode CSS variables
- [x] 4-layer architecture (facade/commands/store/renderer)

### Data Layer
- [x] Store (reactive snapshot data layer)
- [x] EventBus (subscribe + wildcard)
- [x] Command pattern + undo/redo
- [x] Multi-sheet support (add/rename/delete/activate)

### Rendering
- [x] Virtual scrolling (visible range calculation)
- [x] Dirty region tracking
- [x] Canvas renderer + React UI shell
- [x] Row height / column width drag-resize
- [x] Double-click auto-fit row/column
- [x] Freeze panes

### Formula Engine
- [x] 32 built-in functions (SUM, AVERAGE, IF, VLOOKUP, etc.)
- [x] Dependency graph with automatic recalculation
- [x] Cross-sheet formula references (=Sheet2!A1, =SUM(Sheet2!A1:A5))

### UI Components
- [x] Excel-style top menu bar (File/Edit/View/Insert/Format/Tools/Help)
- [x] Interaction toolbar (bold/italic/underline/align/zoom/formula/grid)
- [x] Formula bar with cell reference display
- [x] Status bar (cell count, selection SUM/AVG, zoom, auto-save indicator)
- [x] Bottom sheet tabs (sticky at viewport bottom)
- [x] Context menu
- [x] Double-click cell edit with IME (Chinese input method) support

### Formatting
- [x] Cell styles (bold, italic, underline, color, bgcolor, align, font)
- [x] Number format (currency/percent/date/time/scientific)
- [x] Conditional formatting (data bar, color scale, formula conditions)
- [x] Format painter (copy cell styles with brush mode)
- [x] Merge/unmerge cells

### File I/O
- [x] Auto-save to IndexedDB (1.5s debounce, restore on startup)
- [x] Real xlsx import/export (SheetJS)
- [x] JSON import/export
- [x] CSV/TSV import
- [x] File menu save/open/import/export actions

### Other
- [x] Fill handle drag-to-fill (copy/series modes)
- [x] Find and replace
- [x] Plugin system
- [x] Keyboard shortcut integration
- [x] Chart stub dialog (placeholder)

## Architecture
```
[User]
   ↓
[Layer 4: API / Facade]      src/index.ts
   ↓
[Layer 3: Commands]           src/commands/
   ↓
[Layer 2: Store + Formula]    src/store/  src/formula/
[Layer 2b: Event Bus]         src/events/
   ↓
[Layer 1: Renderer]           src/renderer/  src/components/
```

## Development
```bash
# Install
pnpm install --ignore-scripts

# Dev (with HMR)
pnpm dev

# Type check
pnpm typecheck

# Run tests
pnpm test

# Build library
pnpm build
```

## License
MIT — see [LICENSE](./LICENSE).
