# web-spreadsheet 维护与扩展计划

> **For 老板** (纯兴趣，2 周起步)：按周推进，每个 task 完成后 commit。卡住就停，不要硬刚。

**Goal:** 把 x-spreadsheet（社区 fork，仓库已重命名为 web-spreadsheet）从"半放弃"状态拉到"自己用得顺手"状态——加测试、升级工具链、补几个最常用的功能、然后视心情扩展。

**Architecture:**
- 保留原代码结构不动（src/component/*, src/core/*）
- 升级构建链：webpack 4 + babel 7 → vite 5（更轻、更快）
- 测试：vitest + jsdom（零配置跑浏览器代码）
- 新功能以**补丁**形式加，不重构（重构是技术债，兴趣项目别自己挖坑）

**Tech Stack:**
- Node 22, pnpm 11
- Vite 5 + vitest
- TypeScript 仅加 .d.ts（不强制迁移）
- 仍然 Canvas 渲染（别动）

**重要原则:**
1. **每改一行先写一个测试**（虽然原项目没测试）
2. **commit 要小**：一个 task 一个 commit
3. **不动 data_proxy.js**（1257 行的怪兽文件，碰它就是 2 周深渊）
4. **不追新版本上游**（upstream 是 myliang/x-spreadsheet，已停更，跟着同步没意义）

---

## 仓库信息

- **GitHub**: https://github.com/maketwin/web-spreadsheet
- **本地**: `/Users/sunxin/web-spreadsheet`
- **默认分支**: master
- **origin**: 自己的 fork（maketwin）
- **upstream**: myliang/x-spreadsheet（远端留着不删，万一原作者回来）
- **npm 包名**（暂不改）: `x-data-spreadsheet` 1.1.8

## 当前状态快照（已 clone 后实测）

```
src/
├── index.js              入口
├── core/                 数据/工具层 8000+ 行
│   ├── data_proxy.js     1257 行 ⛔️ 别动
│   ├── row.js            356 行
│   ├── cell.js           226 行
│   ├── cell_range.js     224 行
│   ├── auto_filter.js    183 行
│   ├── formula.js         98 行  公式占位（不完整）
│   ├── clipboard.js       35 行
│   ├── history.js         37 行  撤销重做骨架
│   └── ...                其他工具
├── component/            UI 层
│   ├── table.js          核心渲染
│   ├── editor.js
│   ├── toolbar.js
│   └── ...                其他组件
└── locale/               i18n (zh-cn, en, de, nl)
```

```
package.json scripts: dev, build, build-locale, lint, test, coverage
package.json devDeps: webpack 4, babel 7, mocha, eslint airbnb
                       ↑ 老，需要升级
package.json deps: opencollective（赞助横幅）
```

---

## Week 1：稳基（5 个 task）

### Task 1：本地能跑起来

**Objective:** clone → install → 看到 demo 跑通

**Files:** 不动任何代码

**Step 1.1 装依赖**

```bash
cd /Users/sunxin/web-spreadsheet
# 注意：原 postinstall 会跑 opencollective 赞助横幅，可能失败
# 先跳过
HUSKY=0 CI=true pnpm install --ignore-scripts 2>&1 | tail -20
```

预期：node_modules 装好，无 fatal error

**Step 1.2 删 postinstall 防 CI 抽风**

修改 `package.json`，删 `postinstall` 字段（opencollective 横幅插件每次装都打钱，嫌烦就砍）：

```diff
   "scripts": {
     "dev": "...",
     ...
-    "postinstall": "opencollective-postinstall || true"
   }
```

**Step 1.3 跑 dev 看 demo**

```bash
pnpm dev
```

预期：http://localhost:3000 （webpack-dev-server 默认）打开看到一个 spreadsheet demo

**Step 1.4 跑 build**

```bash
pnpm build
```

预期：`dist/` 目录生成 `x-data-spreadsheet.js` + `x-data-spreadsheet.css`

**Step 1.5 跑 lint 看现状**

```bash
pnpm lint 2>&1 | tail -30
```

预期：很多 lint 警告（airbnb 严），但**没有 error**

**Step 1.6 Commit**

```bash
git add package.json
git commit -m "chore: drop opencollective postinstall banner"
```

---

### Task 2：加 CI

**Objective:** GitHub Actions 自动跑 lint + build

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: 删 `.travis.yml`（用 GitHub Actions 替代）

**Step 2.1 写 CI 配置**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm run lint
      - run: pnpm run build
```

**Step 2.2 删 travis**

```bash
rm .travis.yml
```

**Step 2.3 Commit + Push**

```bash
git add .github/workflows/ci.yml
git rm .travis.yml
git commit -m "ci: switch from travis to github actions"
git push
```

验证：去 GitHub 仓库 Actions 标签看第一次跑通

---

### Task 3：加测试基础设施（vitest）

**Objective:** 跑通一个 "hello world" 测试

**Files:**
- Modify: `package.json`（加 devDeps 和 scripts）
- Create: `vitest.config.js`
- Create: `test/sanity.test.js`

**Step 3.1 装 vitest**

```bash
pnpm add -D vitest jsdom @vitest/coverage-v8
```

**Step 3.2 改 package.json scripts**

```diff
   "scripts": {
     "dev": "...",
     "build": "...",
     "build-locale": "...",
     "lint": "...",
-    "test": "mocha --require @babel/register --recursive test",
+    "test": "vitest run",
+    "test:watch": "vitest",
+    "coverage": "vitest run --coverage",
     ...
   }
```

**Step 3.3 写 vitest 配置**

```js
// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.js'],
  },
});
```

**Step 3.4 写第一个 sanity 测试**

```js
// test/sanity.test.js
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Step 3.5 跑测试**

```bash
pnpm test
```

预期：1 passed

**Step 3.6 Commit**

```bash
git add -A
git commit -m "test: add vitest infrastructure + sanity test"
```

---

### Task 4：补核心模块的测试

**Objective:** 给 data_proxy / cell / cell_range 写覆盖率至少 30%

**Files:**
- Create: `test/core/cell.test.js`
- Create: `test/core/cell_range.test.js`
- Create: `test/core/alphabet.test.js`

**Step 4.1 先看 alphabet.js（最简单）**

```bash
cat src/core/alphabet.js
```

预期：91 行，实现 A-Z/AA-ZZ 的列号转换

**Step 4.2 写 alphabet 测试**

```js
// test/core/alphabet.test.js
import { describe, it, expect } from 'vitest';
import { num2alpha, alpha2num } from '../../src/core/alphabet';

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
  it('round trip', () => {
    for (let i = 0; i < 1000; i++) {
      expect(alpha2num(num2alpha(i))).toBe(i);
    }
  });
});
```

如果 import 路径或函数名对不上，根据 `alphabet.js` 实际导出调整。

**Step 4.3 跑测试**

```bash
pnpm test
```

预期：alphabet 3 个 passed

**Step 4.4 同理补 cell.js / cell_range.js**

各 5-10 个 case，参考源码写

**Step 4.5 跑测试 + 看覆盖率**

```bash
pnpm test
pnpm coverage
```

预期：覆盖率报告中 core/ 几个文件 30%+

**Step 4.6 Commit**

```bash
git add -A
git commit -m "test: cover core/alphabet cell cell_range"
```

---

### Task 5：升级构建到 Vite

**Objective:** webpack 4 → vite 5，构建快 10 倍，dev server 启动 < 1s

**Files:**
- Create: `vite.config.js`
- Create: `index.html`（demo 入口）
- Modify: `package.json`（删 webpack 相关 devDeps，加 vite）
- Delete: `webpack.config.js`, `build/` 目录

**Step 5.1 装 vite**

```bash
pnpm add -D vite
pnpm remove webpack webpack-cli webpack-dev-server webpack-merge \
  html-webpack-plugin mini-css-extract-plugin css-loader style-loader \
  file-loader less-loader babel-loader @babel/core @babel/preset-env \
  @babel/plugin-proposal-class-properties @babel/register clean-webpack-plugin
```

**Step 5.2 写 vite.config.js**

```js
// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'x-data-spreadsheet',
      fileName: (format) => `x-data-spreadsheet.${format}.js`,
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: [],
      output: {
        assetFileNames: 'x-data-spreadsheet.[ext]',
        globals: {},
      },
    },
  },
  server: { port: 3000, open: true },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
```

**Step 5.3 写 index.html（demo）**

```html
<!-- index.html -->
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>web-spreadsheet demo</title>
  <link rel="stylesheet" href="src/index.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/demo/main.js"></script>
</body>
</html>
```

**Step 5.4 写 demo 入口**

```js
// demo/main.js
import Spreadsheet from '../src/index.js';
import '../src/index.css';

const data = [
  { cells: { 0: { text: 'A1' }, 1: { text: 'B1' } } },
  { cells: { 0: { text: 'A2' }, 1: { text: 'B2' } } },
];
new Spreadsheet('#root', { data }).loadData(data);
```

**Step 5.5 改 package.json scripts**

```diff
-    "dev": "webpack-dev-server --config build/webpack.config.demo.js",
-    "build": "npm run build-locale && webpack --config build/webpack.config.lib.js",
+    "dev": "vite",
+    "build": "vite build",
```

**Step 5.6 验证**

```bash
pnpm dev   # 浏览器开 http://localhost:3000
pnpm build # dist/ 下出 .es.js + .umd.js
```

**Step 5.7 Commit**

```bash
git add -A
git commit -m "build: migrate from webpack 4 to vite 5"
```

---

## Week 2：补功能（5 个 task，按心情选 1-2 个）

> 这一周老板随便挑，不强求全部完成。**YAGNI 优先**——觉得不必要就跳过。

### Task 6（可选 A）：公式引擎补 10 个函数

**Objective:** SUM/AVERAGE/MAX/MIN/COUNT/IF/CONCAT/LEFT/RIGHT/NOW 这 10 个能跑

**Files:**
- Modify: `src/core/formula.js`（98 行，目前是占位）
- Create: `test/core/formula.test.js`

**Step 6.1 看现有 formula.js**

```bash
cat src/core/formula.js
```

预计：可能只是把字符串 "=SUM(A1:A10)" 存到 cell.f，不求值

**Step 6.2 写一个 super minimal evaluator**

`src/core/formula.js` 追加：

```js
// 最简求值：仅支持 =SUM(range) / =A1 这种
export function evalFormula(formula, getCell) {
  if (!formula?.startsWith('=')) return formula;
  const expr = formula.slice(1).trim();
  // SUM(A1:A5)
  const sumMatch = expr.match(/^SUM\(([A-Z]+\d+):([A-Z]+\d+)\)$/i);
  if (sumMatch) {
    const [_, a, b] = sumMatch;
    // 简化：调用方传 getCell
    let total = 0;
    // ... 解析 A1:A5 调用 getCell 累加
    return total;
  }
  // ... 其他函数
  return '#NAME?';
}
```

**实现要点**（详细代码量较大，**这里只给骨架**）**：
- 写一个简单的 range parser：`A1:B5` → 5x2 的格子列表
- 写 10 个函数，每个 5-10 行
- 写测试覆盖 30 个 case

**这一步是真实的 1-2 周工作量**，如果老板决定做就完整写。这里只是占位。

**Step 6.3 写测试**

```js
// test/core/formula.test.js
import { describe, it, expect } from 'vitest';
import { evalFormula } from '../../src/core/formula';

const getCell = (r, c) => ({ A1: 1, A2: 2, A3: 3, B1: 10 }[`${c}${r}`] ?? 0);

describe('evalFormula', () => {
  it('SUM range', () => {
    expect(evalFormula('=SUM(A1:A3)', getCell)).toBe(6);
  });
  // ... 等等
});
```

**Step 6.4 Commit**

```bash
git commit -am "feat(formula): add 10 basic functions"
```

---

### Task 7（可选 B）：撤销重做

**Objective:** Ctrl+Z / Ctrl+Y 真的工作（原版 history.js 是骨架）

**Files:**
- Modify: `src/core/history.js`
- Modify: `src/core/data_proxy.js`（在 mutation 点记录 history）
- Create: `test/core/history.test.js`

⚠️ **小心**：data_proxy.js 1257 行是大怪兽。每个修改点（set cell / set row height / set merge）都要插一行 history record。**预计 3-5 天工作量**。

**如果老板想做**：
1. 先读 history.js 现状（37 行）
2. 在 data_proxy.js 找所有 `this.data[ri][ci] = ...` 的位置
3. 在每个位置加 `this.history.add({type: 'set', ri, ci, oldValue, newValue})`
4. 写 undo/redo 走历史栈反向应用

**如果觉得太重，跳过**。

---

### Task 8（可选 C）：暗色主题

**Objective:** 加一个 `theme: 'dark'` 选项

**Files:**
- Modify: `src/index.css`（加 :root[data-theme="dark"] 选择器）
- Modify: `src/index.js`（接受 theme 选项）
- Create: `src/theme/dark.css`

**Step 8.1 写 dark.css**

```css
/* src/theme/dark.css */
:root[data-spreadsheet-theme="dark"] {
  --ss-primary-bg: #1e1e1e;
  --ss-primary-color: #d4d4d4;
  --ss-border-color: #3c3c3c;
  --ss-grid-line: #2d2d2d;
  --ss-selected-bg: #264f78;
  --ss-header-bg: #252526;
  --ss-toolbar-bg: #333333;
  --ss-text-color: #d4d4d4;
}
```

**Step 8.2 在 index.css 顶部用 CSS 变量**

找出所有硬编码的 `#fff` / `#000` / `#ddd` 等颜色，替换为 `var(--ss-primary-bg)` 等变量

