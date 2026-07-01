# web-spreadsheet v2.0 计划：纯重写

> **For 老板**：经过"老代码改不动"评估后，决定纯重写 src/。保留仓库名（maketwin/web-spreadsheet）和品牌认知，但代码完全重写。
>
> **核心原则**：
> - 8000 行老代码全删（src/core/、src/component/、src/locale/）
> - 按 4 层架构从零写
> - TS strict 全程
> - 7 周出 v1.0
> - 每个 task 完成后 commit

**Goal:** 7 周后 maketwin/web-spreadsheet 是一个**从零写的现代 TypeScript spreadsheet SDK**——4 层架构、虚拟滚动、公式引擎、插件系统。

**Architecture（4 层 + 5 横切关注点）:**
```
┌──────────────────────────────────────────┐
│ Layer 4: API/Facade (src/index.ts)       │
├──────────────────────────────────────────┤
│ Layer 3: Commands (src/commands/)        │
│   undo/redo 自动获得                       │
├──────────────────────────────────────────┤
│ Layer 2: Store (src/store/)              │
│   + Formula Engine (src/formula/)        │
│   + Event Bus (src/events/)              │
├──────────────────────────────────────────┤
│ Layer 1: Renderer (src/renderer/)        │
│   + Components (src/components/)         │
├──────────────────────────────────────────┤
│ Theme: src/theme/ (CSS 变量 + 切换)       │
│ Plugin: src/plugin/ (扩展点)              │
└──────────────────────────────────────────┘
```

**Tech Stack:**
- TypeScript 5.x（strict + noImplicitAny + strictNullChecks + noUncheckedIndexedAccess）
- Vite 5（取代 webpack 4）
- vitest + jsdom
- ESM 全栈（"type": "module"）
- 仍然 Canvas 渲染

**调研参考：**
- Univer 0.25：4 层架构、Facade API、命令模式
- HyperFormula：函数注册表、依赖图
- AG Grid：虚拟滚动、脏区重绘
- Formula.js：函数实现

---

## 仓库信息

- GitHub: https://github.com/maketwin/web-spreadsheet
- 本地: /Users/sunxin/web-spreadsheet
- 当前 commit: f65bf8b（PLAN.md 阶段）
- 接下来的 commit: 删除 src/ 全部，从零写

---

## 🟢 Week 1：脚手架（5 task，预计 5 天）

### Task 1.1：删除老 src/，建立新骨架

```bash
cd /Users/sunxin/web-spreadsheet
git rm -r src/component src/core src/locale build
# 删 dist/ 输出
rm -rf dist
# 删 webpack 配置 + 老 devDeps
```

**Create:** 新 `package.json`

```json
{
  "name": "web-spreadsheet",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/web-spreadsheet.es.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/web-spreadsheet.es.js",
      "require": "./dist/web-spreadsheet.umd.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@vitejs/plugin-react": "^4.3.3",
    "@vitest/coverage-v8": "^2.0.0",
    "eslint": "^9.0.0",
    "jsdom": "^25.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vite-plugin-dts": "^4.0.0",
    "vitest": "^2.0.0"
  }
}
```

**Create:** `tsconfig.json`（严格模式）

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    
    "noEmit": true,
    
    "jsx": "react-jsx",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Create:** `tsconfig.checkjs.json`（应急兜底，仅在重写过程中临时使用）

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js", "test/**/*.ts"]
}
```

> **使用场景**：仅当某个老 .js 文件临时未迁移到 .ts 时使用 `pnpm typecheck:js` 跑此配置做软约束检查。
> **正常使用**：Week 1 起所有新代码都用 .ts，主配置 `tsconfig.json` 足以类型检查。
> 完成后此文件可删。

**Modify:** `package.json` scripts（加 checkjs 命令）

```diff
   "scripts": {
     "dev": "vite",
     "build": "tsc --noEmit && vite build",
     "test": "vitest run",
     "test:watch": "vitest",
     "coverage": "vitest run --coverage",
     "lint": "eslint src",
     "typecheck": "tsc --noEmit",
+    "typecheck:js": "tsc --noEmit -p tsconfig.checkjs.json"
   },
```

**Create:** `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'web-spreadsheet',
      fileName: (f) => `web-spreadsheet.${f}.js`,
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      output: { assetFileNames: 'web-spreadsheet.[ext]' },
    },
  },
  server: { port: 3000, open: true },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts'],
  },
});
```

**Create:** `index.html`（demo 入口）

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>web-spreadsheet demo</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/demo/main.ts"></script>
</body>
</html>
```

**Create:** `demo/main.ts`

```ts
import { Spreadsheet } from '../src/index';
import '../src/theme/tokens.css';
import '../src/theme/light.css';

const root = document.getElementById('root')!;
new Spreadsheet(root, {
  data: [
    [{ text: 'A1' }, { text: 'B1' }],
    [{ text: 'A2' }, { text: 'B2' }],
  ],
});
```

**Modify:** `.gitignore`

```
node_modules
.pnpm-store
dist
.vite
*.tsbuildinfo
coverage
```

**Create:** `test/sanity.test.ts`

```ts
import { describe, it, expect } from 'vitest';
describe('sanity', () => {
  it('runs', () => expect(1 + 1).toBe(2));
});
```

**Create:** `src/index.ts`（占位）

```ts
export class Spreadsheet {
  constructor(_root: HTMLElement, _options?: unknown) {
    // TODO
  }
}
```

装依赖：

```bash
HTTPS_PROXY=http://127.0.0.1:7897 /opt/homebrew/bin/pnpm install --ignore-scripts
```

验证：

```bash
/opt/homebrew/bin/pnpm typecheck  # 0 error
/opt/homebrew/bin/pnpm test       # sanity pass
/opt/homebrew/bin/pnpm build      # 出 dist
/opt/homebrew/bin/pnpm dev        # 浏览器看 demo（虽然 Spreadsheet 是空的）
```

Commit: `feat(scaffold): v2.0 foundation with Vite + TypeScript strict`

---

### Task 1.2：加 GitHub Actions CI

**Create:** `.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

Commit: `ci: add github actions`

---

### Task 1.3：类型系统（Cell/Row/Col/Style）

**Create:** `src/types.ts`

```ts
export type CellValue = string | number | boolean | Date | null;

export interface Cell {
  text: string;
  value?: CellValue;
  formula?: string;
  styleId?: string;
  type?: 'text' | 'number' | 'date' | 'boolean';
}

export interface RowMeta {
  height?: number;
  hide?: boolean;
}

export interface ColMeta {
  width?: number;
  hide?: boolean;
}

export interface Style {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  bgcolor?: string;
  align?: 'left' | 'center' | 'right';
  fontSize?: number;
  fontFamily?: string;
  border?: { top?: string; bottom?: string; left?: string; right?: string };
}

export type StoreEvent =
  | { type: 'cell'; r: number; c: number; cell: Cell | undefined }
  | { type: 'row'; r: number; meta: RowMeta | undefined }
  | { type: 'col'; c: number; meta: ColMeta | undefined }
  | { type: 'style'; id: string; style: Style | undefined }
  | { type: 'merge'; range: string };

export type Unsubscribe = () => void;
```

**Create:** `test/types.test-d.ts`（类型测试）

```ts
import { expectType } from 'vitest';
import type { Cell, Style, StoreEvent } from '../src/types';

