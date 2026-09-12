# 渲染引擎改造计划：Canvas 2D + 场景图 + 分层 + 缓存（Univer 模式）

> 状态：P1/P2/P4 已实施（2026-09-12），P3 场景图化暂缓 · 用户已确认允许破坏性变更
> 目标：在不更换渲染 API 的前提下，将渲染层重构为「场景图 + 多 canvas 分层 + 多级缓存」架构，对齐 Univer engine-render 的核心思路。

## 1. 背景与目标

现状：`CanvasRenderer.ts`（973 行）为单 canvas 单帧全量绘制，已具备
VirtualScroller / DirtyRegionTracker / FreezeManager。主要瓶颈：

- 滚动时整帧重绘（网格、文本、边框全部重画）
- `measureText` 无缓存（绘制阶段调用，通常占 30%+ 耗时）
- 选区/填充手柄/拖拽等高频交互变化会触发全网格重绘
- 绘制逻辑与命中测试、事件处理耦合在一个类中

目标（可量化验收）：

| 指标 | 现状基线 | 目标 |
|---|---|---|
| 滚动帧耗时（1 万行 × 50 列） | 待测 | < 8ms/帧（>60fps 预算一半） |
| 选区变化帧耗时 | 待测 | < 2ms（只重画交互层） |
| measureText 调用次数/帧 | 每个可见单元格 ≥1 次 | 命中率 > 95% 后 ≈ 0 |
| API 兼容性 | — | `CanvasRendererOptions` 外部接口不破坏 |

## 2. 总体架构

```
┌─────────────────────────────────────────────┐
│ CanvasRenderer（外观/Facade，保持现有 API）    │
├─────────────────────────────────────────────┤
│ RenderEngine                                 │
│  ├─ Scene（场景图根）                          │
│  │   ├─ GridLayer    (canvas 0, 静态)         │
│  │   │    └─ RenderObject: GridLines/Cells/   │
│  │   │       Borders/Headers/ConditionalFmt   │
│  │   └─ OverlayLayer (canvas 1, 动态)         │
│  │        └─ RenderObject: Selection/         │
│  │           FillHandle/MoveDrag/Highlights   │
│  ├─ RenderLoop（rAF 调度 + 脏对象收集）         │
│  └─ CacheService                             │
│       ├─ TextMetricsCache (LRU: font|text)    │
│       ├─ RowBitmapCache   (离屏行位图)         │
│       └─ ThemeCache（已有，迁移）               │
├─────────────────────────────────────────────┤
│ 保留不动：VirtualScroller / DirtyRegionTracker│
│ / BorderPainter / FreezeManager / ResizeHandler│
└─────────────────────────────────────────────┘
```

设计要点：

1. **场景图（轻量版）**：`RenderObject { bounds, dirty, paint(ctx), hitTest?(p) }`，
   树形组织；dirty 沿树上冒泡。不做完整 Univer 那种引擎，只取
   「绘制对象化 + 脏标记冒泡」两个核心。
2. **分层**：容器内两个绝对定位 canvas 叠放。GridLayer 只在数据/样式/滚动/
   尺寸变化时重绘；OverlayLayer 在选区/拖拽/手柄变化时重绘。选区交互从
   「全帧重绘」降为「只画选区框」。
3. **文本测量缓存**：key = `${font}|${text}`，LRU 上限 5000；并服务
   自动换行（wrapText）与列宽自适应。
4. **行位图缓存**：GridLayer 内部按「可视行」渲染到离屏 canvas，
   滚动时未变化行直接 `drawImage`，仅新入行走完整绘制。冻结区行独立缓存。
5. **重绘策略**：RenderLoop 收集本帧脏对象 → GridLayer 有脏才重绘 →
   OverlayLayer 独立判断。滚动中可选降级（跳过单元格重排，滚停补全帧）。

## 3. 实施阶段（每阶段可独立交付、独立测试）

- **P1 基础设施**：RenderObject 接口 + RenderLoop + TextMetricsCache。
  收益：文本缓存立竿见影。风险：低。
- **P2 双层 canvas 拆分**：Overlay（选区/填充手柄/拖拽/查找高亮）移入
  第二层。收益：交互帧耗时骤降。风险：中（层级/透明度/冻结区分割需对齐）。
- **P3 GridLayer 场景图化**：把网格线/单元格/边框/表头拆为 RenderObject，
  接入脏冒泡。收益：局部编辑只重绘脏对象。风险：中。
- **P4 行位图缓存 + 滚动降级**：收益：滚动流畅度。风险：中高
  （内存占用需加 LRU + 容量上限，DPR/缩放变化要全量失效）。

## 4. 文件规划

新增：
- `src/renderer/scene/RenderObject.ts` — 基类与脏冒泡
- `src/renderer/scene/RenderLoop.ts` — rAF 调度
- `src/renderer/layers/GridLayer.ts` / `OverlayLayer.ts`
- `src/renderer/scene/objects/*` — GridLinesObject、CellsObject、
  BordersObject、HeadersObject、SelectionObject、FillHandleObject 等