**Step 8.3 写 toggle 工具**

```js
// src/theme/index.js
export function setTheme(theme) {
  document.documentElement.setAttribute('data-spreadsheet-theme', theme);
}
```

**Step 8.4 Commit**

```bash
git commit -am "feat(theme): add dark mode"
```

预计 2-3 天工作量，**最低成本的功能扩展，推荐做这个**。

---

### Task 9（可选 D）：发 v2.0.0 到 npm

**Objective:** 自己的 fork 有自己的版本

**Files:**
- Modify: `package.json`（改 name + version）
- Modify: `README.md`（说明这是 fork）

**Step 9.1 改 package.json**

```diff
-  "name": "x-data-spreadsheet",
-  "version": "1.1.8",
+  "name": "web-spreadsheet",
+  "version": "2.0.0",
```

**Step 9.2 改 README 头**

加：
```markdown
# web-spreadsheet

> A community-maintained fork of [x-spreadsheet](https://github.com/myliang/x-spreadsheet).
> Modernized with Vite, vitest, and active development.

## What changed from upstream
- Migrated to Vite 5 from webpack 4
- Added test infrastructure (vitest)
- GitHub Actions CI
- ... (列出你做的)
```

**Step 9.3 npm publish**

```bash
pnpm login  # 第一次需要
pnpm publish --access public
```