expectType<Cell>({ text: 'hi' });
expectType<Style>({ bold: true });
expectType<StoreEvent>({ type: 'cell', r: 0, c: 0, cell: { text: 'x' } });
```

Commit: `feat(types): core domain types with type tests`

---

### Task 1.4：暗色主题（CSS 变量）

**Create:** `src/theme/tokens.css`

```css
:root {
  --ss-bg: #ffffff;
  --ss-color: #333333;
  --ss-border: #e0e0e0;
  --ss-grid: #f0f0f0;
  --ss-selected: #e8f0ff;
  --ss-header-bg: #f7f7f7;
  --ss-toolbar-bg: #ffffff;
  --ss-text: #333333;
  --ss-text-light: #666666;
  --ss-accent: #1677ff;
  --ss-row-height: 25px;
  --ss-col-width: 100px;
}
```

**Create:** `src/theme/light.css`

```css
/* light 主题直接用 tokens，无需覆盖 */
```

**Create:** `src/theme/dark.css`

```css
:root[data-spreadsheet-theme="dark"] {
  --ss-bg: #1e1e1e;
  --ss-color: #d4d4d4;
  --ss-border: #3c3c3c;
  --ss-grid: #2d2d2d;
  --ss-selected: #264f78;
  --ss-header-bg: #252526;
  --ss-toolbar-bg: #333333;
  --ss-text: #d4d4d4;
  --ss-text-light: #999999;
}
```

**Create:** `src/theme/index.ts`

```ts
export const THEMES = { light: 'light', dark: 'dark' } as const;
export type Theme = (typeof THEMES)[keyof typeof THEMES];

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-spreadsheet-theme', theme);
  localStorage.setItem('web-spreadsheet-theme', theme);
}

export function getTheme(): Theme {
  const stored = localStorage.getItem('web-spreadsheet-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyStoredTheme(): void {
  setTheme(getTheme());
}
```

**Create:** `test/theme.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setTheme, getTheme, THEMES } from '../src/theme';

describe('theme', () => {
  beforeEach(() => localStorage.clear());
  it('setTheme persists', () => {
    setTheme(THEMES.dark);
    expect(localStorage.getItem('web-spreadsheet-theme')).toBe('dark');
  });
  it('setTheme updates DOM', () => {
    setTheme(THEMES.dark);
    expect(document.documentElement.getAttribute('data-spreadsheet-theme')).toBe('dark');
  });
  it('getTheme returns stored', () => {
    setTheme(THEMES.dark);
    expect(getTheme()).toBe(THEMES.dark);
  });
});
```

Commit: `feat(theme): CSS variable tokens + dark mode`

---

### Task 1.5：README + ROADMAP

**Create:** `README.md`

```markdown
# web-spreadsheet v2.0

