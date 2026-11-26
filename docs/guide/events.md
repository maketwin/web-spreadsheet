# 事件系统

web-spreadsheet 有两条独立的事件通道：**EventBus**（命令级事件、插件事件）和 **Store 订阅**（细粒度数据变更）。

## EventBus

事件总线是**类型化**的：`EventBus<TEvents extends object = SpreadsheetEvents>`，内置事件表 `SpreadsheetEvents` 描述了内置事件名（`command:*` 系列、`csv:import`）的精确载荷，`on` 对已知事件名给出精确的 handler 载荷类型，其它（插件自定义）事件名允许订阅、载荷保持 `unknown`：

```ts
import { EventBus } from 'web-spreadsheet';

const bus = new EventBus();
// payload 被推断为 string（csv:import 在 SpreadsheetEvents 里的形状）
const off = bus.on('csv:import', (payload) => { ... });
bus.emit('csv:import', 'a,b\n1,2');
// 自定义事件名：payload 类型为 unknown，可显式标注
bus.on('my-plugin:event', (payload) => { ... });
off(); // 退订
```

| 方法 | 签名 | 说明 |
|------|------|------|
| `on` | `<K extends string>(event: K, fn: (payload: EventPayload<K, TEvents>) => void): () => void` | 订阅；已知事件名载荷类型精确（`EventPayload<K, TEvents>`，未知名字落到 `unknown`），返回退订函数，**只退役这一条订阅**——同一函数订阅两次得到两个独立退订，各删各的 |
| `off` | `<K extends string>(event: K, fn): void` | 按函数引用退订**最早**的一个匹配订阅（同一函数订阅多次时一次 `off` 只移除最早的那个）；要精确退订请用 `on` 返回的退订函数 |
| `emit` | `<T>(event: string, payload?: T): void` | 发布；先通知具名监听，再通知 `'*'` 通配监听（`emit` 保持宽松：任何事件名、任何载荷都能发） |

`SpreadsheetEvents` 与 `EventPayload` 类型均从两个包入口导出。运行时行为与类型化之前完全一致。

监听器抛异常不会中断发布方或其他监听器：每个监听器单独执行，出错只打日志（`console.error`），分发继续——包括通配监听那一遍。

通配订阅收到的是包装对象：

```ts
bus.on('*', ({ event, payload }) => {
  console.log('any event:', event, payload);
});
```

### EventBus 上的事件

内置事件表 `SpreadsheetEvents` 的全部成员：

| 事件名 | payload | 触发时机 |
|--------|---------|----------|
| `command:executing` | `{ cmd: Command }` | 命令即将执行（写 store 之前） |
| `command:executed` | `{ cmd: Command }` | 命令执行成功 |
| `command:undoing` | `{ cmd: Command }` | 命令即将撤销 |
| `command:undone` | `{ cmd: Command }` | 撤销成功 |
| `command:redoing` | `{ cmd: Command }` | 命令即将重做 |
| `command:redone` | `{ cmd: Command }` | 重做成功 |
| `command:rejected` | `{ reason: 'protected' }` | 命令被工作表保护拦下，没有执行 |
| `command:failed` | `{ cmd, phase: 'execute' \| 'undo' \| 'redo', error }` | 命令抛出异常：没有进入历史；撤销失败的条目会被丢弃并继续撤销上一条。对应的 `…ed` 事件不会再发 |
| `csv:import` | 原始 CSV 字符串 | 由使用方 emit，`CsvImportPlugin` 消费 |

实例上直接可用：`ss.events.on(...)`。插件则通过 `PluginAPI.on(event, handler)` 订阅（见[插件开发](/plugins/creating-plugins)）。

::: tip
主题切换事件 `ss:theme-changed` 是 **window 上的 Event**，不走 EventBus；公共的 `setTheme()` / `applyStoredTheme()` 自己会派发它，画布据此重绘。见[主题](/guide/theming)。
:::

## Store 订阅（数据变更）

Store 的事件粒度更细，每次数据变化都会广播：

```ts
const off = ss.store.subscribe((e) => {
  switch (e.type) {
    case 'cell':  console.log(e.r, e.c, e.cell); break;
    case 'sheet': console.log(e.action, e.sheetId); break;
    // ...
  }
});
```

### StoreEvent 类型一览

功能级变化各自有独立的事件类型（早期版本曾伪装成带 id 前缀的 `style` 事件，v2.2.0 起拆开）：

