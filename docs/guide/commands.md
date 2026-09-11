# 命令与撤销

所有对电子表格的修改都通过**命令模式**完成：每个命令是一个携带参数的对象，`execute(store)` 执行修改，`getUndo()` 返回一个能恢复原状的逆命令。`CommandManager` 维护 undo / redo 两个栈，**全部 22 个命令都可撤销**，且每个命令的撤销路径都有测试覆盖。

## 基本用法

```ts
import { Spreadsheet, SetCellStyleCommand } from 'web-spreadsheet';

const ss = new Spreadsheet('app', { data: [...] });
ss.mount();

// 执行命令
ss.cmdManager.execute(new SetCellStyleCommand(
  { r1: 0, c1: 0, r2: 0, c2: 0 },
  { bold: true },
));

// 撤销 / 重做
ss.cmdManager.undo();
ss.cmdManager.redo();
ss.cmdManager.canUndo(); // boolean
ss.cmdManager.canRedo(); // boolean
```

范围地址统一使用 `RangeAddress`：

```ts
export interface RangeAddress {
  readonly r1: number; readonly c1: number;
  readonly r2: number; readonly c2: number;
}
```

## 命令清单（22 个）

### 内容

| 命令 | 参数 | 对应操作 |
|------|------|----------|
| `SetCellText` | `{ r, c, text }` | 编辑单元格文本 |
| `SetRangeValues` | `{ r1, c1, r2, c2, values }` | 批量写入（粘贴、初始数据） |
| `MoveRange` | `{ source, target }` | 拖拽移动区域 |
| `FillRangeCommand` | `{ ctrlKey?, source, target }` | 填充柄智能填充 |

### 样式与格式

| 命令 | 参数 | 对应操作 |
|------|------|----------|
| `SetCellStyleCommand` | 范围 + `{ style: Partial<Style> }` | 单元格样式 |
| `SetRangeStyleCommand` | 范围 + `{ style }` | 区域样式 |
| `SetRangeBorderCommand` | 范围 + `{ preset, line }` | 区域边框 |
| `SetNumberFormatCommand` | 范围 + `{ numberFormat }` | 数字格式 |

`SetRangeBorderCommand` 的 preset 取值：`'all' | 'outer' | 'inner' | 'none' | 'top' | 'bottom' | 'left' | 'right'`；线型：`'solid' | 'dashed' | 'dotted' | 'thick' | 'none'`。辅助函数 `edgesForPreset(preset, range)` 计算预设覆盖的边。

### 行列结构

| 命令 | 参数 | 对应操作 |
|------|------|----------|
| `InsertRowCommand` | `{ r, count?, position?: 'above'\|'below' }` | 插入行 |
| `InsertColCommand` | `{ c, count?, position?: 'left'\|'right' }` | 插入列 |
| `DeleteRowCommand` | `{ r, count? }` | 删除行 |
| `DeleteColCommand` | `{ c, count? }` | 删除列 |
| `SetRowHeight` | `{ r, height }` | 行高 |
| `SetColWidth` | `{ c, width }` | 列宽 |
| `SetMerge` | `{ range, active }` | 合并 / 取消合并 |

插入/删除行（列）会整体快照受影响区域，公式引用的行号也会相应重映射，保证撤销恢复完整。

### 数据功能

| 命令 | 参数 | 对应操作 |
|------|------|----------|
| `SortRangeCommand` | 范围 + `{ sortCol, direction: 'asc'\|'desc' }` | 排序 |
| `SetAutoFilterCommand` | 范围 + `{ enabled }` | 开关自动筛选 |
| `SetAutoFilterCriteriaCommand` | `{ column, criteria?, mode: 'set'\|'clearColumn'\|'clearAll' }` | 筛选条件 |
| `SetConditionalFormatCommand` | 范围 + `{ rules }` | 条件格式 |
| `SetValidationCommand` | 范围 + `{ rule }` | 数据验证 |
| `CreateChartCommand` | 范围 + `{ type, title? }` | 创建图表 |
| `SetSparklineCommand` | 范围 + `{ type, targetRow, targetCol }` | 迷你图 |

## 撤销栈特性

- undo / redo 栈**没有上限**，不做截断。
- 撤销通过执行逆命令实现（`cmd.getUndo().execute(store)`），因此「撤销公式」连计算结果也会一起恢复。
- 初始数据（构造时传入的 `data` / `sheets`、IndexedDB 恢复）在加载后调用 `cmdManager.clear()`，**不计入撤销历史**——用户不能把初始内容「撤销掉」。
- `getUndoStack()` / `getRedoStack()` 返回 `HistoryEntry[]`（`{ description, index }`），可用于自绘历史面板；`undoToIndex(i)` 可一次回退多步。

## 事件

命令管理器在 `EventBus` 上发布：

| 事件 | payload | 时机 |
|------|---------|------|
| `command:executed` | `{ cmd: Command }` | `execute` 成功后 |
| `command:undone` | `{ cmd: Command }` | `undo` 成功后 |
| `command:redone` | `{ cmd: Command }` | `redo` 成功后 |

```ts
ss.events.on('command:executed', ({ cmd }) => {
  console.log('executed:', cmd.describe());
});
```

::: tip 从包根可用的命令
22 个命令中，以下 11 个从包根导出，可直接 `import { ... } from 'web-spreadsheet'`：

`InsertRowCommand`、`InsertColCommand`、`DeleteRowCommand`、`DeleteColCommand`、`SetCellStyleCommand`、`SetRangeStyleCommand`、`SetRangeBorderCommand`（含 `edgesForPreset`）、`SetConditionalFormatCommand`、`SetValidationCommand`、`CreateChartCommand`、`SetSparklineCommand`。

其余命令（`SetCellText`、`SetRangeValues`、`MoveRange`、`FillRangeCommand`、`SortRangeCommand` 等）目前仅在包内部使用，未导出。
:::

## 自定义命令

```ts
import { Command, setCommand, type Store } from 'web-spreadsheet';
```

方式一：继承 `Command` 基类。

```ts
class MyCommand extends Command<{ r: number; c: number }> {
  public execute(store: Store): void {
    // 修改 store
  }
  public getUndo(): Command {
    // 返回一个能恢复原状的命令对象
  }
  public describe(): string { return 'MyCommand'; }
}
```

方式二：用工厂函数 `setCommand(name, doFn, undoFn)` 从一对函数生成命令类，适合简单修改。

::: warning
`Command` 基类与 `setCommand` 工厂从 `web-spreadsheet/commands` 内部模块提供；若包根未导出，请关注仓库后续版本的导出补充，或暂时在插件里通过 `api.cmdManager.execute()` 复用已有命令。
:::