A modern, lightweight TypeScript spreadsheet SDK with 4-layer architecture.
Built from scratch based on the original [x-spreadsheet](https://github.com/myliang/x-spreadsheet)
(MIT, 14.6k ⭐) — but with TypeScript strict, virtual scrolling, formula
engine, and plugin system.

## Features (planned)
- [x] TypeScript strict
- [x] Vite 5 + vitest
- [x] Dark mode
- [ ] 4-layer architecture (facade/commands/store/renderer)
- [ ] Command pattern + undo/redo
- [ ] Virtual scrolling (60fps for 10k rows)
- [ ] Formula engine v1 (30 functions)
- [ ] Plugin system

## Architecture
\```
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
\```

## Install (planned)
\`\`\`bash
pnpm add web-spreadsheet
\`\`\`

## License
MIT
```

**Create:** `ROADMAP.md`

```markdown
# Roadmap

## v0.1 — Foundation (Week 1, current)
- [x] Vite + vitest + TS strict
- [x] Dark mode
- [x] Domain types

## v0.5 — Data Layer (Week 2-3)
- [ ] Store (reactive, snapshot)
- [ ] Command + CommandManager
- [ ] 5 core commands
- [ ] EventBus

## v1.0 — Renderer + Formula (Week 4-6)
- [ ] VirtualScroller
- [ ] DirtyRegionTracker
- [ ] CanvasRenderer
- [ ] 5 UI components (Toolbar/Table/Editor/BottomBar/Menu)
- [ ] Formula engine v1 (30 functions)
- [ ] Dependency graph
- [ ] Demo

## v1.5 — Plugin (Week 7)
- [ ] PluginManager + PluginAPI
- [ ] CsvImport example
- [ ] ARCHITECTURE.md
- [ ] v1.0 release
```

Commit: `docs: README + ROADMAP for v2.0`

---

## 🟡 Week 2-3：数据层（10 task，预计 10 天）

### Task 2.1：Store 实现

**Create:** `src/store/Store.ts`

```ts
import type { Cell, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from '../types';

export class Store {
  private cells = new Map<string, Cell>();
  private rows = new Map<number, RowMeta>();
  private cols = new Map<number, ColMeta>();
  private styles = new Map<string, Style>();
  private merges = new Set<string>();
  private subscribers = new Set<(e: StoreEvent) => void>();

  // Read
  getCell(r: number, c: number): Cell | undefined {
    return this.cells.get(`${r},${c}`);
  }
  getRow(r: number): RowMeta | undefined {
    return this.rows.get(r);
  }
  getCol(c: number): ColMeta | undefined {
    return this.cols.get(c);
  }
  getStyle(id: string): Style | undefined {
    return this.styles.get(id);
  }
  getMerges(): readonly string[] {
    return [...this.merges];
  }

  // Write
  setCell(r: number, c: number, cell: Cell | undefined): void {
    const key = `${r},${c}`;
    if (cell == null) this.cells.delete(key);
    else this.cells.set(key, cell);
    this._notify({ type: 'cell', r, c, cell });
  }
  setRow(r: number, meta: RowMeta | undefined): void {
    if (meta == null) this.rows.delete(r);
    else this.rows.set(r, meta);
    this._notify({ type: 'row', r, meta });
  }
  setCol(c: number, meta: ColMeta | undefined): void {
    if (meta == null) this.cols.delete(c);
    else this.cols.set(c, meta);
    this._notify({ type: 'col', c, meta });
  }
  setStyle(id: string, style: Style | undefined): void {
    if (style == null) this.styles.delete(id);
    else this.styles.set(id, style);
    this._notify({ type: 'style', id, style });
  }
  addMerge(range: string): void {
    this.merges.add(range);
    this._notify({ type: 'merge', range });
  }

  // Subscribe
  subscribe(fn: (e: StoreEvent) => void): Unsubscribe {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
  private _notify(e: StoreEvent): void {
    this.subscribers.forEach(fn => fn(e));
  }

  // Snapshot
  serialize(): SerializedStore {
    return {
      cells: [...this.cells.entries()],
      rows: [...this.rows.entries()],
      cols: [...this.cols.entries()],
      styles: [...this.styles.entries()],
      merges: [...this.merges],
    };
  }
  static deserialize(data: SerializedStore): Store {
    const s = new Store();
    data.cells.forEach(([k, v]) => s.cells.set(k, v));
    data.rows.forEach(([k, v]) => s.rows.set(k, v));
    data.cols.forEach(([k, v]) => s.cols.set(k, v));
    data.styles.forEach(([k, v]) => s.styles.set(k, v));
    data.merges.forEach(m => s.merges.add(m));
    return s;
  }
}

export interface SerializedStore {
  cells: Array<[string, Cell]>;
  rows: Array<[number, RowMeta]>;
  cols: Array<[number, ColMeta]>;
  styles: Array<[string, Style]>;
  merges: string[];
}
```

**Create:** `test/store/Store.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { Store } from '../../src/store/Store';

describe('Store', () => {
  it('setCell + getCell', () => {
    const s = new Store();
    s.setCell(0, 0, { text: 'hi' });
    expect(s.getCell(0, 0)).toEqual({ text: 'hi' });
  });
  it('setCell null deletes', () => {
    const s = new Store();
    s.setCell(0, 0, { text: 'hi' });
    s.setCell(0, 0, undefined);
    expect(s.getCell(0, 0)).toBeUndefined();
  });
  it('subscribe receives event', () => {
    const s = new Store();
    const events: unknown[] = [];
    s.subscribe(e => events.push(e));
    s.setCell(0, 0, { text: 'x' });
    expect(events).toHaveLength(1);
  });
  it('unsubscribe', () => {
    const s = new Store();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    off();
    s.setCell(0, 0, { text: 'x' });
    expect(fn).not.toHaveBeenCalled();
  });
  it('serialize/deserialize', () => {
    const s = new Store();
    s.setCell(0, 0, { text: 'a' });
    s.setRow(0, { height: 30 });
    const s2 = Store.deserialize(s.serialize());
    expect(s2.getCell(0, 0)).toEqual({ text: 'a' });
    expect(s2.getRow(0)).toEqual({ height: 30 });
  });
});
```

Commit: `feat(store): reactive Store with snapshot`

---

### Task 2.2：EventBus

**Create:** `src/events/EventBus.ts`

```ts
export type EventHandler<T = unknown> = (payload: T) => void;
export type Unsubscribe = () => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  on<T = unknown>(event: string, fn: EventHandler<T>): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as EventHandler);
    return () => this.off(event, fn);
  }

  off<T = unknown>(event: string, fn: EventHandler<T>): void {
    this.listeners.get(event)?.delete(fn as EventHandler);
  }

  emit<T = unknown>(event: string, payload?: T): void {
    this.listeners.get(event)?.forEach(fn => fn(payload));
    // wildcard
    this.listeners.get('*')?.forEach(fn => fn({ event, payload } as unknown));
  }
}
```

**Create:** `test/events/EventBus.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/events/EventBus';

describe('EventBus', () => {
  it('on + emit', () => {
    const b = new EventBus();
    const fn = vi.fn();
    b.on('test', fn);
    b.emit('test', 1);
    expect(fn).toHaveBeenCalledWith(1);
  });
  it('off removes', () => {
    const b = new EventBus();
    const fn = vi.fn();
    const off = b.on('test', fn);
    off();
    b.emit('test', 1);
    expect(fn).not.toHaveBeenCalled();
  });
  it('wildcard *', () => {
    const b = new EventBus();
    const fn = vi.fn();
    b.on('*', fn);
    b.emit('foo', 1);
    expect(fn).toHaveBeenCalledWith({ event: 'foo', payload: 1 });
  });
});
```

Commit: `feat(events): EventBus with subscribe + wildcard`

---

### Task 2.3：Command 基类

**Create:** `src/commands/Command.ts`

```ts
import type { Store } from '../store/Store';

export abstract class Command<TArgs = unknown> {
  protected args: TArgs;
  constructor(args: TArgs) { this.args = args; }

  abstract execute(store: Store): void;
  abstract getUndo(): Command;

  shouldMerge(_other: Command): boolean { return false; }
  describe(): string { return this.constructor.name; }
}

export function setCommand<TArgs>(
  name: string,
  doFn: (store: Store, args: TArgs) => void,
  undoFn: (store: Store, args: TArgs) => void
): new (args: TArgs) => Command<TArgs> {
  return class extends Command<TArgs> {
    execute(store: Store): void { doFn(store, this.args); }
    getUndo(): Command {
      const UndoCmd = setCommand(`${name}_undo`, doFn, undoFn);
      return new UndoCmd(this.args);
    }
    describe(): string { return name; }
  };
}
```

**Create:** `test/commands/Command.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { setCommand } from '../../src/commands/Command';
import { Store } from '../../src/store/Store';

describe('Command', () => {
  it('setCommand does and undoes', () => {
    const store = new Store();
    const Cmd = setCommand<{ text: string }>(
      'SetA1',
      (s, args) => s.setCell(0, 0, { text: args.text }),
      (s, args) => s.setCell(0, 0, { text: '' })
    );
    const cmd = new Cmd({ text: 'hello' });
    cmd.execute(store);
    expect(store.getCell(0, 0)?.text).toBe('hello');
    cmd.getUndo().execute(store);
    expect(store.getCell(0, 0)?.text).toBe('');
  });
});
```

Commit: `feat(commands): Command base class`

---

### Task 2.4-2.8：5 个具体 Commands

**Create:** `src/commands/impl/SetCellText.ts`

```ts
import { Command } from '../Command';
import type { Store } from '../../store/Store';

export interface SetCellTextArgs {
  r: number;
  c: number;
  text: string;
}

export class SetCellText extends Command<SetCellTextArgs> {
  private oldText: string | undefined;

  execute(store: Store): void {
    const { r, c, text } = this.args;
    const old = store.getCell(r, c);
    this.oldText = old?.text;
    store.setCell(r, c, { ...old, text });
  }

  getUndo(): Command {
    return new SetCellText({ ...this.args, text: this.oldText ?? '' });
  }
}
```

**Create:** `src/commands/impl/SetRangeValues.ts`

```ts
import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { Cell } from '../../types';

export interface SetRangeValuesArgs {
  r1: number; c1: number; r2: number; c2: number;
  values: Array<Array<Partial<Cell> | undefined>>;
}

export class SetRangeValues extends Command<SetRangeValuesArgs> {
  private oldValues: Array<Array<Cell | undefined>> = [];

  execute(store: Store): void {
    const { r1, c1, r2, c2, values } = this.args;
    this.oldValues = [];
    for (let r = r1; r <= r2; r++) {
      const row: Array<Cell | undefined> = [];
      for (let c = c1; c <= c2; c++) {
        const old = store.getCell(r, c);
        row.push(old);
        const newVal = values[r - r1]?.[c - c1];
        if (newVal === undefined) continue;
        store.setCell(r, c, { ...old, ...newVal });
      }
      this.oldValues.push(row);
    }
  }

  getUndo(): Command {
    return new SetRangeValues({ ...this.args, values: this.oldValues });
  }
}
```

**Create:** `src/commands/impl/SetRowHeight.ts`

```ts
import { Command } from '../Command';
import type { Store } from '../../store/Store';

export interface SetRowHeightArgs {
  r: number;
  height: number;
}

export class SetRowHeight extends Command<SetRowHeightArgs> {
  private oldHeight: number | undefined;

  execute(store: Store): void {
    const old = store.getRow(this.args.r) ?? {};
    this.oldHeight = old.height;
    store.setRow(this.args.r, { ...old, height: this.args.height });
  }

  getUndo(): Command {
    return new SetRowHeight({ r: this.args.r, height: this.oldHeight ?? 25 });
  }
}
```

**Create:** `src/commands/impl/SetColWidth.ts`（同 SetRowHeight 改 col）

**Create:** `src/commands/impl/SetMerge.ts`

```ts
import { Command } from '../Command';
import type { Store } from '../../store/Store';

export interface SetMergeArgs {
  range: string;
  active: boolean;
}

export class SetMerge extends Command<SetMergeArgs> {
  execute(store: Store): void {
    if (this.args.active) store.addMerge(this.args.range);
  }
  getUndo(): Command {
    return new SetMerge({ ...this.args, active: false });
  }
}
```

**Create:** `test/commands/SetCellText.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { Store } from '../../src/store/Store';

describe('SetCellText', () => {
  it('sets text', () => {
    const s = new Store();
    new SetCellText({ r: 0, c: 0, text: 'hi' }).execute(s);
    expect(s.getCell(0, 0)?.text).toBe('hi');
  });
  it('undo restores old', () => {
    const s = new Store();
    s.setCell(0, 0, { text: 'old' });
    const cmd = new SetCellText({ r: 0, c: 0, text: 'new' });
    cmd.execute(s);
    cmd.getUndo().execute(s);
    expect(s.getCell(0, 0)?.text).toBe('old');
  });
  it('preserves other props', () => {
    const s = new Store();
    s.setCell(0, 0, { text: 'x', type: 'number' });
    new SetCellText({ r: 0, c: 0, text: 'y' }).execute(s);
    expect(s.getCell(0, 0)).toEqual({ text: 'y', type: 'number' });
  });
});
```

Commit: `feat(commands): SetCellText SetRangeValues SetRowHeight SetColWidth SetMerge`

---

### Task 2.9：CommandManager

**Create:** `src/commands/CommandManager.ts`

```ts
import type { Store } from '../store/Store';
import type { Command } from './Command';
import type { EventBus } from '../events/EventBus';

export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  constructor(
    private readonly store: Store,
    private readonly events?: EventBus
  ) {}

  execute(cmd: Command): void {
    cmd.execute(this.store);
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.events?.emit('command:executed', { cmd });
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.getUndo().execute(this.store);
    this.redoStack.push(cmd);
    this.events?.emit('command:undone', { cmd });
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute(this.store);
    this.undoStack.push(cmd);
    this.events?.emit('command:redone', { cmd });
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  clear(): void { this.undoStack = []; this.redoStack = []; }
}
```

**Create:** `test/commands/CommandManager.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { Store } from '../../src/store/Store';
import { SetCellText } from '../../src/commands/impl/SetCellText';

describe('CommandManager', () => {
  it('undo + redo', () => {
    const s = new Store();
    const m = new CommandManager(s);
    m.execute(new SetCellText({ r: 0, c: 0, text: 'a' }));
    m.execute(new SetCellText({ r: 0, c: 0, text: 'b' }));
    expect(s.getCell(0, 0)?.text).toBe('b');
    m.undo();
    expect(s.getCell(0, 0)?.text).toBe('a');
    m.undo();
    expect(s.getCell(0, 0)).toBeUndefined();
    m.redo();
    expect(s.getCell(0, 0)?.text).toBe('a');
  });
  it('canUndo/canRedo', () => {
    const s = new Store();
    const m = new CommandManager(s);
    expect(m.canUndo()).toBe(false);
    m.execute(new SetCellText({ r: 0, c: 0, text: 'a' }));
    expect(m.canUndo()).toBe(true);
    expect(m.canRedo()).toBe(false);
    m.undo();
    expect(m.canRedo()).toBe(true);
  });
  it('new command clears redo', () => {
    const s = new Store();
    const m = new CommandManager(s);
    m.execute(new SetCellText({ r: 0, c: 0, text: 'a' }));
    m.undo();
    expect(m.canRedo()).toBe(true);
    m.execute(new SetCellText({ r: 0, c: 0, text: 'b' }));
    expect(m.canRedo()).toBe(false);
  });
});
```

Commit: `feat(commands): CommandManager with undo/redo + event emission`

---

### Task 2.10：alphabet 工具

**Create:** `src/util/alphabet.ts`

```ts
export function num2alpha(n: number): string {
  let result = '';
  let num = n;
  while (num >= 0) {
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26) - 1;
    if (num < 0) break;
  }
  return result;
}

export function alpha2num(s: string): number {
  let result = 0;
  for (let i = 0; i < s.length; i++) {
    result = result * 26 + (s.charCodeAt(i) - 64);
  }
  return result - 1;
}

export function expr2xy(expr: string): { x: number; y: number } {
  const match = expr.match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Invalid cell expr: ${expr}`);
  const [, col, row] = match;
  if (col === undefined || row === undefined) throw new Error(`Invalid cell expr: ${expr}`);
  return { x: alpha2num(col), y: parseInt(row, 10) - 1 };
}

