# API 参考

所有类与类型均从包根导入：

```ts
import { Spreadsheet, Store, FormulaEngine } from 'web-spreadsheet';
import type { CellInput, Style, RangeAddress } from 'web-spreadsheet';
```

包一共有三个入口：

| 入口 | 内容 | 加载方式 |
|------|------|----------|
| `web-spreadsheet` | 完整 SDK（含 React UI） | `import` 与 `require` 均可 |
| `web-spreadsheet/core` | 无头入口：`Store`、`FormulaEngine`、`CommandManager`、`EventBus`、`CanvasRenderer` 及各服务，不含 antd / chart.js / xlsx / dexie | 仅 `import` |
| `web-spreadsheet/styles.css` | 组件样式（主题变量 + 布局与外观规则） | `import 'web-spreadsheet/styles.css'`，JS 入口不会自动带上，见[快速开始](/guide/getting-started#引入样式) |

---

## Spreadsheet

SDK 的主入口，创建并管理一个电子表格实例。

```ts
new Spreadsheet(root: HTMLElement | string, options?: SpreadsheetOptions)
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `root` | `HTMLElement \| string` | 挂载的 DOM 元素、元素 id（`'app'`）或 CSS 选择器（`'#app'`、`'.host'`）；字符串先按 id、再按选择器查找，都没有命中时抛出中文 `Error` |
| `options` | `SpreadsheetOptions` | 配置选项 |

### SpreadsheetOptions

```ts
interface SpreadsheetOptions {
  data?: readonly (readonly CellInput[])[];  // 单 Sheet 初始数据
  sheets?: readonly SheetInput[];            // 多 Sheet 初始数据（优先于 data）
  theme?: 'light' | 'dark' | false;          // 缺省跟随系统；false 表示不接管
  storage?: StorageOptions | false;          // 自动保存与恢复；缺省开启，存入共享的 default 槽位
}

interface StorageOptions {
  enabled?: boolean;   // 自动保存到 IndexedDB（最后一次变化 1.5s 后落盘，连续编辑最迟 5s 一次，页面隐藏时立即写入）；缺省 true
  key?: string;        // 存档记录名；同一页面嵌入多个实例时各给一个，缺省 'default'
}

interface SheetInput {
  id?: string;
  name: string;
  data?: readonly (readonly CellInput[])[];
}
```

- `data` / `sheets` 在 `mount()` 时通过一个 `SetRangeValues` 命令写入并清空撤销历史——初始数据不可撤销。
- 两者都缺省时，`mount()` 会尝试从 IndexedDB 恢复上次会话（见[I/O 与持久化](/guide/io)）；`storage: false` 时不保存也不恢复，`storage.key` 决定保存到、恢复自哪一份存档。嵌入到别的应用里又不想自动保存时，用 `storage: false`。

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
| `bulkSetCells(entries, sheetId?): void` | 整批写入并发**一个** `cells` 事件；`entries` 为 `[key, Cell]` 对（数值键 `r * TOTAL_COLS + c`） |
| `takeCellsInRect(rect, sheetId?): [number, Cell][]` | 整批取出（移除）矩形内的已存储格子并发**一个** `cells` 事件；返回的列表正是 `bulkSetCells` 接受的形状，稀疏清空命令与它的撤销就是这样配对的 |
| `getStyle(id): Style \| undefined` | 按 styleId 读样式 |
| `setStyle(id, style): void` | 写样式 |
| `getCellStyle(r, c, cell?, sheetId?): Style \| undefined` | 有效样式：格子自有 > 行默认 > 列默认（`cell` 可由已持有它的调用方传入） |
| `getCells(): readonly [string, Cell][]` | 全部 `[key, Cell]` 对（`"r,c"` 字符串键） |

### 稀疏遍历与结构原语

| 方法 | 说明 |
|------|------|
| `forEachCell(fn, sheetId?)` | 对每个**已存储**格子调用 `fn(r, c, cell)`，永不展开地址空间 |
| `forEachCellInRect(rect, fn, sheetId?)` | 只回调 `rect`（`CellRect`）内已存储的格子；代价按矩形地址数与存储数中较小者走 |
| `getCellCount(sheetId?): number` | 已存储格子数 |
| `getUsedBounds(sheetId?): CellRect \| undefined` | 已用范围 `{ r1, c1, r2, c2 }`；空表 `undefined` |
| `limitToData(range, sheetId?): CellRect` | 选区 ∩ 已用范围；不相交时回落到选区首格 |
| `insertRows(at, count, sheetId?)` / `insertCols(...)` | 整体搬移原语：`at` 之后的半平面一次移完，发一个 `structure` 事件；返回被丢弃的格子（溢出阴影等）供撤销 |
| `deleteRows(start, count, sheetId?)` / `deleteCols(...)` | 同上；返回被删带 + 被丢弃的格子 |

这些原语不碰行/列元数据、合并、公式和特性——那些由命令负责（见[命令与撤销](/guide/commands)）。

### 行列与合并

| 方法 | 说明 |
|------|------|
| `getRow(r) / getCol(c): RowMeta \| ColMeta \| undefined` | 行高列宽 / 隐藏标记 / 轴默认样式（`styleId`） |
| `setRow(r, meta) / setCol(c, meta)` | 写行列元数据 |
| `getRowEntries(): readonly [number, RowMeta][]` / `getColEntries(): readonly [number, ColMeta][]` | 带元数据的行 / 列的 `[index, meta]` 对（新数组） |
| `addMerge(range) / removeMerge(range)` | 合并 / 取消合并（A1 风格范围串） |
| `getMergeAt(r, c): string \| undefined` | 查坐标所在合并区（A1 串） |
| `getMergeRectAt(r, c): MergeRect \| undefined` | 查坐标所在合并区，含解析后的边界 `{ r1, c1, r2, c2, range }`（内部共享对象，调用方视为只读） |
| `getMerges(): readonly string[]` | 全部合并区 |

### 功能规则

| 方法 | 说明 |
|------|------|
| `get/set/removeConditionalRule(...)` | 条件格式规则 |
| `getValidationRule(r, c) / getValidationRules()` | 数据验证 |
| `addChart(spec) / removeChart(id) / getCharts()` | 图表定义 |
| `addImage(spec) / removeImage(id) / getImages()` | 浮动图片对象 |
| `addSparkline / removeSparkline / getSparklineAt` | 迷你图 |
| `get/set/removeNamedRange(...)` | 命名区域 |
| `getRowGroups() / setRowGroups(groups)` | 行分组区间 |
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
constructor(store: Store, options?: FormulaEngineOptions)
// FormulaEngineOptions = { registry?: FunctionRegistry }
// 不传 options 时使用共享 registry；传 new FunctionRegistry(registry) 可让引擎
// 使用私有表（查不到的名字回落共享表，本表注册不外泄）。engine.registry 可读。
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
| `FormulaParser` | 公式 → AST 解析器（`new FormulaParser().parse(formula)`，实例方法） |
| `evaluate` | AST 求值器 |
| `DependencyGraph` | 依赖图（`setDependencies` / `clearDependencies` / `getAffected`） |
| `registry` | 共享函数注册表（`register` / `get` / `has` / `list`），`FunctionSpec = { minArgs, maxArgs, evaluate(args, ctx?) , volatile? }` |
| `FunctionRegistry` | 函数表类，`new FunctionRegistry(parent?)` 构造私有表；`evaluate` 的第二参 `ctx?: FunctionContext`（`{ cell: { r, c }, sheetId }`）让函数获知所在单元格/工作表 |
| `volatile` 标记 | `FunctionSpec.volatile: true` 的函数（`NOW` / `TODAY`）所在单元格在每一轮有工作的重算里重新求值（Excel 规则） |
| `RANGE_DEP_CELLS` | 大区间的矩形依赖阈值（256）：面积超过它的区间登记为一个矩形依赖，不再每格一条边 |
| `isSparseRange` / `SparseRangeValue` | 稀疏区间值与守卫：超过 `MAX_DENSE_RANGE_CELLS` 的区间引用以此表示，只携带形状和已存储格子的遍历 |

---

## CommandManager

命令模式入口，维护 undo / redo。

```ts
constructor(store: Store, events?: EventBus)
```

挂载后的实例通过 `ss.cmdManager` 取得；不挂载内置 UI 的无头场景可以从 `web-spreadsheet/core` 导入后自行创建：`new CommandManager(store, events?)`。

| 方法 | 说明 |
|------|------|
| `execute(cmd, options?: ExecuteOptions): boolean` | 执行命令。默认（`record: true`）按用户编辑处理：保护检查、`command:*` 事件、进撤销栈、成为 F4 重复源；`{ record: false }` 作为程序化编辑应用（时间线回放、导入、迁移）——同样的批处理与异常边界，但不进撤销栈、不发 `command:*` 事件、不做保护检查。返回 `true` 表示命令体已执行（含无操作命令），被保护拒绝或抛异常为 `false` |
| `undo(): void` | 执行栈顶命令的逆命令，发布 `command:undone` |
| `redo(): void` | 重做，发布 `command:redone` |
| `canUndo() / canRedo(): boolean` | 栈是否非空 |
| `getUndoStack() / getRedoStack(): readonly HistoryEntry[]` | 历史记录（`{ description, index }`） |
| `undoToIndex(targetIndex): void` | 一次回退多步 |
| `historyWeight(): number` | 两个栈当前保留的单元格数（内存预算 `MAX_HISTORY_RETAINED_CELLS`，超限淘汰最旧撤销步、始终保留最新一步） |
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
| `DataValidationService` | 数据验证（`validate(value, rule, context?)`） | [格式化](/guide/formatting) |
| `ConditionalService` | 条件格式覆盖层（`computeOverlay(store, r, c)`） | [格式化](/guide/formatting) |
| `NamedRangeService` | 命名区域增删查与公式解析 | [数据功能](/guide/data-features) |

`DataValidationService.validate` 的第三个参数 `context`（类型 `ValidationContext`，`{ store, r, c, sheetId? }`）把被验证的单元格放进它所在的表：自定义公式规则会按规则范围左上角平移到被验证单元格处求值，引用读取真实单元格——不传时引用无法解析（退化为只读候选值）；候选值为空时始终通过所有规则（Excel「忽略空值」默认开启）。

`FindReplaceService`（查找替换）暂未从包根导出，由内置 UI（`Ctrl/Cmd+F` / `Ctrl/Cmd+H`）自动接线，见[数据功能](/guide/data-features)。

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

- **UI 组件**：`Toolbar`、`BottomBar`、`Editor`、`Menu`、`MenuBar`、`SpreadsheetComponent`、`ErrorBoundary`、`FloatingChart`、`Sparkline`（均附 `*Props` 类型）。
- **命令类（17 个）**：`InsertRowCommand`、`InsertColCommand`、`DeleteRowCommand`、`DeleteColCommand`、`SetCellStyleCommand`、`SetRangeStyleCommand`、`SetRangeBorderCommand` + `edgesForPreset`、`SetAxisStyleCommand`、`ClearAxisStyleCommand`、`SetConditionalFormatCommand`、`SetValidationCommand`、`CreateChartCommand`、`SetChartAnchorCommand`、`RemoveChartCommand`、`SetRowsHiddenCommand`、`SetColsHiddenCommand`、`SetSparklineCommand`（其余 25 个命令为内部命令，见[命令与撤销](/guide/commands)）。轴样式附带辅助函数 `axisSelectionOf(range)`（选区是整列/整行/整表时返回 `{ axis, from, to }`，有界选区返回 `null`）与 `reservedAxisStyleId(axis, index)`（保留前缀 `colstyle-<c>` / `rowstyle-<r>`）。
- **命令标识与回放**：`isReplayableKind`、`buildReplayableCommand`、`REPLAYABLE_KINDS`（类型 `ReplayableCommandKind`）——31 种可凭记录参数重建的命令白名单（本轮新增 `setAxisStyle` / `clearAxisStyle`），见[命令与撤销](/guide/commands#命令标识与回放)。
- **事件**：`EventBus`（类型化：`SpreadsheetEvents` 为内置事件表，已知事件名载荷类型精确，自定义事件名保持 `unknown`）与类型 `SpreadsheetEvents`、`EventPayload`、`EventHandler`、`WildcardPayload`；`StoreEvent` 新增 `structure`（整行/列插入删除，`{ axis, kind, start, count, sheetId? }`）与 `cells`（整批改写，`{ keys, sheetId? }`，数值键）两个变体。
- **插件**：`PluginManager`、`PluginAPI`、`CsvImportPlugin`、`Plugin`、`PluginHost` 类型。
- **I/O 与持久化**：`exportCsv` / `exportCsvBlob` / `csvQuote` / `CsvRangeTooLargeError`（CSV 导出，BOM'd UTF-8 显示值；已用范围超 200 万格时抛错）、`loadWorkbook` / `deleteWorkbook` / `DEFAULT_ID` / `WORKBOOK_FORMAT_VERSION`（当前 `2`：每表一个 JSON 字符串的 v2 存档格式；新版读 v1 记录，旧版拒绝 v2，见[I/O](/guide/io)）。
- **上限常量**：`MAX_MATERIALIZED_CELLS = 250_000`（一次粘贴平铺/填充的写入上限）、`MAX_DENSE_RANGE_CELLS = 2_000_000`（区间引用的稠密数组上限）、`MAX_HISTORY_RETAINED_CELLS = 2_000_000`（撤销历史保留单元格预算）、`RANGE_DEP_CELLS = 256`（大区间矩形依赖阈值）。
- **公式**：`isSparseRange` 守卫与 `SparseRangeValue` 类型（超过稠密上限的区间以稀疏值求值，见[公式引擎](/guide/formulas)）。
- **工具函数**：`parseNameBoxInput`（名称框输入解析）、`skipHiddenCells`（跳过隐藏行的选区步进）、`toggleAutoFilterCommand`、`sparklineValues` / `parseInternalRangeKey`、`parseInternalRange`（内部 `"r,c"` / `"r1,c1:r2,c2"` 记法的统一解析，角归一化，无效输入返回 `null`）。
- **类型**：`Cell`、`CellValue`、`Style`、`RowMeta`、`ColMeta`、`StoreEvent`、`Unsubscribe`、`SerializedStore`、`MergeRect`、`CellRect`、`ExecuteOptions`、`Theme`、`CellInput`、`SpreadsheetOptions`、`StorageOptions`、`SpreadsheetProps`、`CellAddress`、`RangeAddress`、`AstNode`、`CellResolver`、`FormulaValue`、`SparseRangeValue`、`FunctionSpec`、`FunctionContext`、`FormulaEngineOptions`、`SpreadsheetEvents`、`EventPayload`、`ReplayableCommandKind`、`InternalRange`、`ConditionalRule`、`ConditionalOverlay`、`ValidationRule`、`ValidationType`、`ValidationContext`、`SheetFreeze`、`ChartSpec`、`ChartType`、`ChartAnchor`、`ChartAnchorEdge`、`SparklineSpec`、`SparklineType`、`NamedRangeDef`、`SheetProtectionState`、`BorderPreset`、`BorderLine`、`SetAxisStyleArgs`、`ClearAxisStyleArgs`、`StyleAxis`、`AxisSelection` 等（`RichTextRun`、`CellHyperlink`、`CellComment`、`ImageSpec`、`RowGroupDef` 暂未从包根导出）。
