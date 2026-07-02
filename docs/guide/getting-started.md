# 快速开始

## 安装

```bash
pnpm add web-spreadsheet
# 或
npm install web-spreadsheet
```

## 基本使用

```html
<div id="app" style="width:100%;height:100vh"></div>
```

```ts
import { Spreadsheet } from 'web-spreadsheet';

const ss = new Spreadsheet('app', {
  data: [
    [{ text: 'Hello' }, { text: 'World' }],
    [{ text: '1' }, { text: '2' }],
  ],
});
ss.mount();
```

## 多 Sheet

```ts
const ss = new Spreadsheet('app', {
  sheets: [
    { name: 'Q1', data: [[{ text: 'Revenue' }, { text: '10000' }]] },
    { name: 'Q2', data: [[{ text: 'Revenue' }, { text: '12000' }]] },
  ],
});
ss.mount();
```

## 暗色模式

```ts
// 使用内置暗色主题
const ss = new Spreadsheet('app', { theme: 'dark' });

// 跟随系统
const ss = new Spreadsheet('app'); // theme 默认 auto

// 禁用主题（自行控制 CSS 变量）
const ss = new Spreadsheet('app', { theme: false });
```

## 插件

```ts
import { Spreadsheet, CsvImportPlugin } from 'web-spreadsheet';

const ss = new Spreadsheet('app');
ss.use(new CsvImportPlugin());
ss.mount();
```

## 销毁

```ts
ss.destroy(); // 卸载 React 组件，清理事件监听
```

## TypeScript

web-spreadsheet 使用 TypeScript strict 模式编写，提供完整的类型定义：

```ts
import type { SpreadsheetOptions, CellInput, Style, Theme } from 'web-spreadsheet';
```

## 下一步

- [API 文档](/api/spreadsheet) — 完整的 API 参考
- [插件开发](/plugins/creating-plugins) — 如何编写自定义插件