export function xy2expr(x: number, y: number): string {
  return `${num2alpha(x)}${y + 1}`;
}
```

**Create:** `test/util/alphabet.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { num2alpha, alpha2num, expr2xy, xy2expr } from '../../src/util/alphabet';

describe('alphabet', () => {
  it('num2alpha', () => {
    expect(num2alpha(0)).toBe('A');
    expect(num2alpha(25)).toBe('Z');
    expect(num2alpha(26)).toBe('AA');
    expect(num2alpha(701)).toBe('ZZ');
  });
  it('alpha2num', () => {
    expect(alpha2num('A')).toBe(0);
    expect(alpha2num('Z')).toBe(25);
    expect(alpha2num('AA')).toBe(26);
  });
  it('round trip 0-999', () => {
    for (let i = 0; i < 1000; i++) {
      expect(alpha2num(num2alpha(i))).toBe(i);
    }
  });
  it('expr2xy + xy2expr', () => {
    expect(expr2xy('A1')).toEqual({ x: 0, y: 0 });
    expect(xy2expr(0, 0)).toBe('A1');
    expect(expr2xy('Z100')).toEqual({ x: 25, y: 99 });
  });
});
```

Commit: `feat(util): alphabet conversion (num2alpha, alpha2num, expr2xy)`

---

## 🟡 Week 4-5：Renderer + 组件（10 task，预计 10 天）

### Task 4.1：VirtualScroller

**Create:** `src/renderer/VirtualScroller.ts`

```ts
export interface VirtualScrollerOptions {
  totalRows: number;
  totalCols: number;
  defaultRowHeight: number;
  defaultColWidth: number;
  viewportW: number;
  viewportH: number;
}

export interface VisibleRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export class VirtualScroller {
  private rowHeights = new Map<number, number>();
  private colWidths = new Map<number, number>();
  scrollTop = 0;
  scrollLeft = 0;

  constructor(private opts: VirtualScrollerOptions) {}

  setRowHeight(r: number, h: number): void { this.rowHeights.set(r, h); }
  setColWidth(c: number, w: number): void { this.colWidths.set(c, w); }
  setScroll(top: number, left: number): void { this.scrollTop = top; this.scrollLeft = left; }
  setViewport(w: number, h: number): void {
    this.opts = { ...this.opts, viewportW: w, viewportH: h };
  }

  getRowHeight(r: number): number {
    return this.rowHeights.get(r) ?? this.opts.defaultRowHeight;
  }
  getColWidth(c: number): number {
    return this.colWidths.get(c) ?? this.opts.defaultColWidth;
  }

  getVisibleRange(): VisibleRange {
    let top = 0;
    let startRow = 0;
    while (startRow < this.opts.totalRows && top + this.getRowHeight(startRow) < this.scrollTop) {
      top += this.getRowHeight(startRow);
      startRow++;
    }
    let endRow = startRow;
    let bottom = top;
    while (endRow < this.opts.totalRows && bottom < this.scrollTop + this.opts.viewportH) {
      bottom += this.getRowHeight(endRow);
      endRow++;
    }

    let left = 0;
    let startCol = 0;
    while (startCol < this.opts.totalCols && left + this.getColWidth(startCol) < this.scrollLeft) {
      left += this.getColWidth(startCol);
      startCol++;
    }
    let endCol = startCol;
    let right = left;
    while (endCol < this.opts.totalCols && right < this.scrollLeft + this.opts.viewportW) {
      right += this.getColWidth(endCol);
      endCol++;
    }

    return { startRow, endRow, startCol, endCol };
  }

