# web-spreadsheet 改造计划（方案 4：10 周路径）

> **For 老板**：基于 GitHub 调研 + 重构/重写讨论后选定的"折中方案 4"——数据层用 TS strict 重写，UI 层加 .d.ts 声明保兼容。每个 task 完成后 commit。
>
> **基于调研结论**：走"模式 1 简化版"——保留 x-spreadsheet 的轻量定位，借鉴 Univer 的 4 层架构 + AG Grid 的性能优化 + HyperFormula 的公式工程化。
>
> **核心改造策略**：
> - src/core/ → 全部重写为 .ts（store/commands/formula）
> - src/component/ → 保持 .js + 加 .d.ts
> - src/index.ts → 公开 API 入口
> - 4 层架构、TS strict + noImplicitAny + strictNullChecks + noUncheckedIndexedAccess
> - Vite + ESM 全栈

**Goal:** 10 周后 maketwin/web-spreadsheet 是**有架构、有性能、有公式、能扩展、健康 TS**的开源项目。

**Architecture（4 层）:**
```
Layer 4: API/Facade       src/index.ts
Layer 3: Commands         src/commands/*.ts
Layer 2: Store            src/store/Store.ts
Layer 1: Renderer         src/renderer/*.ts + src/component/*.js
```

**Tech Stack:**
- TypeScript 5.x（strict 全开）
- Vite 5（取代 webpack 4）
- vitest + jsdom（取代 mocha）
- ESM 全栈（import/export + "type": "module"）
- 仍然 Canvas 渲染

**调研参考：**
- Univer 0.25：4 层架构、Facade API、命令模式
- HyperFormula：公式注册表、依赖图、按需重算
- AG Grid：虚拟滚动、脏区重绘、性能优化
- Formula.js：函数实现参考

---

## 仓库信息

- GitHub: https://github.com/maketwin/web-spreadsheet
- 本地: /Users/sunxin/web-spreadsheet
- 默认分支: master
- origin: maketwin/web-spreadsheet（自己的 fork）
- upstream: myliang/x-spreadsheet（远端留着不删）
- npm 包名（暂不改）: x-data-spreadsheet 1.1.8

---

## 🟢 Week 1：基础稳基（5 task，预计 5 天）

### Task 1.1：本地能跑（删除 opencollective 横幅）

修改 `package.json`，删 `postinstall`（opencollective 横幅烦人）：

```diff
-    "postinstall": "opencollective-postinstall"
```

加项目级 `.npmrc` 隔离 pnpm store（绕开 sunxin 用户的 store 权限问题）：

```bash
cat > /Users/sunxin/web-spreadsheet/.npmrc <<EOF
store-dir=./.pnpm-store
EOF
```

装依赖：

```bash
cd /Users/sunxin/web-spreadsheet
HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 pnpm install --ignore-scripts 2>&1 | tail -20
```

验证：
```bash
pnpm dev    # 浏览器 http://localhost:3000
pnpm build  # dist/x-data-spreadsheet.js
pnpm lint   # 无 error
```

Commit: `chore: drop opencollective postinstall + isolate pnpm store`

---

### Task 1.2：加 CI（GitHub Actions）

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
      - run: pnpm run lint
      - run: pnpm run build
```

删除 `.travis.yml`（用 GitHub Actions 替代）。

Commit: `ci: switch from travis to github actions`

---

### Task 1.3：JSDoc + TypeScript checkJS（不动文件后缀）

**思路**：不改 .js 后缀，只加 JSDoc 注释 + tsconfig，tsc 自动推断类型。这是 TS 迁移最轻的第一步。

```bash
pnpm add -D typescript @types/node
```

**Create:** `tsconfig.json`（**纯 check 模式，不编译**）
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "include": ["src/**/*.js"]
  }
}
```

跑 `pnpm tsc --noEmit` 看哪些地方爆错。**预期很多报错**——这才是发现所有隐式 any 的价值。

