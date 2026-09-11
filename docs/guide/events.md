# 事件系统

web-spreadsheet 有两条独立的事件通道：**EventBus**（命令级事件、插件事件）和 **Store 订阅**（细粒度数据变更）。

## EventBus

```ts
import { EventBus } from 'web-spreadsheet';

const bus = new EventBus();
const off = bus.on<string>('csv:import', (payload) => { ... });
bus.emit('csv:import', 'a,b\n1,2');
off(); // 退订
```

| 方法 | 签名 | 说明 |
|------|------|------|
| `on` | `<T>(event: string, fn: (payload: T) => void): () => void` | 订阅，返回退订函数 |
| `off` | `<T>(event: string, fn): void` | 按函数引用退订 |
| `emit` | `<T>(event: string, payload?: T): void` | 发布；先通知具名监听，再通知 `'*'` 通配监听 |

通配订阅收到的是包装对象：

```ts
bus.on('*', ({ event, payload }) => {
  console.log('any event:', event, payload);
});
```

### EventBus 上的事件

| 事件名 | payload | 触发时机 |
|--------|---------|----------|
| `command:executed` | `{ cmd: Command }` | 命令执行成功 |
| `command:undone` | `{ cmd: Command }` | 撤销成功 |
| `command:redone` | `{ cmd: Command }` | 重做成功 |
| `csv:import` | 原始 CSV 字符串 | 由使用方 emit，`CsvImportPlugin` 消费 |

实例上直接可用：`ss.events.on(...)`。插件则通过 `PluginAPI.on(event, handler)` 订阅（见[插件开发](/plugins/creating-plugins)）。

::: tip
主题切换事件 `ss:theme-changed` 是 **window 上的 CustomEvent**，不走 EventBus；主题系统内部用，无需关心。见[主题](/guide/theming)。
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

| type | payload 字段 | 触发时机 |
|------|--------------|----------|
| `cell` | `r, c, cell?, sheetId?` | 单元格内容变化 |
| `row` | `r, meta?, sheetId?` | 行高 / 隐藏变化 |
| `col` | `c, meta?, sheetId?` | 列宽 / 隐藏变化 |
| `style` | `id, style?, sheetId?` | 样式表变化 |
| `merge` | `range, sheetId?` | 合并 / 取消合并 |
| `sheet` | `action: 'activate' \| 'add' \| 'rename' \| 'delete', sheetId, name?` | Sheet 增删改名切换 |
| `autofilter` | `sheetId` | 自动筛选状态变化 |

### 批量通知

连续修改会产生大量事件，可用 `batch` 把一批修改合并投递（同格 last-write-wins）：

```ts
store.batch(() => {
  for (let r = 0; r < 100; r++) store.setCell(r, 0, { text: String(r) });
});
// batch 结束后统一投递合并后的少量事件

store.isFlushing();        // 是否正在批量刷新
store.onBatchEnd(fn);      // 注册批量结束回调，返回退订函数
```

排序、插入删除行等内部操作就是靠 batch 保证一次撤销对应一次通知的。

## 渲染回调（内部装配）

画布交互回调（点击、选择变化、行列头点击等）由组件内部装配到 `CanvasRenderer`，不属于 `SpreadsheetOptions`。如果你的场景需要监听选区变化等 UI 事件，当前推荐做法：

- 监听 Store 的 `cell` / `sheet` 事件；
- 监听 `command:executed` 推断用户行为；
- 或fork仓库把需要的回调透传出来——`CanvasRendererOptions` 的回调位（`onCellClick`、`onSelectionChange`、`onFill`、`onMoveRange` 等）都已就绪。
