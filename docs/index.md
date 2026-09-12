---
home: true
title: 首页
hero:
  name: web-spreadsheet
  text: 现代化 TypeScript 电子表格 SDK
  tagline: 4 层架构 · Canvas 渲染 · 公式引擎 · 完整撤销 · 插件系统
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: API 文档
      link: /api/spreadsheet
    - theme: alt
      text: GitHub
      link: https://github.com/maketwin/web-spreadsheet
---

## 特性

**网格与编辑**

- Canvas 渲染 + 虚拟滚动（默认 1000×26 网格）+ 脏区域重绘
- Excel 风格外观：菜单栏、工具栏、公式栏、状态栏、Sheet 标签、右键菜单
- 单元格编辑（中文输入法 IME 友好）、查找替换、冻结窗格、行列拖拽调整、合并单元格
- 可访问性：ARIA 角色、键盘完整导航、暗色模式

**Excel 对齐的智能填充**

- 等差延续、非等差最小二乘趋势、日期、星期/月份列表（中英文）、文本+数字
- 四方向填充（向上/向左反向延续），Ctrl 键切换复制/递增（与 Excel 一致）
- 公式引用随填充平移，`$` 绝对锚定受尊重；样式随单元格携带

**公式引擎**

- 28 个内置函数（数学 / 统计 / 逻辑 / 文本 / 查找 / 日期）
- 依赖图驱动的增量重算，跨 Sheet 引用（`Sheet2!A1`）、命名区域

**命令与撤销**

- 命令模式覆盖所有修改，**22 个命令全部可撤销**（含公式结果恢复）

**数据功能**

- 自动筛选（下拉勾选 + 11 种条件运算符）与 Excel 规则排序，筛选范围随选择区域变化（与 Excel 一致）
- 数据验证、条件格式（数据条 / 色阶 / 公式规则）、命名区域
- 工作表保护、迷你图（SVG）、图表（Chart.js）
- 数字格式：7 种内置 + Excel 自定义格式串（`#,##0.00`、`yyyy-mm-dd`、四段式…）

**I/O 与持久化**

- 真实 xlsx 导入导出（SheetJS），数字格式双向保留
- 剪贴板 TSV + HTML 双格式复制粘贴，复制/剪切蚂蚁线会话（移动语义剪切、可重复粘贴），JSON 全量序列化
- IndexedDB 自动保存（1.5s 防抖）与启动恢复

## 快速体验

```ts
import { Spreadsheet } from 'web-spreadsheet';

const ss = new Spreadsheet('#root', {
  data: [
    [{ text: '产品' }, { text: 'Q1' }, { text: 'Q2' }, { text: '总计' }],
    [{ text: '产品A' }, { text: '100' }, { text: '120' }, { formula: '=B2+C2' }],
  ],
});
ss.mount();
```

## 文档导航

| 章节 | 内容 |
|------|------|
| [快速开始](/guide/getting-started) | 安装、第一个表格、主题、插件 |
| [数据模型](/guide/data-model) | Cell / Style / Sheet / 序列化 |
| [渲染层](/guide/rendering) | 双 canvas 分层、AxisIndex、blit 缓存、冻结四象限 |
| [公式引擎](/guide/formulas) | 语法、函数表、已知限制 |
| [命令与撤销](/guide/commands) | 22 个命令、undo/redo、自定义命令 |
| [智能填充](/guide/fill) | 序列识别规则、Ctrl 行为 |
| [格式化](/guide/formatting) | 数字格式、条件格式、数据验证 |
| [数据功能](/guide/data-features) | 筛选、排序、命名区域、保护、图表 |
| [文件 I/O 与持久化](/guide/io) | xlsx / CSV / JSON、IndexedDB |
| [事件系统](/guide/events) | EventBus、Store 订阅 |
| [键盘快捷键](/guide/keyboard) | 完整按键清单 |
| [主题与暗色模式](/guide/theming) | CSS 变量、系统跟随 |
| [插件开发](/plugins/creating-plugins) | PluginAPI、自定义公式函数 |
