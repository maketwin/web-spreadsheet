# 渲染层

渲染层位于 `src/renderer/`，以 `CanvasRenderer` 为外观（Facade），对外 API 保持稳定，
内部由若干可独立测试的小模块组成。本文描述当前实现的实际架构（2026-09-12 渲染引擎
改造后），改造背景与验收目标见 [渲染引擎改造计划](../rendering-engine-refactor-plan.md)。

## 模块组成

```
CanvasRenderer（Facade：事件、绘制调度、冻结、交互）
 ├─ VirtualScroller        虚拟滚动（行高/列宽可变，滚动偏移）
 │   └─ AxisIndex ×2       前缀和索引，O(log n) 坐标查询
 ├─ DirtyRegionTracker     脏矩形合并，按需重绘
 ├─ cache/TextMetricsCache measureText LRU 缓存（容量 5000）
 ├─ FreezeManager          冻结窗格状态（src/freeze/）
 ├─ BorderPainter          边框绘制
 ├─ richTextLayout         富文本排版（网格与打印共用的行/段几何）
 ├─ narrowOverflow         溢出判定（数字 ### 填充 / 文本溢入空格）
 ├─ selectionFill          选区填充带（活动格/合并区挖孔）
 ├─ coordinate             画布坐标换算 + 网格常量（转发 util/gridSize）
 ├─ ResizeHandler          行列拖拽调整（冻结感知）
 └─ FillHandle（src/fill/） 填充柄（冻结感知）
```

### AxisIndex（坐标索引）

`src/renderer/AxisIndex.ts`。行/列各持有一个实例，维护「可变尺寸轴」的前缀和：

- `position(index)` → 像素偏移（前缀和），`indexAt(pixel)` → 索引（二分查找），均 O(log n)；
- 尺寸修改后置脏，下次查询时惰性重建前缀和；
- `NaN` 表示「未设置」，回退默认行高/列宽——因此 0 高度的隐藏行与默认尺寸可区分。

VirtualScroller 的全部坐标换算（`cellToPixel`、`rowAtPixel`、`colAtPixel`、
`totalHeight/Width`）都走 AxisIndex，消除了原先「每可见单元格每帧 O(n) 线性累加」
的热路径开销。

### TextMetricsCache（文本测量缓存）

`src/renderer/cache/TextMetricsCache.ts`。`measureText` 是绘制阶段最昂贵的调用之一，
缓存 key 为 `font|text`，LRU 上限 5000 条，服务于单元格文本、自动换行与下划线测量。
`hitRate()` 暴露命中率供测试/诊断（perf 基准中命中率 >99%）。

## 双 canvas 分层

容器内两个绝对定位叠放的 canvas：

- **网格层**（主 canvas）：背景、网格线、单元格文本/样式、边框、表头、条件格式。
  仅在数据/样式/滚动/尺寸变化时重绘。
- **覆盖层**（`.ss-overlay-canvas`，`pointer-events: none`）：选区框、填充柄、
  填充拖拽目标、移动拖拽虚线框、剪贴板蚂蚁线（120ms 步进的流动虚线框，与选中
  范围重合时替换选区实线边框）、查找高亮、resize 指示线。选区等高频交互只重画
  覆盖层，网格层最多重绘表头染色条带。

溢出与富文本（v2.1.0）：数字/日期列宽不足时显示 `###` 填充（`narrowOverflow`），
文本与公式结果溢入相邻空格；富文本格按 run 拆段绘制，行内几何由
`richTextLayout` 计算，与打印绘制共用同一实现，保证所见即所印。

## 滚动：blit 快照 + 滚轮支持

`scrollBy(dx, dy)` 是公共滚动 API（滚轮监听调用它；Shift+滚轮横向滚动，
`deltaMode === 1` 的行单位按默认行高换算）。触摸手势复用同一管线：单指平移
换算成滚动偏移，双指捏合经 `onZoomTo` 走与 `Ctrl`+滚轮相同的缩放路径（v2.2.0）。
软键盘弹出时 `scrollCellIntoView(r, c, visibleHeight)` 以缩小的可视高度把编辑格
滚入视口（`visualViewport` 驱动，桌面无该 API 时不生效）。

- 每次完整重绘后，网格层被快照进离屏 `blitCanvas`；
- 纯滚动时平移快照位图，只把**新暴露的条带**标脏重绘；
- **表头两条区域（列头条、行号条）在平移后总是标脏重绘**——表头是钉住的，
  不随位图平移（曾出现「表头跟着滚动」的 bug，即漏标这两条）；
- 冻结窗格激活时不使用 blit（四象限裁剪下平移不成立），自动回退全量重绘。

## 每个工作表各记各的视图与选区（v2.2.0）

视图和选区都按工作表保存（`CanvasRenderer.switchViewTo`，外壳的
`useSheetSelection`），与 Excel 一致：切走的那张表记住自己的滚动位置、当时的缩放
和选区，切回来的表回到上次的状态；没滚动过的表从左上角开始，没选过格的表活动格
在 A1。之前所有表共用一个滚动位置和一个选区——第一张表翻到底部后切到第二张，
第二张也从底部打开，活动格还是第一张表里的坐标。