⚠️ **要小心**：`x-data-spreadsheet` 这个名字原作者已占用（虽然停更），如果你 publish `web-spreadsheet` 这个新名字 OK，但若想同名发布会被 npm 拒。

**Step 9.4 Commit + Tag**

```bash
git commit -am "chore: rename to web-spreadsheet v2.0.0"
git tag v2.0.0
git push --tags
```

---

### Task 10：写 README + ROADMAP

**Objective:** 让别人知道这个项目还活着 + 未来计划

**Files:**
- Modify: `README.md`
- Create: `ROADMAP.md`

**Step 10.1 重写 README**

```
# web-spreadsheet

[原项目 README 内容]

## Why this fork exists
The original maintainer migrated to @wolf-table/table and is no longer
maintaining x-spreadsheet. This fork:
- Updates build tooling (Vite 5, vitest)
- Adds GitHub Actions CI
- Plans to add features the original dropped (formula engine, undo/redo, dark mode)
- MIT licensed, open for contributions

## Status
- [x] Migrated to Vite
- [x] Added vitest
- [x] GitHub Actions
- [ ] Formula engine (in progress)
- [ ] Undo/redo
- [ ] Dark mode

## Install
\`\`\`bash
pnpm add web-spreadsheet
\`\`\`

## Usage
... (跟原来一样)
```