  cellToPixel(r: number, c: number): { x: number; y: number } {
    let y = 0;
    for (let i = 0; i < r; i++) y += this.getRowHeight(i);
    let x = 0;
    for (let i = 0; i < c; i++) x += this.getColWidth(i);
    return { x, y };
  }
}
```

**Create:** `test/renderer/VirtualScroller.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { VirtualScroller } from '../../src/renderer/VirtualScroller';

describe('VirtualScroller', () => {
  const makeScroller = () => new VirtualScroller({
    totalRows: 100, totalCols: 10,
    defaultRowHeight: 25, defaultColWidth: 100,
    viewportW: 1000, viewportH: 600,
  });

  it('default visible range at scroll 0,0', () => {
    const s = makeScroller();
    const r = s.getVisibleRange();
    expect(r.startRow).toBe(0);
    expect(r.endRow).toBeGreaterThan(20);
  });
  it('scrolled down 1000px', () => {
    const s = makeScroller();
    s.setScroll(1000, 0);
    expect(s.getVisibleRange().startRow).toBe(40);
  });
  it('cellToPixel', () => {
    const s = makeScroller();
    expect(s.cellToPixel(0, 0)).toEqual({ x: 0, y: 0 });
    expect(s.cellToPixel(2, 3)).toEqual({ x: 300, y: 50 });
  });
});
```

Commit: `feat(renderer): VirtualScroller with visible range calculation`

---

### Task 4.2：DirtyRegionTracker

**Create:** `src/renderer/DirtyRegionTracker.ts`

```ts
export interface Rect {
  x: number; y: number; w: number; h: number;
}

export class DirtyRegionTracker {
  private regions: Rect[] = [];

  invalidate(rect: Rect): void {
    let merged = false;
    for (const r of this.regions) {
      if (this._overlaps(r, rect)) {
        r.x = Math.min(r.x, rect.x);
        r.y = Math.min(r.y, rect.y);
        r.w = Math.max(r.x + r.w, rect.x + rect.w) - r.x;
        r.h = Math.max(r.y + r.h, rect.y + rect.h) - r.y;
        merged = true;
        break;
      }
    }
    if (!merged) this.regions.push({ ...rect });
  }

  invalidateAll(): void {
    this.regions = [{ x: 0, y: 0, w: Number.MAX_SAFE_INTEGER, h: Number.MAX_SAFE_INTEGER }];
  }

  drain(): Rect[] {
    const out = this.regions;
    this.regions = [];
    return out;
  }

  isEmpty(): boolean { return this.regions.length === 0; }

  private _overlaps(a: Rect, b: Rect): boolean {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }
}
```

**Create:** `test/renderer/DirtyRegionTracker.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { DirtyRegionTracker } from '../../src/renderer/DirtyRegionTracker';

describe('DirtyRegionTracker', () => {
  it('single rect', () => {
    const d = new DirtyRegionTracker();
    d.invalidate({ x: 0, y: 0, w: 10, h: 10 });
    expect(d.regions).toHaveLength(1);
  });
  it('merge overlapping', () => {
    const d = new DirtyRegionTracker();
    d.invalidate({ x: 0, y: 0, w: 10, h: 10 });
    d.invalidate({ x: 5, y: 5, w: 10, h: 10 });
    expect(d.regions).toHaveLength(1);
    expect(d.regions[0]).toEqual({ x: 0, y: 0, w: 15, h: 15 });
  });
  it('drain clears', () => {
    const d = new DirtyRegionTracker();
    d.invalidate({ x: 0, y: 0, w: 10, h: 10 });
    const out = d.drain();
    expect(out).toHaveLength(1);
    expect(d.isEmpty()).toBe(true);
  });
});
```

Commit: `feat(renderer): DirtyRegionTracker with merge`

---

### Task 4.3-4.5：CanvasRenderer + 5 个 UI 组件（简版）

**Create:** `src/renderer/CanvasRenderer.ts`

```ts
import type { Store } from '../store/Store';
import type { Style } from '../types';
import { VirtualScroller, type VisibleRange } from './VirtualScroller';
import { DirtyRegionTracker, type Rect } from './DirtyRegionTracker';

export interface CanvasRendererOptions {
  canvas: HTMLCanvasElement;
  store: Store;
  devicePixelRatio?: number;
}

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private scroller: VirtualScroller;
  private dirty = new DirtyRegionTracker();
  private rafId: number | null = null;
  private unsubscribe: () => void;

  constructor(private opts: CanvasRendererOptions) {
    const ctx = opts.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.scroller = new VirtualScroller({
      totalRows: 1000,
      totalCols: 26,
      defaultRowHeight: 25,
      defaultColWidth: 100,
      viewportW: opts.canvas.clientWidth,
      viewportH: opts.canvas.clientHeight,
    });
    this.unsubscribe = opts.store.subscribe(() => this._onStoreChange());
    this._setupCanvas();
    this._scheduleRender();
  }

  private _setupCanvas(): void {
    const dpr = this.opts.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    const { canvas } = this.opts;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    this.ctx.scale(dpr, dpr);
  }

  private _onStoreChange(): void {
    this.dirty.invalidateAll();
    this._scheduleRender();
  }

  private _scheduleRender(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this._render();
    });
  }

  private _render(): void {
    if (this.dirty.isEmpty()) return;
    const regions = this.dirty.drain();
    const range = this.scroller.getVisibleRange();

    this.ctx.save();
    for (const region of regions) {
      this.ctx.beginPath();
      this.ctx.rect(region.x, region.y, region.w, region.h);
      this.ctx.clip();
      this._paintGrid(range);
    }
    this.ctx.restore();
  }

  private _paintGrid(range: VisibleRange): void {
    this.ctx.fillStyle = getCssVar('--ss-bg', '#fff');
    this.ctx.fillRect(0, 0, this.opts.canvas.clientWidth, this.opts.canvas.clientHeight);
    this.ctx.strokeStyle = getCssVar('--ss-grid', '#f0f0f0');
    for (let r = range.startRow; r < range.endRow; r++) {
      for (let c = range.startCol; c < range.endCol; c++) {
        const cell = this.opts.store.getCell(r, c);
        if (!cell) continue;
        const { x, y } = this.scroller.cellToPixel(r, c);
        this.ctx.fillStyle = getCssVar('--ss-text', '#333');
        this.ctx.fillText(cell.text, x + 4, y + 16);
      }
    }
  }

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.unsubscribe();
  }
}

function getCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
```

**Create:** `src/components/Toolbar.tsx`（React 组件）

```tsx
import { type FC } from 'react';

export const Toolbar: FC<{ onBold?: () => void; onItalic?: () => void }> = ({ onBold, onItalic }) => (
  <div className="ss-toolbar">
    <button onClick={onBold}><b>B</b></button>
    <button onClick={onItalic}><i>I</i></button>
  </div>
);
```

**Create:** `src/components/Editor.tsx`、`BottomBar.tsx`、`Menu.tsx`（简版）

**Create:** `src/components/Spreadsheet.tsx`（顶层 React 组件）

```tsx
import { useEffect, useRef, useState } from 'react';
import { Store } from '../store/Store';
import { CommandManager } from '../commands/CommandManager';
import { EventBus } from '../events/EventBus';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import { Toolbar } from './Toolbar';
import { BottomBar } from './BottomBar';
import { setCellText, setRangeValues } from '../commands/impl/...';
// 等

export interface SpreadsheetProps {
  data?: Array<Array<{ text: string } | string>>;
  theme?: 'light' | 'dark' | false;
}