为一些关键函数加 JSDoc 注释修类型：
```js
// src/core/cell.js
/**
 * @typedef {Object} Cell
 * @property {string} text
 * @property {string} [formula]
 * @property {string} [style]
 */

/**
 * @param {number} r
 * @param {number} c
 * @returns {Cell | undefined}
 */
export function getCell(r, c) { ... }
```

验证：`pnpm tsc --noEmit` 报错数 < 50（剩下用 `// @ts-expect-error` 兜底）。

**这是给老代码"虚拟类型"**——不重写，先把"哪里有雷"摸清。

Commit: `chore(ts): add TypeScript checkJS for legacy src/*.js`

---

### Task 1.4：加 vitest（替代 mocha）

```bash
pnpm add -D vitest jsdom @vitest/coverage-v8
```

修改 `package.json` scripts：
```diff
-    "test": "mocha --require @babel/register --recursive test",
-    "coverage": "nyc --reporter=lcov --reporter=text-summary mocha --require @babel/register --recursive test"
+    "test": "vitest run",
+    "test:watch": "vitest",
+    "coverage": "vitest run --coverage",
```

**Create:** `vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.js'],
  },
});
```

**Create:** `test/sanity.test.js`
```js
import { describe, it, expect } from 'vitest';
describe('sanity', () => { it('runs', () => expect(1+1).toBe(2)); });
```

验证：`pnpm test` 通过。

Commit: `test: migrate from mocha to vitest`

---

### Task 1.5：升级 Vite（取代 webpack）

```bash
pnpm add -D vite vite-plugin-dts
pnpm remove webpack webpack-cli webpack-dev-server webpack-merge \
  html-webpack-plugin mini-css-extract-plugin css-loader style-loader \
  file-loader less-loader babel-loader @babel/core @babel/preset-env \
  @babel/plugin-proposal-class-properties @babel/register clean-webpack-plugin
```

修改 `package.json`：
```diff
+  "type": "module",
   "main": "dist/web-spreadsheet.es.js",
+  "types": "dist/index.d.ts",
-  "dev": "webpack-dev-server --open --config build/webpack.dev.js",
-  "build": "webpack --config build/webpack.prod.js",
+  "dev": "vite",
+  "build": "vite build",
```

**Create:** `vite.config.ts`
```ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),  // 暂时还是 index.js
      name: 'web-spreadsheet',
      fileName: (f) => `web-spreadsheet.${f}.js`,
      formats: ['es', 'umd'],
    },
    rollupOptions: { output: { assetFileNames: 'web-spreadsheet.[ext]' } },
  },
  server: { port: 3000, open: true },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
});
```

⚠️ **关键问题**：build/webpack.*.js 还在用 `require()`——加 `"type": "module"` 后 Node 会爆。需要：
- 把 `build/webpack.*.js` 全部删（已经不再用）
- 或者重命名成 `.cjs`（保留历史）

**我们直接删**（反正都换 Vite 了）。

**Create:** `index.html`
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>web-spreadsheet demo</title>
  <link rel="stylesheet" href="/src/index.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/demo/main.js"></script>
</body>
</html>
```

**Create:** `demo/main.ts`
```ts
import Spreadsheet from '../src/index.js';
import '../src/index.css';
new Spreadsheet('#root').loadData([
  { cells: { 0: { text: 'A1' }, 1: { text: 'B1' } } },
  { cells: { 0: { text: 'A2' }, 1: { text: 'B2' } } },
]);
```

⚠️ demo/main.ts 引用 `src/index.js`——后面 Week 2-3 改成 `src/index.ts` 后再改这里。

删除 `build/` 目录（webpack 配置）。

验证：`pnpm dev` 浏览器看到 demo + `pnpm build` 出 dist。

Commit: `build: migrate from webpack 4 to vite 5`

---

## 🟢 Week 2：基础收尾（4 task，预计 5 天）

### Task 2.1：暗色主题

读 `src/index.css` 找硬编码颜色，全部替换为 CSS 变量：

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
}
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

Commit: `refactor(css): extract design tokens to CSS variables`

---

### Task 2.2：主题切换 API

**Create:** `src/theme/index.ts`
```ts
export const THEMES = { light: 'light', dark: 'dark' } as const;
export type Theme = typeof THEMES[keyof typeof THEMES];

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-spreadsheet-theme', theme);
  localStorage.setItem('web-spreadsheet-theme', theme);
}