**Step 10.2 写 ROADMAP.md**

```markdown
# Roadmap

## v2.0 — Foundation (current)
- [x] Vite migration
- [x] Vitest setup
- [x] GitHub Actions
- [x] Core module tests

## v2.1 — Usability
- [ ] Dark mode
- [ ] More formula functions
- [ ] Better TypeScript types

## v2.2 — Performance
- [ ] Virtual scrolling
- [ ] Lazy load formulas

## v3.0 — Features
- [ ] Undo/redo
- [ ] Conditional formatting
- [ ] Charts
- [ ] Mobile touch
```

**Step 10.3 Commit**

```bash
git add -A
git commit -m "docs: rewrite README + add ROADMAP"
```

---

## 验收清单（Week 1 完成后）

- [ ] 仓库 fork 到 maketwin/web-spreadsheet，本地 clone 在 /Users/sunxin/web-spreadsheet
- [ ] `pnpm install` 一键装好
- [ ] `pnpm dev` 浏览器看到 spreadsheet demo
- [ ] `pnpm test` 跑通所有测试
- [ ] `pnpm build` 出 dist
- [ ] `pnpm lint` 无 error
- [ ] GitHub Actions 跑通
- [ ] 至少 5 个 commit

## 验收清单（Week 2 完成后）

- [ ] 至少 1 个功能扩展（暗色/公式/撤销重做 选一）
- [ ] README + ROADMAP 更新
- [ ] v2.0.0 release tag（如果发 npm）
- [ ] 至少 10 个 commit

