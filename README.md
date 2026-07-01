# web-spreadsheet v2.0

![version](https://img.shields.io/badge/version-v1.0.0-brightgreen)

A modern, lightweight TypeScript spreadsheet SDK with 4-layer architecture.
Built from scratch based on the original [x-spreadsheet](https://github.com/myliang/x-spreadsheet)
(MIT, 14.6k ⭐) — but with TypeScript strict, virtual scrolling, formula
engine, and plugin system.

> **Status:** v1.0 released. See [PLAN.md](./PLAN.md) for the 7-week roadmap.

## Features
- [x] TypeScript strict
- [x] Vite 5 + vitest
- [x] Dark mode CSS variables
- [x] 4-layer architecture (facade/commands/store/renderer)
- [x] Store (reactive snapshot data layer)
- [x] EventBus (subscribe + wildcard)
- [x] Command pattern + undo/redo
- [x] Virtual scrolling (visible range calculation)
- [x] Dirty region tracking
- [x] Canvas renderer + React UI placeholders
- [x] Formula engine v1 (32 functions)
- [x] Plugin system
- [x] Excel-style top menu bar (File/Edit/View/Insert/Format/Tools/Help)
- [x] File menu with local open/save/import/export actions
- [x] Edit menu with undo/redo, clipboard, find/replace, select all, clear
- [x] Insert menu with row/column insert/delete and merge actions
- [x] Format menu with font, size, color, number format, alignment, wrap
- [x] View/Tools/Help menus with zoom, options, plugins, about, shortcuts
- [x] Keyboard shortcut integration for menu actions

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