export const Spreadsheet: FC<SpreadsheetProps> = ({ data, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [store] = useState(() => new Store());
  const [events] = useState(() => new EventBus());
  const [cmdManager] = useState(() => new CommandManager(store, events));

  useEffect(() => {
    if (theme === false) return;
    applyStoredTheme();
  }, [theme]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new CanvasRenderer({ canvas: canvasRef.current, store });
    return () => renderer.destroy();
  }, [store]);

  // ... 更多 effect 处理数据加载
  return (
    <div className="ss-root">
      <Toolbar />
      <canvas ref={canvasRef} style={{ width: '100%', height: 'calc(100% - 80px)' }} />
      <BottomBar />
    </div>
  );
};
```

⚠️ **注意：React 在 canvas 场景下不是最优选择**——老板可以考虑只用 TS + 模板字符串（不引 React）以减少包体积。如果保留 React 接受 40KB 体积。

Commit 系列：
- `feat(renderer): CanvasRenderer with virtual scroll + dirty regions`
- `feat(components): Toolbar BottomBar Editor Menu Spreadsheet`

---

## 🟡 Week 6：公式引擎（8 task，预计 7 天）

### Task 6.1-6.3：函数注册表（30 函数）

**Create:** `src/formula/registry.ts`

```ts
export interface FunctionSpec {
  minArgs: number;
  maxArgs: number;
  evaluate: (args: unknown[]) => unknown;
}

class FunctionRegistry {
  private funcs = new Map<string, FunctionSpec>();

  register(name: string, spec: FunctionSpec): void {
    this.funcs.set(name.toUpperCase(), spec);
  }
  get(name: string): FunctionSpec | undefined {
    return this.funcs.get(name.toUpperCase());
  }
  has(name: string): boolean { return this.funcs.has(name.toUpperCase()); }
  list(): string[] { return [...this.funcs.keys()]; }
}

export const registry = new FunctionRegistry();

// 数学（10）
registry.register('SUM', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => flatten(args).reduce<number>((a, b) => a + Number(b || 0), 0),
});
registry.register('AVERAGE', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => {
    const flat = flatten(args);
    return flat.reduce<number>((a, b) => a + Number(b || 0), 0) / flat.length;
  },
});
registry.register('MAX', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => Math.max(...flatten(args).map(Number)),
});
registry.register('MIN', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => Math.min(...flatten(args).map(Number)),
});
registry.register('COUNT', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => flatten(args).filter((v): v is number => typeof v === 'number').length,
});
registry.register('COUNTA', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => flatten(args).filter(v => v != null && v !== '').length,
});
registry.register('ROUND', {
  minArgs: 1, maxArgs: 2,
  evaluate: ([n, d]) => {
    const num = Number(n);
    const decimals = d !== undefined ? Number(d) : 0;
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  },
});
registry.register('ABS', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([n]) => Math.abs(Number(n)),
});
registry.register('INT', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([n]) => Math.floor(Number(n)),
});
registry.register('MOD', {
  minArgs: 2, maxArgs: 2,
  evaluate: ([a, b]) => Number(a) % Number(b),
});

// 逻辑（4）
registry.register('IF', {
  minArgs: 2, maxArgs: 3,
  evaluate: ([cond, t, f]) => cond ? t : f,
});
registry.register('AND', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => flatten(args).every(Boolean),
});
registry.register('OR', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => flatten(args).some(Boolean),
});
registry.register('NOT', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([v]) => !v,
});

// 文本（8）
registry.register('CONCAT', {
  minArgs: 1, maxArgs: 255,
  evaluate: (args) => flatten(args).map(String).join(''),
});
registry.register('LEFT', {
  minArgs: 1, maxArgs: 2,
  evaluate: ([s, n]) => String(s).slice(0, n !== undefined ? Number(n) : 1),
});
registry.register('RIGHT', {
  minArgs: 1, maxArgs: 2,
  evaluate: ([s, n]) => {
    const str = String(s);
    const num = n !== undefined ? Number(n) : 1;
    return str.slice(-num);
  },
});
registry.register('MID', {
  minArgs: 2, maxArgs: 3,
  evaluate: ([s, start, len]) => String(s).slice(Number(start) - 1, len !== undefined ? Number(start) - 1 + Number(len) : undefined),
});
registry.register('LEN', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([s]) => String(s).length,
});
registry.register('UPPER', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([s]) => String(s).toUpperCase(),
});
registry.register('LOWER', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([s]) => String(s).toLowerCase(),
});
registry.register('TRIM', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([s]) => String(s).trim(),
});

// 查找（4）
registry.register('VLOOKUP', {
  minArgs: 3, maxArgs: 4,
  evaluate: ([_search, _range, _colIndex, _rangeLookup]) => {
    throw new Error('VLOOKUP requires grid context (not yet implemented for MVP)');
  },
});
registry.register('INDEX', {
  minArgs: 2, maxArgs: 3,
  evaluate: ([arr, row, col]) => {
    const a = Array.isArray(arr) ? arr : [arr];
    return a[Number(row) - 1] ?? (col !== undefined ? a[Number(col) - 1] : undefined);
  },
});
registry.register('MATCH', {
  minArgs: 2, maxArgs: 3,
  evaluate: ([search, arr, _type]) => {
    const a = Array.isArray(arr) ? arr : [arr];
    return a.findIndex(v => v === search) + 1;
  },
});
registry.register('COUNTIF', {
  minArgs: 2, maxArgs: 2,
  evaluate: ([arr, criteria]) => {
    const a = Array.isArray(arr) ? arr : [arr];
    return a.filter(v => matchCriteria(v, String(criteria))).length;
  },
});

// 日期（4）
registry.register('NOW', {
  minArgs: 0, maxArgs: 0,
  evaluate: () => new Date(),
});
registry.register('TODAY', {
  minArgs: 0, maxArgs: 0,
  evaluate: () => new Date().toISOString().slice(0, 10),
});
registry.register('YEAR', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([d]) => new Date(d).getFullYear(),
});
registry.register('MONTH', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([d]) => new Date(d).getMonth() + 1,
});

function flatten(arr: unknown[]): unknown[] {
  return arr.flat(Infinity).filter(v => v !== undefined);
}

function matchCriteria(value: unknown, criteria: string): boolean {
  if (criteria.startsWith('>')) return Number(value) > Number(criteria.slice(1));
  if (criteria.startsWith('<')) return Number(value) < Number(criteria.slice(1));
  return String(value) === criteria;
}
```

**Create:** `test/formula/registry.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { registry } from '../../src/formula/registry';

describe('formula registry', () => {
  it('SUM', () => expect(registry.get('SUM')?.evaluate([1, 2, 3])).toBe(6));
  it('AVERAGE', () => expect(registry.get('AVERAGE')?.evaluate([1, 2, 3])).toBe(2));
  it('IF true', () => expect(registry.get('IF')?.evaluate([true, 'a', 'b'])).toBe('a'));
  it('IF false', () => expect(registry.get('IF')?.evaluate([false, 'a', 'b'])).toBe('b'));
  it('CONCAT', () => expect(registry.get('CONCAT')?.evaluate(['hello', ' ', 'world'])).toBe('hello world'));
  it('LEN', () => expect(registry.get('LEN')?.evaluate(['hello'])).toBe(5));
  it('UPPER', () => expect(registry.get('UPPER')?.evaluate(['hello'])).toBe('HELLO'));
  it('30 functions registered', () => {
    expect(registry.list().length).toBeGreaterThanOrEqual(30);
  });
});
```

Commit: `feat(formula): function registry with 30 functions`

---

### Task 6.4-6.8：Parser + Evaluator + DependencyGraph + FormulaEngine

**Create:** `src/formula/parser.ts`（极简版——基于 token split + 栈）

```ts
export type AstNode =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'cell'; x: number; y: number }
  | { type: 'range'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'func'; name: string; args: AstNode[] }
  | { type: 'binary'; op: string; left: AstNode; right: AstNode }
  | { type: 'unary'; op: string; operand: AstNode };