## 风险与坑

| 风险 | 应对 |
|---|---|
| data_proxy.js 改动太深 | **别动**，新功能都从外部 hook |
| 升级工具链破坏 demo | 每次升级前 commit，保留回滚点 |
| 原作者突然回来 | fork 名不同（web-spreadsheet），独立发展 |
| 自己半路放弃 | **接受**。2 周能完成 Week 1 已经很好了 |
| npm 包名冲突 | 用 `web-spreadsheet` 新名，不抢原作者的 `x-data-spreadsheet` |

## 不做的事（YAGNI）

- ❌ 重构 data_proxy.js（1257 行怪兽）
- ❌ 追 TypeScript 全面迁移
- ❌ 追 upstream 同步（upstream 已停更）
- ❌ 大型 feature（图表、协同、AI）
- ❌ 商业化/招人

## 最终目标

2 周后老板你有一个：
- 自己的开源项目（maketwin/web-spreadsheet）
- 能跑、能测、能 build
- 暗色模式或公式其中一个功能上线
- 知道接下来想加什么（ROADMAP.md）
- **值得周末咖啡时间继续维护**

如果只完成 Week 1，**也完全 OK**——5 个 commit + 一个能用的 fork，比大多数"立项半年没 push"的开源项目强。

---

## 给老板的提示

1. **不要追求完美**——这是兴趣项目，不是工作
2. **commit 要小**——一个 task 一个 commit
3. **遇到想不通的就跳过**——下一周再回来
4. **写你**自己**想用的功能**——别追用户需求
5. **3 个月没动静就发个 release**——告诉世界项目还活着