- **位置按行/列而不是像素记忆**：记下当时的缩放，回来时按现在的缩放换算，
  中途改过缩放也落在原来那一行；
- **回来时视图优先**：切换后的第一次选区同步不滚动。用滚轮离开活动格再切走、
  切回，停下的位置不变，活动格可能在屏幕外（Excel 也是如此）；
- **对活动格操作时它才回到可视区**：打字或 F2 开始编辑、方向键移动、名称框与
  查找跳转、超链接进入某张表，都会把目标格滚进来（`revealCell`、
  `setSelection(…, reveal)`），冻结窗格下同样成立；
- 切换后视图会按新表的冻结窗格重新套用一次（窗格数变了会先回到冻结角），这一次
  不会冲掉刚恢复的位置（恢复后的 200 ms 内）；用户一滚动或之后自己改窗格，照常
  从冻结角开始；
- 工作簿被整体替换（打开另一个文件）时清空记忆、从左上角和 A1 开始；删除工作表
  时丢掉它的记忆；Ctrl+点击加出的附加选区不跨表保留；
- 视图与选区只在内存里，不随工作簿保存：刷新页面后从左上角和 A1 开始。

## 冻结窗格：四象限模型

冻结采用 Excel 四象限模型，每个象限是一个 `PaintQuad`（单元格范围 + 裁剪矩形）：

- `cellVP(r, c)` 是唯一的坐标入口：冻结单元格免滚动偏移，滚动区单元格沿用
  全轴滚动公式；背景/网格线/边框/文本全部按象限裁剪绘制；
- 表头始终绘制冻结行/列的标签；
- 命中测试与交互全部冻结感知：`pointerCell` / `rowAtPoint` / `columnAtPoint`，
  以及通过回调注入的 `ResizeHandler`（`rowTopAt` / `colLeftAt` / `frozenRows` /
  `frozenCols`）和 `FillHandle`（`cellVP` / `cellAtPoint`）。两个处理器在没有
  注入时回退到旧的纯滚动坐标，可独立测试；
- 移动拖拽的目标位置被钳制在冻结线之外（防止把冻结表头拖走或覆盖），
  拖回源位置视为无操作，不会触发 `MoveRange`。

## 帧调度与公共 API

- 所有失效走 `invalidateAll()` / 脏矩形 → `requestAnimationFrame` 合并到下一帧；
- 常用公共方法：`setSelection` / `setSelectedRange` / `setExtraRanges`（多选区域的
  附加选区，照主选区着色但不画活动单元格与填充柄）/ `setEditing` / `setFreeze` /
  `setClipboardRange`（蚂蚁线）/ `setHighlightMatches` / `scrollBy` / `cellAtPoint` /
  `rowAtPoint` / `columnAtPoint` / `getCellViewportRect` / `scrollState` / `destroy`。
  `setSelection(range, kind, activeCell, reveal)` 的第 4 个参数为 true 表示这是一次
  跳转，目标格要滚进可视区；`revealCell(r, c)` 单独做这一件事。

## 性能基准

`test/perf/renderer-bench.test.ts` 包含渲染与测量的基准用例（AxisIndex 查询、
TextMetricsCache 命中率、大网格绘制帧耗时），随 `npm test` 一起运行。

### 选区染色走表头快速路径

选区变化只给行头 / 列头染色：落在表头条带内的脏矩形走快速路径（只画表头与
冻结分隔线，不再跑整条单元格绘制管线），只有表头被重画的那一帧也不再把整张
网格复制进滚动缓存；`setExtraRanges` 在范围与当前相同时不做任何事（普通点击
「清空」本来就越界的多选区不再作废整张画布），状态栏的已填单元格数按
(store, 活动表, `store.revision`) 记忆、选区变化不再扫描全表。满表带样式场景下
实测（当时的默认网格 1000×26，改造验收时的数据）：每次点击的画布重绘
3.75 ms → 0.68 ms，120 Hz 屏上帧间隔最大值 33 ms → 16.8 ms（不掉帧，像素级
校验和与改前逐项相等）。

### 有效样式的帧级缓存

网格扩大到 Excel 地址空间（1,048,576 × 16,384）后，单元格样式多数时候来自
列/行默认（见[格式化](/guide/formatting)的「列/行默认样式」）。绘制路径统一走
`CanvasRenderer.cellStyle(r, c)`（`src/renderer/CanvasRenderer.ts`）：按
「格子自有 > 行默认 > 列默认」解析有效样式，结果以 `r * TOTAL_COLS + c` 为键
按帧缓存（行/列默认各有独立缓存，未设置尺寸的轴同样命中），因此可视区域里
每个格子每帧最多解析一次——绘制成本只随可视格子数走，与网格大小和已存储
单元格数无关。