export function getTheme(): Theme {
  const stored = localStorage.getItem('web-spreadsheet-theme');
  if (stored === THEMES.light || stored === THEMES.dark) return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? THEMES.dark : THEMES.light;
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
  it('setTheme writes to localStorage', () => {
    setTheme(THEMES.dark);
    expect(localStorage.getItem('web-spreadsheet-theme')).toBe('dark');
  });
  it('setTheme updates DOM attribute', () => {
    setTheme(THEMES.dark);
    expect(document.documentElement.getAttribute('data-spreadsheet-theme')).toBe('dark');
  });
  it('getTheme respects stored value', () => {
    setTheme(THEMES.dark);
    expect(getTheme()).toBe(THEMES.dark);
  });
});
```

Commit: `feat(theme): add dark mode + persistence`

---

### Task 2.3：重写 README

**Modify:** `README.md`

```markdown
# web-spreadsheet

A community-maintained fork of [x-spreadsheet](https://github.com/myliang/x-spreadsheet).
Modernized with TypeScript, Vite 5, and a clean 4-layer architecture.

## Why this fork exists
The original maintainer migrated to @wolf-table/table and is no longer
maintaining x-spreadsheet. This fork aims to:
- Migrate data layer to TypeScript (strict mode)
- Adopt a 4-layer architecture (facade/commands/store/renderer)
- Add a formula engine with 30+ functions
- Add virtual scrolling for 10,000+ rows
- Add a plugin system for extensibility
- Stay MIT licensed, open for contributions

## Status
- [x] Vite 5 + vitest
- [x] GitHub Actions CI
- [x] Dark mode
- [x] TypeScript strict for data layer
- [ ] 4-layer architecture
- [ ] Command pattern + undo/redo
- [ ] Virtual scrolling
- [ ] Formula engine v1
- [ ] Plugin system

## Install
\`\`\`bash
pnpm add web-spreadsheet
\`\`\`

## License
MIT (inherited from x-spreadsheet)
```

Commit: `docs: rewrite README with fork context`

---

### Task 2.4：写 ROADMAP + 第一个 GitHub release

**Create:** `ROADMAP.md`

```markdown
# Roadmap

## v1.5 — Foundation (Week 1-2, current)
- [x] Vite 5 + vitest
- [x] GitHub Actions CI
- [x] TypeScript checkJS for legacy
- [x] Dark mode

## v2.0 — TS Data Layer (Week 3-4)
- [ ] src/core/ → TypeScript
- [ ] Store / CommandManager
- [ ] Command pattern + undo/redo
- [ ] tsconfig strict

## v2.1 — Renderer (Week 5-6)
- [ ] 4-layer architecture
- [ ] Virtual scrolling
- [ ] Dirty region rendering

## v2.2 — Formula (Week 7-8)
- [ ] Formula engine v1 (30 functions)
- [ ] Dependency graph
- [ ] On-demand recalculation

## v2.3 — Extensibility (Week 9-10)
- [ ] Plugin system
- [ ] Custom cell types
- [ ] Custom formula functions
- [ ] Component .d.ts declarations

## v3.0+ — Future
- [ ] Yjs collaboration
- [ ] Chart integration
- [ ] Conditional formatting
- [ ] Data validation
- [ ] Mobile touch
```

```bash
git tag v1.5.0
git push --tags
# GitHub 上点 "Create Release from tag"
```

Commit: `docs: add ROADMAP + tag v1.5.0`

---

## 🟡 Week 3-4：src/core/ 全部转 TS（12 task，预计 10 天）

> ⛔️ **核心改造期**：从这一周开始，src/core/ 内的 .js 文件逐个变成 .ts，老代码移到 src/core-legacy/。

### Task 3.1：tsconfig 加 dual mode

**Modify:** `tsconfig.json`

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
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    
    "jsx": "preserve",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js"],
  "exclude": ["node_modules", "dist"]
}
```

关键变化：
- `allowJs: true` + `checkJs: true`——老 .js 仍被检查
- `noUncheckedIndexedAccess: true`——arr[i] 是 T | undefined（严）
- `exactOptionalPropertyTypes: true`——可选属性不能赋 undefined（很严）

跑 `pnpm tsc --noEmit` 看大量报错——下面 4 周任务就是逐个消。

Commit: `chore(ts): strict tsconfig with noUncheckedIndexedAccess`

---

### Task 3.2：设计 Store 类型

**Create:** `src/store/types.ts`

```ts
export interface Cell {
  text: string;
  formula?: string;
  style?: string;
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
}

