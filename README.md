# web-spreadsheet v2.0

A modern, lightweight TypeScript spreadsheet SDK with 4-layer architecture.
Built from scratch based on the original [x-spreadsheet](https://github.com/myliang/x-spreadsheet)
(MIT, 14.6k ⭐) — but with TypeScript strict, virtual scrolling, formula
engine, and plugin system.

> **Status:** v2.0 development in progress. See [PLAN.md](./PLAN.md) for the 7-week roadmap.

## Features (planned)
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
- [x] Formula engine v1 (30 functions)
- [ ] Plugin system

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
