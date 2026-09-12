# API 参考

所有类与类型均从包根导入：

```ts
import { Spreadsheet, Store, FormulaEngine } from 'web-spreadsheet';
import type { CellInput, Style, RangeAddress } from 'web-spreadsheet';
```

---

## Spreadsheet

SDK 的主入口，创建并管理一个电子表格实例。

```ts
new Spreadsheet(root: HTMLElement | string, options?: SpreadsheetOptions)
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `root` | `HTMLElement \| string` | 挂载的 DOM 元素或元素 id；id 查不到会抛 `Error` |
| `options` | `SpreadsheetOptions` | 配置选项 |

### SpreadsheetOptions

```ts
interface SpreadsheetOptions {
  data?: readonly (readonly CellInput[])[];  // 单 Sheet 初始数据
  sheets?: readonly SheetInput[];            // 多 Sheet 初始数据（优先于 data）
  theme?: 'light' | 'dark' | false;          // 缺省跟随系统；false 表示不接管
}

interface SheetInput {
  id?: string;
  name: string;
  data?: readonly (readonly CellInput[])[];
}
```

- `data` / `sheets` 在 `mount()` 时通过一个 `SetRangeValues` 命令写入并清空撤销历史——初始数据不可撤销。
- 两者都缺省时，`mount()` 会尝试从 IndexedDB 恢复上次会话（见[I/O 与持久化](/guide/io)）。

### 实例属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `store` | `Store` | 数据存储层 |
| `events` | `EventBus` | 事件总线 |
| `cmdManager` | `CommandManager` | 命令管理器（undo/redo） |
| `formula` | `FormulaEngine` | 公式引擎 |
| `rowCount` | `number` | 初始数据的行数（getter） |

### 实例方法

| 方法 | 说明 |
|------|------|
| `mount(): void` | 写入初始数据（或从 IndexedDB 恢复）→ 创建 React root 并渲染；挂载后自动启动 IndexedDB 自动保存与应用主题 |
| `destroy(): void` | 卸载 React 组件（级联停止自动保存、清理渲染器监听）、清空插件列表 |
| `use(plugin: Plugin): this` | 注册插件，返回 `this` 支持链式调用 |

---

## Store

响应式数据层，管理单元格、样式、Sheet 与各功能规则。

```ts
import { Store } from 'web-spreadsheet';