export type StoreEvent =
  | { type: 'cell'; r: number; c: number; cell: Cell | undefined }
  | { type: 'row'; r: number; meta: RowMeta | undefined }
  | { type: 'col'; c: number; meta: ColMeta | undefined }
  | { type: 'style'; id: string; style: Style | undefined }
  | { type: 'merge'; range: string };

export type Unsubscribe = () => void;
```

Commit: `feat(store): add type definitions`

---

### Task 3.3：实现 Store

**Create:** `src/store/Store.ts`

```ts
import type { Cell, ColMeta, RowMeta, StoreEvent, Style, Unsubscribe } from './types';

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

  // Write (called by Commands)
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
    expect((events[0] as { type: string }).type).toBe('cell');
  });
  it('unsubscribe', () => {
    const s = new Store();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    off();
    s.setCell(0, 0, { text: 'x' });
    expect(fn).not.toHaveBeenCalled();
  });
  it('serialize/deserialize round trip', () => {
    const s = new Store();
    s.setCell(0, 0, { text: 'a' });
    s.setRow(0, { height: 30 });
    const data = s.serialize();
    const s2 = Store.deserialize(data);
    expect(s2.getCell(0, 0)).toEqual({ text: 'a' });
    expect(s2.getRow(0)).toEqual({ height: 30 });
  });
});
```

验证：`pnpm tsc --noEmit` 不报错 + `pnpm test` 5 个 passed。

Commit: `feat(store): implement reactive Store with snapshot + types`

---

### Task 3.4：实现 Command 基类

**Create:** `src/commands/Command.ts`

```ts
import type { Store } from '../store/Store';

export abstract class Command<TArgs = unknown> {
  protected args: TArgs;
  protected store: Store | null = null;

  constructor(args: TArgs) {
    this.args = args;
  }

  abstract execute(store: Store): void;

  /** Return a Command that undoes this one. */
  abstract getUndo(): Command;

  /** Default: never merge. Subclasses can override. */
  shouldMerge(_other: Command): boolean {
    return false;
  }

  describe(): string {
    return this.constructor.name;
  }
}

export function setCommand<TArgs>(
  name: string,
  doFn: (store: Store, args: TArgs) => void,
  undoFn: (store: Store, args: TArgs) => void
): new (args: TArgs) => Command<TArgs> {
  return class extends Command<TArgs> {
    execute(store: Store): void {
      doFn(store, this.args);
    }
    getUndo(): Command {
      const undoCmd = setCommand(`${name}_undo`, doFn, undoFn);
      return new undoCmd(this.args);
    }
    describe(): string {
      return name;
    }
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
    const Cmd = setCommand('SetA1',
      (s, args: { text: string }) => s.setCell(0, 0, { text: args.text }),
      (s, args: { text: string }) => s.setCell(0, 0, { text: '' })
    );
    const cmd = new Cmd({ text: 'hello' });
    cmd.execute(store);
    expect(store.getCell(0, 0)?.text).toBe('hello');
    const undo = cmd.getUndo();
    undo.execute(store);
    expect(store.getCell(0, 0)?.text).toBe('');
  });
});
```

Commit: `feat(commands): add Command base class with type-safe args`

---

### Task 3.5：写 5 个核心 Commands

**Create:** `src/commands/SetCellText.ts`

```ts
import { Command } from './Command';

export interface SetCellTextArgs {
  r: number;
  c: number;
  text: string;
}

