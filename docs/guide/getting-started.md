# 快速开始

## 安装

项目尚未发布到 npm，目前通过 GitHub 安装：

```bash
pnpm add github:maketwin/web-spreadsheet
```

或者克隆仓库在本地跑 Demo：

```bash
git clone https://github.com/maketwin/web-spreadsheet.git
cd web-spreadsheet
pnpm install --ignore-scripts
pnpm dev
```

## 基本使用

准备一个有宽高的容器元素：

```html
<div id="app" style="width:100%;height:100vh"></div>
```

创建实例并挂载：

```ts
import { Spreadsheet } from 'web-spreadsheet';
import 'web-spreadsheet/styles.css';

const ss = new Spreadsheet('app', {
  data: [
    [{ text: 'Hello' }, { text: 'World' }],
    ['1', '2'],   // 字符串也可以直接作为单元格输入
  ],
});
ss.mount();
```

`new Spreadsheet(root, options?)` 的第一个参数可以是：

- 元素引用：`document.querySelector('#app')`；
- 元素 id：`'app'`；
- 任意 CSS 选择器：`'#app'`、`'.sheet-host'`、`'main .sheet'`。

字符串先按元素 id 查找，找不到再按 CSS 选择器查找（取第一个匹配）。两者都没有命中时抛出 `Error`，例如：

```
Spreadsheet 挂载根元素未找到：文档中既没有 id 为 "#app" 的元素，也没有匹配选择器 "#app" 的元素。请传入已存在于文档中的 HTMLElement、元素 id（如 "app"）或 CSS 选择器（如 "#app"、".container"）。
```

字符串不是合法的 CSS 选择器（也不是存在的元素 id）时同样会抛出说明原因的 `Error`。

## 引入样式

组件自身的样式（主题变量 + 布局与外观规则）随包发布，入口是 `web-spreadsheet/styles.css`，在应用里引入一次即可：

```ts
import 'web-spreadsheet/styles.css';
```

::: tip 样式表要单独引入
这份 CSS 不在 JS 入口里：库构建把它产成一个独立文件，不会给 JS 产物加 import，所以打包器不会自动带上它，必须像上面这样显式引入。表格会撑满挂载容器，容器自己需要有确定的宽高（上面的 `width:100%;height:100vh`）。无头入口 `web-spreadsheet/core` 不包含任何样式。
:::

## 多 Sheet

传入 `sheets` 时每个 sheet 有自己的名字和数据，`data` 会被忽略：

```ts
const ss = new Spreadsheet('app', {
  sheets: [
    { name: 'Q1', data: [[{ text: 'Revenue' }, { text: '10000' }]] },
    { name: 'Q2', data: [[{ text: 'Revenue' }, { text: '12000' }]] },
  ],
});
ss.mount();
```

单元格公式里可以用 `=Q2!B2` 这样的跨表引用（含空格的表名写作 `='My Sheet'!A1`）。

## 单元格输入格式

每个单元格既可以是一个字符串，也可以是部分 `Cell` 对象：

```ts
data: [
  // 字符串：自动尝试解析为数字
  ['100', '产品A'],
  // 对象：text 为显示文本，formula 以 '=' 开头
  [{ text: '合计' }, { formula: '=SUM(A1:A2)' }],
]
```

详见[数据模型](/guide/data-model)。

## 主题

```ts
// 使用内置暗色主题
const ss = new Spreadsheet('app', { theme: 'dark' });

// theme 缺省时跟随系统（读取 localStorage，其次 prefers-color-scheme）
const ss = new Spreadsheet('app');

// 完全不接管主题（自行控制 CSS 变量）
const ss = new Spreadsheet('app', { theme: false });
```

详见[主题与暗色模式](/guide/theming)。

## 插件

```ts
import { Spreadsheet, CsvImportPlugin } from 'web-spreadsheet';

const ss = new Spreadsheet('app');
ss.use(CsvImportPlugin);  // 插件是对象常量（Plugin），返回 this 可链式调用
ss.mount();
```

详见[插件开发](/plugins/creating-plugins)。

## 自动保存与恢复

挂载后组件会自动把工作簿序列化进 IndexedDB：最后一次变化 1.5s 后保存一次（防抖），连续编辑时从第一个未保存的变化起最迟 5s 也会保存一次，关闭/隐藏页面时立即落盘。**下次打开时，只要构造时不传 `data` / `sheets`，就会自动恢复上次的内容**：

```ts
// 第一次：带初始数据
const ss1 = new Spreadsheet('app', { data: [...] });
ss1.mount();

// 之后：不带数据 → 自动从 IndexedDB 恢复
const ss2 = new Spreadsheet('app');
ss2.mount();
```

详见[文件 I/O 与持久化](/guide/io)。

## 销毁

```ts
ss.destroy(); // 卸载 React 组件，停止自动保存，清理事件监听
```

## TypeScript

web-spreadsheet 使用 TypeScript strict 模式编写（`noUncheckedIndexedAccess`、零 `any`），所有公共类型都从包根导出：

```ts
import type {
  SpreadsheetOptions,
  CellInput,
  Style,
  Theme,
  RangeAddress,
  SerializedStore,
} from 'web-spreadsheet';
```

## 下一步

- [数据模型](/guide/data-model) — Cell / Style / Sheet 的完整字段
- [公式引擎](/guide/formulas) — 公式语法与内置函数
- [API 文档](/api/spreadsheet) — 完整的类与方法参考