const store = ss.store;
```

除标注外，所有方法都接受可选的 `sheetId` 尾参（缺省为活动 sheet）。

### Sheet 管理

| 方法 | 说明 |
|------|------|
| `getActiveSheetId(): string` | 活动 sheet id（默认 `'sheet-1'`） |
| `getActiveSheetName(): string` | 活动 sheet 名 |
| `getSheets(): readonly SheetInfo[]` | 全部 sheet（`{ id, name }`） |
| `activateSheet(id): boolean` | 切换活动 sheet |
| `addSheet(name?): string` | 添加 sheet，返回新 id |
| `deleteSheet(id): boolean` | 删除 sheet（只剩一个时拒绝） |
| `renameSheet(id, name): boolean` | 重命名 |
| `getSheetData(sheetId?): SheetData \| undefined` | sheet 数据对象 |

### 单元格与样式

| 方法 | 说明 |
|------|------|
| `getCell(r, c): Cell \| undefined` | 读单元格 |
| `getCellBySheetName(name, r, c)` | 按 sheet 名读 |
| `setCell(r, c, cell \| undefined): void` | 写单元格（`undefined` 为清空） |
| `getStyle(id): Style \| undefined` | 按 styleId 读样式 |
| `setStyle(id, style): void` | 写样式 |
| `getCells(): readonly [string, Cell][]` | 全部 `[key, Cell]` 对 |

### 行列与合并

| 方法 | 说明 |
|------|------|
| `getRow(r) / getCol(c): RowMeta \| ColMeta \| undefined` | 行高列宽 / 隐藏标记 |
| `setRow(r, meta) / setCol(c, meta)` | 写行列元数据 |
| `addMerge(range) / removeMerge(range)` | 合并 / 取消合并（A1 风格范围串） |
| `getMergeAt(r, c): string \| undefined` | 查坐标所在合并区 |
| `getMerges(): readonly string[]` | 全部合并区 |

### 功能规则

| 方法 | 说明 |
|------|------|
| `get/set/removeConditionalRule(...)` | 条件格式规则 |
| `getValidationRule(r, c) / getValidationRules()` | 数据验证 |
| `addChart(spec) / removeChart(id) / getCharts()` | 图表定义 |
| `addSparkline / removeSparkline / getSparklineAt` | 迷你图 |
| `get/set/removeNamedRange(...)` | 命名区域 |
| `getProtection / setProtection / isSheetProtected` | 工作表保护 |
| `getAutoFilter / setAutoFilter` | 自动筛选状态 |

### 订阅与批量

| 方法 | 说明 |
|------|------|
| `subscribe(fn: (e: StoreEvent) => void): Unsubscribe` | 订阅变更（见[事件系统](/guide/events)） |
| `batch(fn): void` | 批量修改，结束时合并投递事件 |
| `isFlushing(): boolean` | 是否正在批量刷新 |
| `onBatchEnd(fn): Unsubscribe` | 批量结束回调 |

### 序列化

| 方法 | 说明 |
|------|------|
| `serialize(): SerializedStore` | 序列化为 JSON 安全对象 |
| `Store.deserialize(data): Store`（静态） | 从序列化数据还原 |

---

## FormulaEngine

公式引擎：解析、依赖图、增量重算。UI 会自动同步公式并触发重算，以下方法供底层定制使用。

```ts
constructor(store: Store)
```

| 方法 | 说明 |
|------|------|
| `setFormula(cellId, formula, dependsOn: string[], sheetId?): void` | 注册公式及其依赖（cellId 为 `"r,c"`） |
| `removeFormula(cellId, sheetId?): void` | 移除公式 |
| `onCellChanged(cellId, sheetId?): void` | 通知变更，触发受影响下游的增量重算 |
| `recalculate(scopedId): void` | 强制重算（入参为 `sheetId:r,c` 的完整键） |

相关导出：

| 导出 | 说明 |
|------|------|
| `FormulaParser` | 公式 → AST 解析器（`FormulaParser.parse(formula)`） |
| `evaluate` | AST 求值器 |
| `DependencyGraph` | 依赖图（`setDependencies` / `clearDependencies` / `getAffected`） |
| `registry` | 函数注册表（`register` / `get` / `has` / `list`），`FunctionSpec = { minArgs, maxArgs, evaluate }` |

---

## CommandManager

命令模式入口，维护 undo / redo。

```ts
constructor(store: Store, events?: EventBus)
```

| 方法 | 说明 |
|------|------|
| `execute(cmd): void` | 执行命令，发布 `command:executed` |
| `undo(): void` | 执行栈顶命令的逆命令，发布 `command:undone` |
| `redo(): void` | 重做，发布 `command:redone` |
| `canUndo() / canRedo(): boolean` | 栈是否非空 |
| `getUndoStack() / getRedoStack(): readonly HistoryEntry[]` | 历史记录（`{ description, index }`） |
| `undoToIndex(targetIndex): void` | 一次回退多步 |
| `clear(): void` | 清空历史 |

命令清单与自定义命令见[命令与撤销](/guide/commands)。

---

## VirtualScroller

虚拟滚动：维护行高列宽模型，计算可见范围与像素坐标。

```ts
new VirtualScroller(opts: VirtualScrollerOptions)
// opts: { totalRows, totalCols, defaultRowHeight, defaultColWidth, viewportW, viewportH }
```

| 方法 | 说明 |
|------|------|
| `setScroll(top, left): void` | 更新滚动位置（公开字段 `scrollTop` / `scrollLeft`） |
| `setViewport(w, h): void` | 更新视口尺寸 |
| `setRowHeight(r, h) / setColWidth(c, w)` | 覆盖单行 / 单列尺寸 |
| `getRowHeight(r) / getColWidth(c): number` | 读取尺寸（未设置则回落默认值） |
| `getVisibleRange(): VisibleRange` | `{ startRow, endRow, startCol, endCol }` |
| `cellToPixel(r, c): PixelPosition` | 单元格左上角像素坐标 |

---

## ClipboardService

剪贴板服务（全静态方法）。`ClipboardService` 本身无状态；内置 UI 在其上实现了
剪贴板会话（复制/剪切蚂蚁线、剪切移动语义），详见
[文件 I/O 与持久化 → 应用内剪贴板会话](/guide/io#应用内剪贴板会话-蚂蚁线)。

| 方法 | 说明 |
|------|------|
| `copy(store, range, clipboard?): Promise<boolean>` | 复制选区（TSV + HTML 双写，降级纯文本） |
| `cut(store, range, clipboard?): Promise<boolean>` | 剪贴板部分等同复制，清空由调用方完成 |
| `read(clipboard?): Promise<Cell[][]>` | 读取：HTML 优先，纯文本降级 |
| `parseText(text): Cell[][]` | TSV → 单元格矩阵 |
| `parseHtml(html): Cell[][]` | `<table>` → 单元格矩阵 |
| `parsePaste(text, html?): Cell[][]` | 粘贴入口（HTML 优先） |
| `createPayload(store, range): ClipboardPayload \| null` | 构造 `{ text, html }` |

---

## 数据功能服务

这些服务类已从包根导出，可直接实例化（多数场景下 UI 已自动接线）：

| 类 | 职责 | 文档 |
|----|------|------|
| `FilterService` | 自动筛选条件、下拉项、排序、筛选范围推断（`autoFilterRangeFor`） | [数据功能](/guide/data-features) |
| `DataValidationService` | 数据验证（`validate(value, rule)`） | [格式化](/guide/formatting) |
| `ConditionalService` | 条件格式覆盖层（`computeOverlay(store, r, c)`） | [格式化](/guide/formatting) |
| `NamedRangeService` | 命名区域增删查与公式解析 | [数据功能](/guide/data-features) |
| `FindReplaceService` | 查找替换 | [数据功能](/guide/data-features) |

工作表保护是四个纯函数：

```ts
import { hashPassword, verifyPassword, protectSheet, unprotectSheet } from 'web-spreadsheet';
```

## 主题工具

```ts
import { setTheme, getTheme, applyStoredTheme, THEMES } from 'web-spreadsheet';
// Theme = 'light' | 'dark'
```

## 渲染相关

| 导出 | 说明 |
|------|------|
| `CanvasRenderer` | Canvas 渲染器 |
| `canvasPointToCell` / `canvasPointToHeader` | 画布像素 → 单元格 / 表头坐标 |
| `DirtyRegionTracker` | 脏区域合并跟踪 |
| `VirtualScroller` | 见上文 |

## 其余导出

- **UI 组件**：`Toolbar`、`BottomBar`、`Editor`、`Menu`、`MenuBar`、`SpreadsheetComponent`、`ErrorBoundary`、`ChartPanel`、`Sparkline`（均附 `*Props` 类型）。
- **命令类**：`InsertRowCommand`、`InsertColCommand`、`DeleteRowCommand`、`DeleteColCommand`、`SetCellStyleCommand`、`SetRangeStyleCommand`、`SetRangeBorderCommand` + `edgesForPreset`、`SetConditionalFormatCommand`、`SetValidationCommand`、`CreateChartCommand`、`SetSparklineCommand`。
- **插件**：`PluginManager`、`PluginAPI`、`CsvImportPlugin`、`Plugin` 类型。
- **类型**：`Cell`、`CellValue`、`Style`、`RowMeta`、`ColMeta`、`StoreEvent`、`Unsubscribe`、`SerializedStore`、`Theme`、`CellAddress`、`RangeAddress`、`AstNode`、`FormulaValue`、`FunctionSpec`、`ConditionalRule`、`ConditionalOverlay`、`ValidationRule`、`ValidationType`、`ChartSpec`、`ChartType`、`SparklineSpec`、`SparklineType`、`NamedRangeDef`、`SheetProtectionState`、`BorderPreset`、`BorderLine` 等。
