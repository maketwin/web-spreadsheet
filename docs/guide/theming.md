# 主题与暗色模式

主题由 CSS 变量驱动，`'light'` 与 `'dark'` 两套内置主题，外加一个「完全不管」模式。

## 使用

```ts
// 明确指定
const ss = new Spreadsheet('app', { theme: 'light' }); // 或 'dark'

// 缺省（undefined）：跟随系统
const ss = new Spreadsheet('app');

// 完全不接管主题：组件不设置任何属性、不写 localStorage
const ss = new Spreadsheet('app', { theme: false });
```

「跟随系统」的实现：优先读 `localStorage` 键 `web-spreadsheet-theme`，否则用 `matchMedia('(prefers-color-scheme: dark)')` 判断。

## 工作原理

1. `setTheme(theme)` 在 `<html>` 上设置 `data-spreadsheet-theme="light|dark"` 属性，并写入 localStorage；
2. 组件样式按 `:root[data-spreadsheet-theme="dark"]` 选择器切换 CSS 变量；
3. 同时在 `window` 上派发 Event `ss:theme-changed`，CanvasRenderer 监听后以新变量重绘画布。

公共的 `setTheme()` / `applyStoredTheme()` 自己派发 `ss:theme-changed`——宿主在运行时调用 `setTheme('dark')` 即可让画布按新主题重绘，无需组件配合。

主题工具函数已从包根导出，可在组件外主动切换：

```ts
import { setTheme, getTheme, applyStoredTheme, THEMES } from 'web-spreadsheet';

setTheme('dark');        // 切到暗色并持久化
getTheme();              // 当前生效主题（读 localStorage / 系统偏好）
applyStoredTheme();      // 按存储/系统偏好重新应用
THEMES;                  // { light: 'light', dark: 'dark' }
```

`Theme` 类型即 `'light' | 'dark'` 字符串联合。

::: warning 已知边界
组件自绘的 chrome（画布、表头、工具栏、工作表标签、右键菜单、底部弹层）全部跟随主题；**antd 的弹层/下拉/模态框在暗色下仍是浅色**——应用尚未接入 antd 的暗色主题，是否接入是另一个独立决定。
:::

## CSS 变量清单

自定义外观时覆盖这些变量即可（`theme: false` 时尤其有用）：

| 变量 | Light | Dark |
|------|-------|------|
| `--ss-bg` | `#ffffff` | `#1e1e1e` |
| `--ss-color` / `--ss-text` | `#000000` | `#f3f3f3` |
| `--ss-text-light` | `#605e5c` | `#b3b3b3` |
| `--ss-border` | `#bdbdbd` | `#454545` |
| `--ss-freeze-line` | `#6f6f6f` | `#a6a6a6` |
| `--ss-grid` | `#e0e0e0` | `#2b2b2b` |
| `--ss-outside` | `#f3f3f3` | `#252526` |
| `--ss-selected` | `#e2efda` | `#1f3d2c` |
| `--ss-header-bg` | `#ececec` | `#2d2d2d` |
| `--ss-toolbar-bg` / `--ss-ribbon-bg` | `#f3f3f3` | `#2d2d2d` |
| `--ss-menu-bg` | `#217346` | `#185c37` |
| `--ss-menu-text` | `#ffffff` | `#ffffff` |
| `--ss-text-light` | `#605e5c` | `#b3b3b3` |
| `--ss-accent` | `#217346` | `#3fb950` |
| `--ss-accent-hover` | `#185c37` | `#56d364` |
| `--ss-selection-border` | `#217346` | `#3fb950` |
| `--ss-tab-active-bg` | `#ffffff` | `#1e1e1e` |
| `--ss-tab-inactive-bg` | `#f3f3f3` | `#2d2d2d` |
| `--ss-status-bg` | `#217346` | `#185c37` |
| `--ss-status-text` | `#ffffff` | `#ffffff` |
| `--ss-header-text` | `#444444` | `#b3b3b3`（暗色值在 `spreadsheet.css` 里覆盖，保证深色表头上的对比度） |
| `--ss-surface` | `#ffffff` | `#1e1e1e` |
| `--ss-surface-alt` | `#f8f8f8` | `#252526` |
| `--ss-surface-border` | `#d0d0d0` | `#454545` |
| `--ss-toolbar-bg-start` | `#fafafa` | `#2d2d2d` |
| `--ss-toolbar-bg-end` | `#f0f0f0` | `#2d2d2d` |
| `--ss-chart-tick` | `#666666` | `#b3b3b3` |
| `--ss-chart-grid` | `#e5e5e5` | `#2b2b2b` |
| `--ss-hover-bg` | `#e6e6e6` | `#3a3a3a` |
| `--ss-tab-hover-bg` | `#eaeaea` | `#3a3a3a` |

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `--ss-font-family` | `Calibri, "Segoe UI", "Microsoft YaHei", sans-serif` | 全局字体（暗色不覆盖） |
| `--ss-font-size` | `11px` | 全局字号 |
| `--ss-row-height` | `20px` | 默认行高 |
| `--ss-col-width` | `64px` | 默认列宽 |

## 可访问性

- 全部 UI 元素带 ARIA 角色；
- 键盘可完整导航（见[快捷键](/guide/keyboard)）；
- 焦点态使用 `focus-visible` 轮廓；
- 画布渲染颜色取自上述 CSS 变量，暗色模式下网格、选区、表头同步变化。