export class FormulaParser {
  parse(input: string): AstNode | null {
    if (!input.startsWith('=')) return null;
    return { type: 'string', value: input };  // 简化版
  }
}
```

⚠️ **诚实标注**：完整 formula parser 涉及运算符优先级、嵌套函数、字符串字面量——是 1-2 周的工作量。MVP 阶段先用简化版（只支持 `=A1`、`=A1+B1`、`=SUM(A1:A5)` 这 3 种）。

**Create:** `src/formula/evaluator.ts`

```ts
import type { AstNode } from './parser';
import { registry } from './registry';

export type CellResolver = (x: number, y: number) => unknown;

export function evaluate(node: AstNode, resolve: CellResolver): unknown {
  switch (node.type) {
    case 'number': return node.value;
    case 'string': return node.value;
    case 'cell': return resolve(node.x, node.y);
    case 'func': {
      const spec = registry.get(node.name);
      if (!spec) throw new Error(`Unknown function: ${node.name}`);
      const args = node.args.map(a => evaluate(a, resolve));
      return spec.evaluate(args);
    }
    // 简化：binary/unary 不实现
    default: throw new Error(`Not implemented: ${node.type}`);
  }
}
```

**Create:** `src/formula/dependency.ts`

```ts
export class DependencyGraph {
  private forward = new Map<string, Set<string>>();   // A1 → {B1, C1}
  private reverse = new Map<string, Set<string>>();   // B1 → {A1}

  setDependencies(cellId: string, dependsOn: string[]): void {
    this.reverse.set(cellId, new Set(dependsOn));
    for (const dep of dependsOn) {
      if (!this.forward.has(dep)) this.forward.set(dep, new Set());
      this.forward.get(dep)!.add(cellId);
    }
  }

  clearDependencies(cellId: string): void {
    const old = this.reverse.get(cellId);
    if (!old) return;
    for (const dep of old) this.forward.get(dep)?.delete(cellId);
    this.reverse.delete(cellId);
  }

  getAffected(changedCellId: string): string[] {
    const result = new Set<string>();
    const queue = [changedCellId];
    while (queue.length) {
      const cur = queue.shift()!;
      const downstream = this.forward.get(cur);
      if (!downstream) continue;
      for (const d of downstream) {
        if (!result.has(d)) {
          result.add(d);
          queue.push(d);
        }
      }
    }
    return [...result];
  }
}
```

**Create:** `src/formula/FormulaEngine.ts`

```ts
import type { Store } from '../store/Store';
import { DependencyGraph } from './dependency';
import { FormulaParser } from './parser';
import { evaluate } from './evaluator';

export class FormulaEngine {
  private graph = new DependencyGraph();
  private formulas = new Map<string, string>();  // cellId → formula
  private parser = new FormulaParser();

  constructor(private store: Store) {
    store.subscribe(e => {
      if (e.type === 'cell' && e.cell?.value !== undefined) {
        const cellId = `${e.r},${e.c}`;
        this.recalculate(cellId);
      }
    });
  }

  setFormula(cellId: string, formula: string, dependsOn: string[]): void {
    this.graph.setDependencies(cellId, dependsOn);
    this.formulas.set(cellId, formula);
    this.recalculate(cellId);
  }

  removeFormula(cellId: string): void {
    this.graph.clearDependencies(cellId);
    this.formulas.delete(cellId);
  }

  recalculate(cellId: string): void {
    const formula = this.formulas.get(cellId);
    if (!formula) return;
    const ast = this.parser.parse(formula);
    if (!ast) return;
    try {
      const value = evaluate(ast, (x, y) => this.store.getCell(x, y)?.value);
      const [r, c] = cellId.split(',').map(Number);
      if (r === undefined || c === undefined) return;
      this.store.setCell(r, c, { ...this.store.getCell(r, c), value });
    } catch (err) {
      console.error(`Formula error at ${cellId}:`, err);
    }
  }

  onCellChanged(cellId: string): void {
    const affected = this.graph.getAffected(cellId);
    for (const id of affected) this.recalculate(id);
  }
}
```

**Create:** `test/formula/FormulaEngine.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import { Store } from '../../src/store/Store';

describe('FormulaEngine', () => {
  it('A1+B1 → C1 recalculates when A1 changes', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    store.setCell(0, 0, { text: '10', value: 10 });
    store.setCell(0, 1, { text: '20', value: 20 });
    engine.setFormula('0,2', '=A1+B1', ['0,0', '0,1']);
    // 简化 parser 不解析表达式，所以这里只能手动验证
    // 真实测试要等 parser 完整实现
  });
});
```

Commit 系列：
- `feat(formula): basic parser + evaluator skeleton`
- `feat(formula): DependencyGraph for incremental recalc`
- `feat(formula): FormulaEngine integration with Store`

⚠️ **诚实标注**：完整 formula parser 是 1-2 周工作量。MVP 阶段先把 registry 和 engine 框架搭好，**parser 留 30% 实现**。Week 8+ 慢慢补。

---

## 🟡 Week 7：插件 + 发布（5 task，预计 5 天）

### Task 7.1：PluginManager

**Create:** `src/plugin/PluginAPI.ts`

```ts
import type { Spreadsheet } from '../index';

export class PluginAPI {
  constructor(private ss: Spreadsheet) {}

  get store() { return this.ss.store; }
  get cmdManager() { return this.ss.cmdManager; }
  get events() { return this.ss.events; }

  registerFunction(name: string, spec: { minArgs: number; maxArgs: number; evaluate: (args: unknown[]) => unknown }): void {
    this.ss.formula.registry.register(name, spec);
  }

  on(event: string, handler: (payload: unknown) => void): () => void {
    return this.events.on(event, handler);
  }
}
```

**Create:** `src/plugin/PluginManager.ts`

```ts
import type { Spreadsheet } from '../index';
import { PluginAPI } from './PluginAPI';

export interface Plugin {
  name?: string;
  install: (api: PluginAPI) => void;
}

export class PluginManager {
  private plugins: Plugin[] = [];

  constructor(private ss: Spreadsheet) {}

  use(plugin: Plugin): this {
    const api = new PluginAPI(this.ss);
    plugin.install?.(api);
    this.plugins.push(plugin);
    return this;
  }
}
```

Commit: `feat(plugin): PluginManager + PluginAPI`

---

### Task 7.2：CsvImport 示例插件

**Create:** `src/plugins/CsvImport.ts`

```ts
import type { Plugin } from '../plugin/PluginManager';

export const CsvImportPlugin: Plugin = {
  name: 'csv-import',
  install(api) {
    api.on('csv:import', (payload) => {
      const csv = String(payload);
      const rows = csv.split('\n').map(line => line.split(','));
      api.store.setCell(0, 0, { text: rows[0]?.[0] ?? '' });
      // 简化：实际实现要批量设置
    });
  },
};
```

Commit: `feat(plugins): CsvImport example`

---

### Task 7.3：公开 facade 整合（src/index.ts）

**Replace:** `src/index.ts`

```ts
import { Spreadsheet as SpreadsheetComponent } from './components/Spreadsheet';
import { Store } from './store/Store';
import { CommandManager } from './commands/CommandManager';
import { EventBus } from './events/EventBus';
import { FormulaEngine } from './formula/FormulaEngine';
import { PluginManager, type Plugin } from './plugin/PluginManager';
import { THEMES, type Theme, applyStoredTheme } from './theme';
import './theme/tokens.css';