- `src/renderer/cache/TextMetricsCache.ts` / `RowBitmapCache.ts`

改造：
- `src/renderer/CanvasRenderer.ts` — 瘦身为 Facade（事件绑定、API 转发），
  预计从 973 行降到 < 400 行
- `test/renderer/` — 新增各对象单测 + 分层渲染测试
- `test/perf/` — 新增滚动帧耗时、选区帧耗时基准

不改动：VirtualScroller、DirtyRegionTracker、BorderPainter、FreezeManager、
ResizeHandler、对外 options 接口。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 双层 canvas 在冻结窗格下叠放错位 | 层各自按同一坐标系绘制，冻结分割线两层都画；截图对比测试 |
| 行位图缓存内存膨胀 | LRU + 容量上限（如 200 行），resize/zoom/DPR 变化全量失效 |
| 编辑器 DOM 对齐依赖坐标计算 | cellToPixel 逻辑不动，编辑器定位走现有 getCellViewportRect |
| 回归 | 每阶段完成后跑全量 vitest + 现有 perf 基准；P2 后加渲染截图对比 |

## 6. 验收清单

- [ ] 全部现有测试通过，新增测试覆盖新模块
- [ ] perf 基准达到第 1 节目标
- [ ] demo 中冻结 + 选区 + 填充 + 拖拽移动 + 条件格式行为与现状一致
- [ ] `CanvasRendererOptions` 无破坏性变更

## 7. 实施记录（2026-09-12）

已完成（全部 442 测试 + 新增 perf 基准通过，lint/typecheck 干净，demo 截图验证）：

1. **AxisIndex（O(log n) 坐标索引）**：`src/renderer/AxisIndex.ts`，前缀和 + 二分，
   VirtualScroller 全面切换；消除热路径 O(n) 线性扫描（原 cellToPixel 每单元格每帧 O(n)）。
2. **TextMetricsCache**：`src/renderer/cache/TextMetricsCache.ts`，LRU 5000，
   接入自动换行与下划线测量（perf 测试：2000 次测量仅 11 次真实调用，命中率 >99%）。
3. **双层 canvas**：overlay canvas 承载选区/填充手柄/拖拽移动/查找高亮/resize 指示线；
   选区变化网格层只重绘表头染色条带。
4. **滚动 blit 缓存 + 滚轮支持**：新增 `scrollBy(dx, dy)` 公共 API 与 wheel 监听
   （Shift+wheel 横向，deltaMode 行单位换算）；纯滚动时平移上一帧位图，
   只重绘新暴露条带；冻结窗格激活时自动回退全量重绘。

与计划的偏差：P3「每单元格 RenderObject 场景图」未实施——对象 churn 反而增加 GC
压力，对性能无益；保留了「绘制阶段对象化 + 脏矩形」方案，这也是 Univer 实际的
热路径做法（场景图只到 layer/skeleton 级）。行位图缓存被 blit 全帧快照取代，
效果等价且实现更简单。

5. **冻结窗格象限化重做（2026-09-12 修复）**：原实现「滚动画完后用无滚动坐标补画
   冻结条带」存在系统性缺陷：条带沿滚动轴坐标错位（横向滚动后冻结行条带错乱、
   纵向滚动后冻结列条带空白）、冻结行列的表头标签滚动后消失、命中测试/选区/编辑器
   定位完全无视冻结区（点击冻结单元格会选中滚动区单元格）、ensureCellVisible
   会把滚动拉回原点。重做为 Excel 四象限模型：`cellVP` 对冻结单元格免滚动偏移、
   滚动单元格沿用全轴滚动公式并按象限裁剪（`PaintQuad`）；绘制管线（背景/网格线/
   边框/文本）全部按象限执行；表头始终绘制冻结行列标签；`pointerCell`/`rowAtPoint`/
   `columnAtPoint`/ResizeHandler/FillHandle 均注入冻结感知坐标。

6. **移动操作的冻结边界约束（2026-09-12 修复）**：移动此前可以跨越冻结线——把冻结
   行/列的内容（如表头）拖走后源被清空、或把空单元格拖进冻结区覆盖表头，冻结条带
   即「变空白」。Excel 不允许跨冻结边界移动：`moveTargetFromPointer` 现按轴把目标
   钳制在源所在区域（冻结带内或滚动区内），跨骑冻结线的选区锚定不动（移动禁用）。
   同时修复拖回原地释放会触发 `MoveRange`（先写回再清空源）导致选区数据被抹掉的
   bug——`handleMouseUp` 仅在目标 ≠ 源锚点时触发移动。

7. **blit 滚动表头钉住修复（2026-09-12 修复）**：blit 平移会把表头随位图一起移走，
   而暴露条带的脏矩形不含表头区域，导致「不冻结时列头 ABC/行号跟着滚动」。修复为
   `scrollBy` 在平移后总是额外标脏列头与行号两条区域（`paintRegion` 每次都会重画
   表头）。另修复测试遗留的未使用变量导致的 `tsc --noEmit` 构建失败。