export class SetCellText extends Command<SetCellTextArgs> {
  private oldText: string | undefined;

  execute(store: import('../store/Store').Store): void {
    const { r, c, text } = this.args;
    const old = store.getCell(r, c);
    this.oldText = old?.text;
    store.setCell(r, c, { ...old, text });
  }

  getUndo(): Command {
    return new SetCellText({ ...this.args, text: this.oldText ?? '' });
  }

  describe(): string {
    return `Set ${String.fromCharCode(65 + this.args.c)}${this.args.r + 1} = "${this.args.text}"`;
  }
}
```

**Create:** `src/commands/SetRangeValues.ts`

```ts
import { Command } from './Command';
import type { Store } from '../store/Store';
import type { Cell } from '../store/types';

export interface SetRangeValuesArgs {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
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

**Create:** `src/commands/SetRowHeight.ts**

```ts
import { Command } from './Command';
import type { Store } from '../store/Store';

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

**Create:** `src/commands/SetColWidth.ts`（同 SetRowHeight 但 col）

**Create:** `src/commands/SetMerge.ts`

```ts
import { Command } from './Command';
import type { Store } from '../store/Store';

export interface SetMergeArgs {
  range: string;
  active: boolean;
}

export class SetMerge extends Command<SetMergeArgs> {
  execute(store: Store): void {
    if (this.args.active) {
      store.addMerge(this.args.range);
    }
    // 不支持取消合并
  }
  getUndo(): Command {
    // 简单实现：返回自身（不能完全撤销）
    return new SetMerge({ ...this.args, active: false });
  }
}
```

**Create:** `test/commands/SetCellText.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { SetCellText } from '../../src/commands/SetCellText';
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
  it('preserves other cell props', () => {
    const s = new Store();
    s.setCell(0, 0, { text: 'x', type: 'number' });
    new SetCellText({ r: 0, c: 0, text: 'y' }).execute(s);
    expect(s.getCell(0, 0)).toEqual({ text: 'y', type: 'number' });
  });
});
```

Commit: `feat(commands): add SetCellText SetRangeValues SetRowHeight SetColWidth SetMerge`

---

### Task 3.6：CommandManager + 撤销重做

**Create:** `src/commands/CommandManager.ts`

```ts
import type { Store } from '../store/Store';
import type { Command } from './Command';

export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<(m: CommandManager) => void>();

  constructor(private readonly store: Store) {}

  execute(cmd: Command): void {
    cmd.execute(this.store);
    // 合并连续相同类型的 command
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && last.shouldMerge(cmd)) {
      // 简化：保持 last 不动
    } else {
      this.redoStack = [];
    }
    this.undoStack.push(cmd);
    this._notify();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.getUndo().execute(this.store);
    this.redoStack.push(cmd);
    this._notify();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute(this.store);
    this.undoStack.push(cmd);
    this._notify();
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  subscribe(fn: (m: CommandManager) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private _notify(): void {
    this.listeners.forEach(fn => fn(this));
  }
}
```

**Create:** `test/commands/CommandManager.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { CommandManager } from '../../src/commands/CommandManager';
import { Store } from '../../src/store/Store';
import { SetCellText } from '../../src/commands/SetCellText';

describe('CommandManager', () => {
  it('undo and redo', () => {
    const s = new Store();
    const m = new CommandManager(s);
    m.execute(new SetCellText({ r: 0, c: 0, text: 'a' }));
    expect(s.getCell(0, 0)?.text).toBe('a');
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
});
```

Commit: `feat(commands): add CommandManager with undo/redo`

---

### Task 3.7：移动 src/core/ 老代码到 src/core-legacy/

```bash
cd /Users/sunxin/web-spreadsheet
mkdir -p src/core-legacy
git mv src/core/data_proxy.js src/core-legacy/data_proxy.js
git mv src/core/row.js src/core-legacy/row.js
git mv src/core/auto_filter.js src/core-legacy/auto_filter.js
git mv src/core/merge.js src/core-legacy/merge.js
git mv src/core/history.js src/core-legacy/history.js
git mv src/core/col.js src/core-legacy/col.js
git mv src/core/selector.js src/core-legacy/selector.js
git mv src/core/formula.js src/core-legacy/formula.js
git mv src/core/font.js src/core-legacy/font.js
git mv src/core/format.js src/core-legacy/format.js
git mv src/core/validation.js src/core-legacy/validation.js
git mv src/core/validator.js src/core-legacy/validator.js
git mv src/core/clipboard.js src/core-legacy/clipboard.js
git mv src/core/_.prototypes.js src/core-legacy/_.prototypes.js
git mv src/core/scroll.js src/core-legacy/scroll.js
# 保留在 src/core/：
#   alphabet.js, cell.js, cell_range.js, helper.js
```

⚠️ **会破坏 demo**——src/index.js 还 import 老 data_proxy.js。后面 Task 3.10 解决。

Commit: `refactor: move old src/core/ to src/core-legacy/`

---

### Task 3.8：迁移 src/core/alphabet.js → alphabet.ts

**Create:** `src/core/alphabet.ts`

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
  return { x: alpha2num(col), y: parseInt(row, 10) - 1 };
}