| type | payload 字段 | 触发时机 |
|------|--------------|----------|
| `cell` | `r, c, cell?, sheetId?` | 单元格内容变化 |
| `cells` | `keys: readonly number[], sheetId?` | 一批格子被整块改写（撤销把被删格子放回等）：`keys` 是 `r * TOTAL_COLS + c` 数值键，指向具名 sheet；一个事件代替逐格 `cell` 事件 |
| `structure` | `axis: 'row' \| 'col', kind: 'insert' \| 'delete', start, count, sheetId?` | 插入 / 删除了整行 / 整列：`start` 之后的半平面整体搬移一次完成。每个结构命令只发**一个**，随行移动的单元格内容不再逐格发 `cell` 事件；事件到达时 store 已是最终状态 |
| `row` | `r, meta?, sheetId?` | 行高 / 隐藏 / 行默认样式变化 |
| `col` | `c, meta?, sheetId?` | 列宽 / 隐藏 / 列默认样式变化 |
| `style` | `id, style?, sheetId?` | 真正的单元格样式变化（`setStyle`；轴默认样式也经它写入，id 为保留前缀 `colstyle-*` / `rowstyle-*`） |
| `merge` | `range, sheetId?` | 合并 / 取消合并 |
| `sheet` | `action: 'activate' \| 'add' \| 'rename' \| 'move' \| 'recolor' \| 'delete', sheetId, name?` | Sheet 增删、改名、**移动（`move`）**、**改标签颜色（`recolor`）**与切换 |
| `autofilter` | `sheetId` | 自动筛选状态变化 |
| `workbook` | `action: 'replace'` | 整个工作簿被替换（新建 / 打开 / 恢复），先于随后的 `sheet` 事件投递 |
| `conditionalRules` | `range, sheetId?` | 条件格式规则变化（`setConditionalRule` / `removeConditionalRule`） |
| `charts` | `id, sheetId?` | 浮动图表增删（`id` 为图表 spec id） |
| `images` | `id, sheetId?` | 浮动图片增删 |
| `sparklines` | `id, sheetId?` | 迷你图增删 |
| `validations` | `range, sheetId?` | 数据验证规则变化（`setValidationRule` / `removeValidationRule`） |
| `namedRanges` | `name, sheetId?` | 命名区域定义 / 删除（`name` 为定义名） |
| `rowGroups` | `sheetId?` | 行分组大纲变化（无逐变身份，按序投递） |
| `freeze` | `sheetId?` | 冻结窗格变化（按序投递） |
| `protection` | `sheetId?` | 工作表保护状态变化（按序投递） |
| `workbookPassword` | — | 工作簿级密码变化（工作簿级，无 `sheetId`） |

### 批量通知

连续修改会产生大量事件，可用 `batch` 把一批修改合并投递：带身份的事件（`cell` / `row` / `col` / `style` / `merge` 与上面带 `range` / `id` / `name` 的功能事件）按「类型 + 表 + 身份」合并，同身份 last-write-wins；`structure` / `cells` 以及 `rowGroups` / `freeze` / `protection` / `workbookPassword` 没有身份，每次写入都按序投递：

```ts
store.batch(() => {
  for (let r = 0; r < 100; r++) store.setCell(r, 0, { text: String(r) });
});
// batch 结束后统一投递合并后的少量事件

store.isFlushing();        // 是否正在批量刷新
store.onBatchEnd(fn);      // 注册批量结束回调，返回退订函数
```

排序、插入删除行等内部操作就是靠 batch 保证一次撤销对应一次通知的。

### 大批量写入：`replaceAll` 与结构事件的迁移说明

`store.replaceAll(data)`（文件导入 / 恢复）**不再逐格发 `cell` 事件**：只发一个 `workbook replace`，随后是消失表的 `sheet delete`、新表的 `sheet add` 和 `sheet activate`。宿主如果靠逐格 `cell` 事件跟踪导入进来的内容，应改为处理 `workbook` / `sheet` 事件、从最终状态重建（`batch` 结束时 store 已是完整新工作簿）。百万格导入因此不再分配百万个事件对象。

类似地，插入/删除行列（`Store.insertRows` / `insertCols` / `deleteRows` / `deleteCols`）只发一个 `structure` 事件，批量改写走 `bulkSetCells(entries, sheetId?)`（一个 `cells` 事件），整批取出走 `takeCellsInRect(rect, sheetId?)`——选中整列按 Delete 走的就是它：一次扫描、一个 `cells` 事件，撤销用 `bulkSetCells` 一次放回。需要维护「按位置」的状态（公式登记、图表锚点、自定义缓存等）的订阅者应改订阅 `structure`：事件携带 `axis` / `kind` / `start` / `count`，到达时按最终状态整体重建即可，不必再逐格搬移自己的数据；`cells` 的订阅者用 `keys` 定点失效缓存（键很多时按外接矩形失效更划算：内置的公式同步对超过 256 个键的批次就是这么做的）。

## 渲染回调（内部装配）

画布交互回调（点击、选择变化、行列头点击等）由组件内部装配到 `CanvasRenderer`，不属于 `SpreadsheetOptions`。如果你的场景需要监听选区变化等 UI 事件，当前推荐做法：

- 监听 Store 的 `cell` / `sheet` 事件；
- 监听 `command:executed` 推断用户行为；
- 或fork仓库把需要的回调透传出来——`CanvasRendererOptions` 的回调位（`onCellClick`、`onSelectionChange`、`onFill`、`onMoveRange` 等）都已就绪。
