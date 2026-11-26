# 架构总览

web-spreadsheet 是一个 TypeScript SDK：上层业务只接触 Facade 与命令。依赖是**单向**的——渲染器与 React 外壳依赖数据与命令内核，内核不知道任何 UI 的存在（Canvas 出现在依赖图的消费侧，不在底层）。

```
[User]
   ↓
[入口]                        src/index.ts（完整 SDK，含 React 外壳）
                              src/core.ts（无头核心，零 antd/chart.js/xlsx/dexie）
   ↓
[UI / 交付层]                 src/components/  src/renderer/  src/io/
                              src/print/  src/db/  src/platform/
   ↓
[功能服务层]                  selection conditional validation filter find
 （渲染器 / IO / 组件按需使用） format fill clipboard sparkline outline
                              namedrange protection analysis data keys
                              freeze charts（纯模块）
   ↓
[内核]                        src/commands/  src/store/  src/formula/
                              src/events/  ←  store.subscribe() 变更事件
   ↓
[基础层]                      src/types.ts  src/util/（网格常量在 util/gridSize）
```

内核四目录受 eslint 分层规则①约束（不得 import React / UI / 渲染器 / platform / io / db）；网格常量唯一定义在 `src/util/gridSize.ts`，渲染器之外必须从它取（规则③，`renderer/coordinate` 只转发）；platform 核心文件零引擎依赖，引擎访问只出现在 apiFunctions / replay / deps / PlatformPanel 四个适配文件（规则②）；`src/util/` 是整张依赖图的最底层，值导入只允许 util 内部（`./…`、`../util/…`）与 `../types`，类型导入不受限（规则④）。`util/` 曾经不完全是叶子层（`util/cell.ts` 依赖公式解析器与数字格式化、`util/rangeValues.ts` / `util/rowAutofit.ts` / `util/styleAutofit.ts` 依赖命令层），这批向上边已经搬平：公式相关的挪到 `formula/refRewrite.ts`、`formula/precedents.ts`、`format/displayText.ts`，范围记法统一进 `util/rangeNotation.ts`，命令相关的挪到 `commands/rangeValues.ts` 与 `components/`，规则④把这条底线锁死——依赖分析当前 `util` 的向上值依赖为 0、文件级值导入循环为 0。如实说明尚未理顺的部分：功能服务与内核之间仍有双向边——commands 值导入 charts / sparkline / filter / outline / fill / selection / data 等功能模块，conditional / validation / filter / find 值导入 formula；这条带目前没有 lint 规则约束。

## 各层职责

| 层 | 目录 | 职责 |
|----|------|------|
| Facade | `src/index.ts`、`src/components/Spreadsheet.tsx` | `Spreadsheet` 类：挂载 React 组件树，装配 store / 公式引擎 / 命令管理器 / 插件管理器 |
| Commands | `src/commands/` | 所有修改都是命令对象（`execute` / `getUndo`），由 `CommandManager` 统一执行并维护 undo/redo 栈 |
| Store | `src/store/` | 响应式数据层：单元格、样式、合并、各功能规则；变更通过 `subscribe` 广播 |
| Formula | `src/formula/` | 解析器 → 依赖图 → 求值器，增量重算 |
| Events | `src/events/` | `EventBus`：命令执行/撤销/重做等事件的发布订阅 |
| Renderer | `src/renderer/` | Canvas 渲染：`VirtualScroller`（AxisIndex 前缀和索引）+ `DirtyRegionTracker` 脏区域重绘 + 双 canvas 分层 + 滚动 blit 缓存 + `FreezeManager` 四象限冻结，详见 [渲染层](./rendering.md) |
| Components | `src/components/` | React UI：菜单栏、工具栏、编辑器、底部状态栏、Sheet 标签页 |

## 周边功能模块

| 目录 | 功能 |
|------|------|
| `src/fill/` | 智能填充序列引擎（等差/趋势/日期/列表/文本+数字） |
| `src/format/` | 数字格式化（内置格式 + Excel 自定义格式串） |
| `src/filter/` | 自动筛选与排序 |
| `src/validation/` | 数据验证 |
| `src/conditional/` | 条件格式 |
| `src/namedrange/` | 命名区域 |
| `src/protection/` | 工作表保护 |
| `src/sparkline/` `src/charts/` | 迷你图（SVG）/ 图表（Chart.js） |
| `src/clipboard/` | 复制/剪切/粘贴（TSV + HTML 双格式） |
| `src/data/` | 数据工具：分列、删除重复项 |
| `src/outline/` | 行分组（组合/折叠/展开） |
| `src/analysis/` | 数据透视表（按首列分组求和，写入新工作表） |
| `src/print/` | 分页打印管线（单表/整簿、PDF 导出） |
| `src/find/` | 查找替换服务 |
| `src/selection/` `src/keys/` | 名称框解析与可见步进 / 键盘事件解析 |
| `src/db/` | IndexedDB 自动保存（Dexie） |
| `src/io/` | xlsx 导入导出（SheetJS，含样式/图表/批注/超链接 XML）、CSV、PDF |
| `src/plugin/` | 插件系统（PluginAPI/PluginManager）与内置插件（CsvImportPlugin） |
| `src/util/` | 共享工具（网格常量 `gridSize`、富文本、合并、超链接等） |