export function xy2expr(x: number, y: number): string {
  return `${num2alpha(x)}${y + 1}`;
}
```

**Create:** `test/core/alphabet.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { num2alpha, alpha2num, expr2xy, xy2expr } from '../../src/core/alphabet';

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
    expect(xy2expr(25, 0)).toBe('Z1');
    expect(expr2xy('Z100')).toEqual({ x: 25, y: 99 });
  });
});
```

删除 `src/core/alphabet.js`（已迁到 .ts）。

```bash
git rm src/core/alphabet.js
```

Commit: `refactor(core): alphabet.js → alphabet.ts with full types`

---

### Task 3.9：迁移 src/core/cell.js + cell_range.js + helper.js

**Create:** `src/core/cell.ts`（参考 226 行原版，加类型）

**Create:** `src/core/cell_range.ts`

**Create:** `src/core/helper.ts`

每个文件配对应 test。

⚠️ **要保留向后兼容**——很多老 component/*.js 还在 import 这几个文件。

```bash
git rm src/core/cell.js src/core/cell_range.js src/core/helper.js
```

Commit: `refactor(core): cell cell_range helper → TypeScript`

---

### Task 3.10：改写 src/index.ts（公开 API）

**Create:** `src/index.ts`

```ts
import { Store } from './store/Store';
import { CommandManager } from './commands/CommandManager';
import { SetCellText } from './commands/SetCellText';
import { SetRangeValues } from './commands/SetRangeValues';
import { applyStoredTheme, THEMES, type Theme } from './theme';
import './index.css';

// 老 component 暂时用 JS 版本（不重写）
import { Table } from './component-legacy/table';
// 等等

export interface SpreadsheetOptions {
  data?: unknown[];
  showToolbar?: boolean;
  showBottomBar?: boolean;
  theme?: Theme | false;
  view?: { height?: number; width?: number };
}

export class Spreadsheet {
  private store: Store;
  private cmdManager: CommandManager;
  private table: Table;
  // 老 component 引用
  
  constructor(selector: string | HTMLElement, options: SpreadsheetOptions = {}) {
    if (options.theme !== false) {
      applyStoredTheme();
    }
    this.store = new Store();
    this.cmdManager = new CommandManager(this.store);
    this.table = new Table(selector, this.store, this.cmdManager);
  }
  
  // 新 facade API
  setCellText(r: number, c: number, text: string): this {
    this.cmdManager.execute(new SetCellText({ r, c, text }));
    return this;
  }
  
  setRangeValues(r1: number, c1: number, r2: number, c2: number, values: unknown[][]): this {
    const cellValues = values.map(row =>
      row.map(v => (typeof v === 'object' && v !== null ? v as { text: string } : { text: String(v) }))
    );
    this.cmdManager.execute(new SetRangeValues({ r1, c1, r2, c2, values: cellValues }));
    return this;
  }
  
