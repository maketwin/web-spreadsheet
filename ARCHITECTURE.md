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

`src/renderer/` contains virtual scrolling, dirty-region tracking, and canvas painting. `src/components/` provides the React UI shell around the canvas, toolbar, bottom bar, editor, and menu.

### Layer 2: Store / Formula / Events

`src/store/Store.ts` owns spreadsheet data and exposes reactive subscriptions plus serialization. `src/formula/` parses, evaluates, registers functions, tracks dependencies, and recalculates affected cells. `src/events/EventBus.ts` provides app-level events and wildcard subscriptions.

### Layer 3: Commands

`src/commands/` contains all write operations. Commands mutate the store through `CommandManager`, so undo/redo and command events are centralized.

### Layer 4: API / Facade

`src/index.ts` exports the public SDK surface. The `Spreadsheet` facade accepts an element or element id, exposes core services, and delegates plugin installation through `.use(plugin)`.

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

## File map

| Path | Purpose |
| --- | --- |
| `src/store/` | Reactive spreadsheet data, snapshots, deserialize |
| `src/commands/` | Command interface, command manager, undo/redo operations |
| `src/formula/` | Parser, evaluator, registry, dependency graph, formula engine |
| `src/renderer/` | Virtual scroller, dirty-region tracker, canvas renderer |
| `src/components/` | React shell and user-facing UI components |
| `src/plugin/` | PluginManager, PluginAPI, public plugin contract |
| `src/events/` | EventBus with direct and wildcard subscriptions |
| `src/theme/` | CSS variables, light/dark theme utilities |
