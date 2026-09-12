# 架构总览

web-spreadsheet 是一个分层清晰的 TypeScript SDK：上层业务只接触 Facade 与命令，底层用 Canvas 渲染。

```
[User]
   ↓
[Layer 4: API / Facade]      src/components/Spreadsheet.tsx + src/index.ts
   ↓
[Layer 3: Commands]           src/commands/   (22 个命令 + undo/redo)
   ↓
[Layer 2: Store + Formula]    src/store/  src/formula/
[Layer 2b: Event Bus]         src/events/  ←  store.subscribe() 变更事件
   ↓
[Layer 1: Renderer]           src/renderer/  src/components/
```

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
| `src/keys/` | 键盘事件解析 |
| `src/db/` | IndexedDB 自动保存（Dexie） |
| `src/io/` | xlsx 导入导出（SheetJS） |
| `src/plugin/` `src/plugins/` | 插件系统与内置插件 |

## 渲染性能要点

- **虚拟滚动**：`VirtualScroller` 只计算可视区域（默认 1000×26 的画布网格），行高列宽可变；坐标查询由 `AxisIndex` 前缀和索引支撑，O(log n)。
- **双 canvas 分层**：网格层与覆盖层（选区/手柄/拖拽框）分离，高频交互不再触发网格重绘。
- **滚动 blit 缓存**：纯滚动平移上一帧快照，只重绘新暴露条带与钉住的表头区域。
- **文本测量缓存**：`TextMetricsCache`（LRU 5000）消除热路径中的 `measureText` 调用。
- **脏区域重绘**：`DirtyRegionTracker` 合并重绘矩形，避免整画布刷新。
- **缩放**：`zoom` 影响 `defaultRowHeight/ColWidth` 的计算（行高 × zoom）。

完整的渲染层设计见 [渲染层](./rendering.md)。

## 数据流示例：用户编辑一个单元格

1. 键盘/鼠标事件 → `KeyboardHandler` / `CanvasRenderer` 产生动作；
2. UI 生成命令（如 `SetCellText`）→ `cmdManager.execute(cmd)`；
3. 命令写 `store` → `store.subscribe` 广播 `'cell'` 事件；
4. 组件监听到事件 → 把公式同步进 `FormulaEngine` 并触发增量重算；
5. 渲染器收到失效通知，脏区域重绘；
6. `EventBus` 发出 `command:executed`，自动保存计时器重置。

更完整的设计文档见仓库根目录的 [ARCHITECTURE.md](https://github.com/maketwin/web-spreadsheet/blob/master/ARCHITECTURE.md)。