  undo(): this { this.cmdManager.undo(); return this; }
  redo(): this { this.cmdManager.redo(); return this; }
  
  loadData(data: unknown[]): this {
    // TODO: 转 data → store
    return this;
  }
  
  getData(): unknown {
    return this.store.serialize();
  }
  
  destroy(): void {
    this.table.destroy?.();
  }
}

export { Store, CommandManager, SetCellText, SetRangeValues, THEMES, type Theme };
export default Spreadsheet;
```

⚠️ **这一阶段 src/index.ts 是 partial 实现**——老 component 还没接 Store，data flow 还是老的。等 Week 5-6 改写 Table 时再完整。

**Move 老 component**：跟 core-legacy 思路一致，把 src/component/ 也搬过去：

```bash
mkdir -p src/component-legacy
git mv src/component/*.js src/component-legacy/
```

Commit: `refactor: introduce src/index.ts facade + move components to legacy/`

---

### Task 3.11：键盘绑定 Ctrl+Z / Ctrl+Y

**Modify:** `src/component-legacy/table.js`

找到 onKeyDown，加：

```js
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { CommandManager } from '../commands/CommandManager';

// 在 onKeyDown 中：
if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
  e.preventDefault();
  this.cmdManager.undo();
  return;
}
if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
  e.preventDefault();
  this.cmdManager.redo();
  return;
}
```

验证：浏览器 demo + Ctrl+Z。

Commit: `feat(keyboard): bind Ctrl+Z Ctrl+Y to undo/redo`

---

### Task 3.12：发 v2.0.0（数据层 TS 化）

修改 `package.json`：
```diff
-  "name": "x-data-spreadsheet",
-  "version": "1.1.8",
+  "name": "web-spreadsheet",
+  "version": "2.0.0",
+  "type": "module",
+  "main": "./dist/web-spreadsheet.es.js",
+  "types": "./dist/index.d.ts",
+  "exports": {
+    ".": {
+      "types": "./dist/index.d.ts",
+      "import": "./dist/web-spreadsheet.es.js",
+      "require": "./dist/web-spreadsheet.umd.js"
+    }
+  }
```

发版 + tag：
```bash
pnpm publish --access public
git tag v2.0.0
git push --tags
```

Commit: `chore(release): v2.0.0 - data layer in TypeScript`

---

## 🟡 Week 5-6：Renderer 重写（src/component → src/renderer/*.ts，10 task）

> 从这一周开始，老 component/ 全部重写为 .ts renderer/。这是最重的部分。

### Task 5.1：性能基线测量

**Create:** `test/perf/benchmark.js`（手动跑）

记录原版 demo 在 1000 行 × 50 列下的：
- 滚动 FPS
- 内存占用
- 首次渲染时间

Commit: `docs(perf): record baseline metrics before renderer rewrite`

---

### Task 5.2-5.6：实现 VirtualScroller + DirtyRegion + Renderer + 整合 + 验证

（细节按老板已经批过的原 PLAN.md Week 4 展开，全部用 TS strict）

Commit 系列：
- `feat(renderer): VirtualScroller with virtual range calc`
- `feat(renderer): DirtyRegionTracker with merge`
- `feat(renderer): Canvas renderer with viewport + dirty regions`
- `refactor: integrate Renderer with Store subscribe + ScheduleRender`
- `docs(perf): record post-optimization metrics + comparison`

---

## 🟡 Week 7-8：公式引擎 v1（8 task）

按老板已经批过的原 PLAN.md Week 5，全部用 TS 实现：

- 30 个函数注册表
- Parser（TypeScript PEG 风格或手写）
- Evaluator
- DependencyGraph
- FormulaEngine
- 集成 Store + CommandManager

Commit 系列：
- `feat(formula): types + parser skeleton`
- `feat(formula): 10 core math/logic functions + tests`
- `feat(formula): 10 text/lookup functions + tests`
- `feat(formula): 10 date/misc functions + tests`
- `feat(formula): evaluator with cell reference + range`
- `feat(formula): DependencyGraph + circular detection`
- `feat(formula): FormulaEngine integration with Store`
- `feat(formula): 30-function smoke test + docs`

---

## 🟡 Week 9-10：插件系统 + 类型导出（8 task）

按老板已经批过的原 PLAN.md Week 6 + 加 component .d.ts 声明：

- EventBus
- PluginManager
- PluginAPI
- CsvImport 示例插件
- `src/component-legacy/*.d.ts` 全局类型
- 升级 Spreadsheet.use() API
- 发 v3.0.0
- 写 ARCHITECTURE.md 给贡献者

Commit 系列：
- `feat(events): EventBus with subscribe + wildcard`
- `feat(plugin): PluginManager + PluginAPI`
- `feat(plugin): CsvImport example plugin`
- `feat(component): .d.ts declarations for legacy components`
- `feat(spreadsheet): expose .use() API + registry wiring`
- `chore(release): v3.0.0 - plugin system + component types`
- `docs(arch): add ARCHITECTURE.md with 4-layer + extension points`

---

## 验收清单（10 周完成后）

### Week 1-2 基础
- [ ] 仓库活跃，CI 跑通
- [ ] TypeScript checkJS for legacy
- [ ] Vite 5 + vitest
- [ ] 暗色主题
- [ ] README + ROADMAP
- [ ] v1.5.0 release

### Week 3-4 数据层 TS
- [ ] src/core/ → TypeScript strict
- [ ] Store / CommandManager / 5 commands
- [ ] 撤销重做工作
- [ ] 8+ 个 .ts 文件，0 个 `any`
- [ ] v2.0.0 release

### Week 5-6 渲染层 TS
- [ ] 4 层架构落地
- [ ] VirtualScroller + DirtyRegion
- [ ] 1000 行 × 50 列 60fps
- [ ] 性能前后对比文档

### Week 7-8 公式
- [ ] 公式引擎 v1（30 函数）
- [ ] 依赖图 + 按需重算
- [ ] 集成 Store

### Week 9-10 扩展
- [ ] 插件系统
- [ ] component .d.ts 声明
- [ ] CsvImport 示例
- [ ] v3.0.0 release
- [ ] ARCHITECTURE.md

### 总体目标
- [ ] 10 周至少 50 个 commit
- [ ] maketwin/web-spreadsheet 有 3 个 release（v1.5/v2.0/v3.0）
- [ ] src/ 0 个 .js 文件
- [ ] 0 个 `any`（除非有 JSDoc 注释）
- [ ] `pnpm tsc --noEmit` 0 错
- [ ] `pnpm test` 全过
- [ ] `pnpm build` 出 dist + .d.ts

## 风险与坑

| 风险 | 应对 |
|---|---|
| data_proxy.js 1257 行怪兽迁移 | **分阶段**：先 core-legacy/，再重写关键逻辑 |
| 8 千行 JS 改 TS 报错爆炸 | Week 1 末 `tsc --noEmit` 摸底，按报错数分 task |
| 老 component 跟新 Store 不兼容 | src/component-legacy/ 暂留 1-2 版本，渐进替换 |
| 公式引擎是深坑 | 30 函数先撑，**不要 VLOOKUP** |
| 失去兴趣 | **接受**——Week 1-2 已经是健康项目 |

## 不要做的事（YAGNI）

- ❌ 一次迁完所有 .js → .ts
- ❌ 同步改 src/component/（保留 legacy，加 .d.ts）
- ❌ 重构到完美
- ❌ 追 upstream 同步
- ❌ 协同 / 图表 / 条件格式（Week 11+）
- ❌ 招人 / 商业化

## 给老板的话

老板 10 周后你会有：
- **完整 TypeScript** 化的数据层 + 渲染层
- **3 个 release** 的迭代过程
- **50+ commit** 的活跃项目
- 4 层架构 + 公式引擎 + 插件系统
- 知道接下来想加什么

如果只完成 Week 1-4（v1.5 + v2.0），**也完全 OK**——TS 化的核心数据层 + 健康 API，比大多数"立项半年没 push"的开源项目强。

如果累了就停。**兴趣项目最大的价值是保持兴趣**。
