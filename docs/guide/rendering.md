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
 ├─ FreezeManager          冻结窗格状态
 ├─ BorderPainter          边框绘制
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

## 滚动：blit 快照 + 滚轮支持

`scrollBy(dx, dy)` 是公共滚动 API（滚轮监听调用它；Shift+滚轮横向滚动，
`deltaMode === 1` 的行单位按默认行高换算）。

- 每次完整重绘后，网格层被快照进离屏 `blitCanvas`；
- 纯滚动时平移快照位图，只把**新暴露的条带**标脏重绘；
- **表头两条区域（列头条、行号条）在平移后总是标脏重绘**——表头是钉住的，
  不随位图平移（曾出现「表头跟着滚动」的 bug，即漏标这两条）；
- 冻结窗格激活时不使用 blit（四象限裁剪下平移不成立），自动回退全量重绘。

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
- 常用公共方法：`setSelection` / `setSelectedRange` / `setEditing` / `setFreeze` /
  `setClipboardRange`（蚂蚁线）/ `setHighlightMatches` / `scrollBy` / `cellAtPoint` /
  `rowAtPoint` / `columnAtPoint` / `getCellViewportRect` / `scrollState` / `destroy`。

## 性能基准

`test/perf/renderer-bench.test.ts` 包含渲染与测量的基准用例（AxisIndex 查询、
TextMetricsCache 命中率、大网格绘制帧耗时），随 `npm test` 一起运行。