## 渲染性能要点

- **虚拟滚动**：`VirtualScroller` 只计算可视区域（画布网格是 Excel 的全部地址空间：1,048,576 行 × 16,384 列），行高列宽可变；坐标查询由 `AxisIndex` 前缀和索引支撑，O(log n)。
- **双 canvas 分层**：网格层与覆盖层（选区/手柄/拖拽框）分离，高频交互不再触发网格重绘。
- **滚动 blit 缓存**：纯滚动平移上一帧快照，只重绘新暴露条带与钉住的表头区域。
- **文本测量缓存**：`TextMetricsCache`（LRU 5000）消除热路径中的 `measureText` 调用。
- **脏区域重绘**：`DirtyRegionTracker` 合并重绘矩形，避免整画布刷新。
- **缩放**：`zoom` 影响 `defaultRowHeight/ColWidth` 的计算（行高 × zoom）。

完整的渲染层设计见 [渲染层](./rendering.md)。

## 规模化内核

网格是 Excel 的地址空间（1,048,576 × 16,384，唯一定义在 `src/util/gridSize.ts`），核心原则是**地址空间不是分配**——任何代价只能随「已存储的单元格数 / 元数据条数」走，不能随选区或已用范围的面积走。落到四个子系统的做法：

**稀疏存储与整体搬移**（`src/store/SheetData.ts`、`src/store/Store.ts`）：格子以数值键 `r * TOTAL_COLS + c` 存在一张 Map 里，提供只走已存储格子的遍历/范围 API（`forEachCell` / `forEachCellInRect` / `getUsedBounds` / `limitToData`）；插删行列走 `insertRows` / `deleteRows` 等整体搬移原语——半平面一次移完，只发一个 `structure` 事件，撤销不再保留整带快照。

**轴默认样式**（`src/commands/impl/SetAxisStyle.ts`）：整列/整行/整表选区写 `RowMeta`/`ColMeta.styleId` 列/行默认样式，代价 O(轴长)、零格子写入；有效样式按「格子自有 > 行默认 > 列默认」在 `Store.getCellStyle` 解析，渲染器按帧缓存（`src/renderer/CanvasRenderer.ts` 的 `cellStyle`）。

**导入导出流水线**（`src/io/XlsxExporter.ts` 等）：SheetJS 写基础包 → fflate 一次解包 → 稀疏打包坐标还原、样式、表特性、图表、批注四个后处理器在内存文件表上就地修改 → fflate 一次压缩打包（输出为 deflate 压缩）；导入侧 `src/io/safeUnzip.ts` 在解压前按中央目录声明的大小拦炸弹，单条目 128 MiB / 总计 256 MiB。

**自动保存编码器**（`src/db/workbookEncoder.ts`、`src/db/autoSave.ts`）：按表标脏、只重新编码内容变过的表，每张表按约 20,000 格一片分片编码、片间让出主线程；存档为 v2 格式（每表一个 JSON 字符串），离开页面时一次同步写完。

实验台可复跑：`pnpm bench:scale`（Node 基准，结果写 `coverage/scale-bench/*.json`）与 `pnpm e2e:scale`（真实浏览器量「到屏幕」时间与主线程最长阻塞；独立的 Playwright 配置，不在 `pnpm e2e` 里），数字见[规模与性能](./scale.md)。

## 数据流示例：用户编辑一个单元格

1. 键盘/鼠标事件 → `KeyboardHandler` / `CanvasRenderer` 产生动作；
2. UI 生成命令（如 `SetCellText`）→ `cmdManager.execute(cmd)`；
3. 命令写 `store` → `store.subscribe` 广播 `'cell'` 事件；
4. 组件监听到事件 → 把公式同步进 `FormulaEngine` 并触发增量重算；
5. 渲染器收到失效通知，脏区域重绘；
6. `EventBus` 发出 `command:executed`；自动保存随后落盘（最后一次变化 1.5s 后，连续编辑最迟 5s 一次，页面隐藏时立即写入）。

更完整的设计文档见仓库根目录的 [ARCHITECTURE.md](https://github.com/maketwin/web-spreadsheet/blob/master/ARCHITECTURE.md)。