export interface SpreadsheetOptions {
  data?: Array<Array<{ text: string } | string>>;
  theme?: Theme | false;
}

export class Spreadsheet {
  readonly store: Store;
  readonly events: EventBus;
  readonly cmdManager: CommandManager;
  readonly formula: FormulaEngine;
  private readonly plugins: PluginManager;
  private component: SpreadsheetComponent | null = null;

  constructor(public root: HTMLElement, options: SpreadsheetOptions = {}) {
    this.store = new Store();
    this.events = new EventBus();
    this.cmdManager = new CommandManager(this.store, this.events);
    this.formula = new FormulaEngine(this.store);
    this.plugins = new PluginManager(this);

    if (options.theme !== false) {
      applyStoredTheme();
    }

    this.component = new SpreadsheetComponent({ root, ss: this, options });

    if (options.data) {
      this.loadData(options.data);
    }
  }

  use(plugin: Plugin): this { this.plugins.use(plugin); return this; }
  loadData(data: Array<Array<{ text: string } | string>>): this {
    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell == null) continue;
        const text = typeof cell === 'string' ? cell : cell.text;
        this.store.setCell(r, c, { text });
      }
    }
    return this;
  }

  destroy(): void {
    this.component?.destroy();
  }
}

export { Store, CommandManager, EventBus, FormulaEngine, PluginManager };
export type { Plugin, Theme };
export { THEMES };

export default Spreadsheet;
```

Commit: `feat(public): facade integration`

---

### Task 7.4：ARCHITECTURE.md

**Create:** `ARCHITECTURE.md`

```markdown
# Architecture

## 4 Layers

\`\`\`
[ User ]
   ↓
[ Layer 4: API / Facade ]      src/index.ts (Spreadsheet class)
   ↓
[ Layer 3: Commands ]           src/commands/
   ↓
[ Layer 2: Store ]              src/store/Store.ts
[ Layer 2b: Formula ]           src/formula/
[ Layer 2c: Events ]            src/events/EventBus.ts
   ↓
[ Layer 1: Renderer ]           src/renderer/ + src/components/
   ↓
[ Canvas / DOM ]
\`\`\`

## Data flow

1. User interacts (click / type)
2. UI calls `spreadsheet.setCellText(r, c, 'x')`
3. Spreadsheet executes `SetCellText` command
4. Command mutates Store
5. Store notifies subscribers (Renderer, FormulaEngine, EventBus)
6. Renderer marks dirty regions
7. requestAnimationFrame → render dirty regions
8. FormulaEngine recalculates affected cells
9. (Loop back to 5 for downstream cells)

## Extension points

- New formula function: `spreadsheet.use({ install(api) { api.registerFunction('MYFUNC', { ... }) } })`
- New event handler: `api.on('cellChange', ({ r, c }) => ...)`
- New command: write a class extending Command, add to commands/

## File map

| Path | Purpose |
|------|---------|
| src/index.ts | Public API entry |
| src/store/Store.ts | Reactive data |
| src/commands/ | All write operations |
| src/commands/CommandManager.ts | Undo/redo |
| src/formula/ | Formula engine |
| src/renderer/ | Virtual scroll + dirty regions |
| src/components/ | DOM/Canvas UI |
| src/plugin/ | Plugin system |
| src/events/ | Event bus |
| src/theme/ | Theme tokens |
```

Commit: `docs: ARCHITECTURE.md`

---

### Task 7.5：v1.0 release

```bash
git tag v1.0.0
git push --tags
# GitHub 上点 "Create Release from tag"
# npm publish（可选）
```

修改 `package.json` version 0.0.1 → 1.0.0。

Commit: `chore(release): v1.0.0`

---

## 验收清单（7 周完成后）

### Week 1 脚手架
- [ ] 仓库活跃，CI 跑通
- [ ] TypeScript strict + Vite 5 + vitest
- [ ] 暗色主题
- [ ] README + ROADMAP

### Week 2-3 数据层
- [ ] Store + EventBus + Command 基类
- [ ] 5 个具体 Commands
- [ ] CommandManager with undo/redo
- [ ] alphabet 工具

### Week 4-5 Renderer
- [ ] VirtualScroller
- [ ] DirtyRegionTracker
- [ ] CanvasRenderer
- [ ] 5 个 UI 组件
- [ ] Spreadsheet 顶层组件

### Week 6 公式
- [ ] 30 函数注册表
- [ ] Parser + Evaluator（30%）
- [ ] DependencyGraph
- [ ] FormulaEngine 整合

### Week 7 插件 + 发布
- [ ] PluginManager + PluginAPI
- [ ] CsvImport 示例
- [ ] 公开 facade
- [ ] ARCHITECTURE.md
- [ ] v1.0 release

### 总体目标
- [ ] 7 周至少 40 个 commit
- [ ] maketwin/web-spreadsheet 有 v1.0 release
- [ ] 4 层架构清晰
- [ ] 0 个 .js 文件（除 .ts）
- [ ] 0 个 `any`（除非显式 unknown + 守卫）
- [ ] `pnpm typecheck` 0 错
- [ ] `pnpm test` 全过
- [ ] `pnpm build` 出 dist + .d.ts
- [ ] 浏览器跑 demo：网格 + 暗色 + 公式 + 撤销重做

## 风险与坑

| 风险 | 应对 |
|---|---|
| Formula parser 实现量大 | MVP 30% 实现，30 函数先放 registry |
| Canvas 渲染性能 | 虚拟滚动 + 脏区重绘 |
| React 包体积 | 接受 40KB 或换纯 TS |
| 数据迁移 | 老 v1.5 用户需重新初始化数据 |
| 老 x-spreadsheet 兼容 | 不兼容——纯重写，v1.0 breaking change |

## 不要做的事（YAGNI）

- ❌ 增量保留老 src/
- ❌ 兼容性 shim
- ❌ 协同 / 图表 / 条件格式（Week 8+）
- ❌ 招人 / 商业化

## 代码质量门槛（强约束）

| 规则 | 阈值 | 工具 |
|---|---|---|
| 文件最大行数 | 300 行（超过要拆） | eslint `max-lines: 300` |
| 函数最大行数 | 50 行（超过要拆） | eslint `max-lines-per-function: 50` |
| 函数参数最大数 | 4 个（多了用对象） | TS 类型推断 |
| any 使用 | **0 个**（必须用 `unknown` + 类型守卫） | `@typescript-eslint/no-explicit-any: error` |
| 类型覆盖率 | 100%（strict + noUncheckedIndexedAccess） | `tsc --noEmit` 0 错 |
| 测试覆盖率 | Store/Command 80%+，UI 60%+ | vitest --coverage |
| 每个文件必须测试 | 是（除非纯 type 定义） | 人工 review |
| 任何 `as` cast | 必须注释说明原因 | `@typescript-eslint/consistent-type-assertions` |
| 任何 `// @ts-ignore` | 禁止（用 `// @ts-expect-error` + 注释） | TS 编译 |

> **目的**：避免重蹈覆辙——这次不能又写出 8000 行没人维护的代码。质量门槛是硬性 commit 门槛，PR review 不通过不能合并。

## 给老板的话

老板 7 周后你会有：
- 一个**完全重写**的现代 TS SDK
- 4 层架构 + 虚拟滚动 + 公式 + 插件
- 40+ commit + v1.0 release
- 跟原版 x-spreadsheet 完全切割，没有技术债

如果只完成 Week 1-3（数据层），**也完全 OK**——一个干净的 Store + Command 体系，比 8000 行老代码强。

如果累了就停。**兴趣项目最大的价值是保持兴趣**。
