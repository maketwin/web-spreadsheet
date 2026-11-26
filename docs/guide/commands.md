# 命令与撤销

所有对电子表格的修改都通过**命令模式**完成：每个命令是一个携带参数的对象，`execute(store)` 执行修改，`getUndo()` 返回一个能恢复原状的逆命令。`CommandManager` 维护 undo / redo 两个栈，**全部 42 个命令都可撤销**，且每个命令的撤销路径都有测试覆盖。

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

// 程序化执行（时间线回放、导入、迁移）：同样的 store 批处理与异常边界，
// 但不进撤销栈、不发 command:* 事件、不做保护检查
const ok = ss.cmdManager.execute(new InsertRowCommand({ r: 3 }), { record: false });

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

## 命令清单（42 个）

### 内容

| 命令 | 参数 | 对应操作 |
|------|------|----------|
| `SetCellText` | `{ r, c, text }` | 编辑单元格文本 |
| `SetRangeValues` | `{ r1, c1, r2, c2, values }` | 批量写入（粘贴、初始数据） |
| `MoveRange` | `{ source, target }` | 拖拽移动区域 |
| `FillRangeCommand` | `{ ctrlKey?, source, target }` | 填充柄智能填充 |
| `SetHyperlinkCommand` | `{ r, c, hyperlink?, displayText? }` | 设置 / 清除超链接 |
| `SetCellCommentCommand` | `{ r, c, comment? }` | 设置 / 清除批注（数据层与 xlsx 往返，暂无 UI 入口） |
| `ImportCellsCommand` | `{ cells: [r, c, Cell][] }` | 整格导入（会话粘贴底层写入路径） |
| `CompositeCommand` | `commands: Command[]` | 把多个命令并成一个撤销单元（多重选区 Delete、剪切粘贴的「粘贴 + 清源」等） |

### 样式与格式

| 命令 | 参数 | 对应操作 |
|------|------|----------|
| `SetCellStyleCommand` | 范围 + `{ style: Partial<Style> }` | 单元格样式 |
| `SetRangeStyleCommand` | 范围 + `{ style }` | 区域样式（整列/整行/整表选区自动转为轴默认样式写，见下文） |
| `SetAxisStyleCommand` | `{ axis, from, to, style: StylePatch, sheetId? }` | 写列/行默认样式（整列/整行格式化的底层命令，已导出） |
| `ClearAxisStyleCommand` | `{ axis, from, to, sheetId? }` | 清除列/行默认样式（已导出） |
| `SetRangeBorderCommand` | 范围 + `{ preset, line }` | 区域边框（整列/整行选区写轴默认边框） |
| `SetNumberFormatCommand` | 范围 + `{ numberFormat }` | 数字格式（整列/整行选区写轴默认数字格式） |
| `ApplyTableStyleCommand` | `{ r1, c1, r2, c2, preset }` | 套用表格样式预设 |

`SetRangeBorderCommand` 的 preset 取值：`'all' | 'outer' | 'inner' | 'none' | 'top' | 'bottom' | 'left' | 'right'`；线型：`'solid' | 'dashed' | 'dotted' | 'thick' | 'none'`。辅助函数 `edgesForPreset(preset, range)` 计算预设覆盖的边。

### 有效范围与逐格命令

样式、数字格式、边框、表格样式、清空、分列、隐藏行这类**逐格命令**共享同一条范围收缩规则（`src/commands/impl/effectiveRange.ts`）：

1. 选区面积 ≤ 25 万（`MAX_MATERIALIZED_CELLS`）→ 按选区原样处理，空白格也处理（小选区语义与以前完全一致）；
2. 超过 → 先经 `Store.limitToData` 并到已用范围（200 行的表上选整列只处理 200 格）；
3. 已用范围内仍超过 → 只处理**已存储的格子**（`forEachCellInRect`），不为空白格创建存储。

选区与数据完全不相交的样式命令会回落到选区首格落一个锚点（`limitToData` 语义）。清空类命令不留幽灵格：空且无样式的格子从存储里移除而不是留下 `{ text: '' }`，带样式的空格保留（按 Delete、清除内容、粘贴空白、剪切之后同理）。

整列/整行/整表选区的样式命令（`SetRangeStyleCommand` / `SetNumberFormatCommand` / `SetRangeBorderCommand`）在 `execute` 开头用 `axisSelectionOf` 判定后委托给 `SetAxisStyleCommand` 写**列/行默认样式**——调用方（工具栏、菜单、格式刷）不需要任何改动，语义见[格式化](/guide/formatting)的「列/行默认样式」。

### 行列结构

| 命令 | 参数 | 对应操作 |
|------|------|----------|
| `InsertRowCommand` | `{ r, count?, position?: 'above'\|'below' }` | 插入行 |
| `InsertColCommand` | `{ c, count?, position?: 'left'\|'right' }` | 插入列 |
| `DeleteRowCommand` | `{ r, count? }` | 删除行 |
| `DeleteColCommand` | `{ c, count? }` | 删除列 |
| `SetRowHeight` | `{ r, height }` | 行高 |
| `AutoRowHeightsCommand` | `{ r1, c1, r2, c2 }` | 按内容自动调整行高（字号 / 换行变更时与样式命令并为一步撤销） |
| `SetColWidth` | `{ c, width }` | 列宽 |
| `SetMerge` | `{ range, active }` | 合并 / 取消合并 |
| `SetMergeAcross` | `{ range }` | 跨越合并（选区每行独立合并） |
| `ApplyMergeChanges` | `{ add, remove, sheetId? }` | 结构性合并增删（粘贴路径；值的写入由同一撤销单元里的 `SetRangeValues` 负责） |
| `SetRowsHiddenCommand` | `{ r1, r2, hidden }` | 隐藏 / 取消隐藏行（含一键取消全部隐藏） |
| `SetColsHiddenCommand` | `{ c1, c2, hidden }` | 隐藏 / 取消隐藏列 |

插入/删除行（列）现在走 `Store.insertRows` / `insertCols` / `deleteRows` / `deleteCols` **整体搬移原语**：受影响的半平面按存储键一次移完（溢出阴影格丢弃，由锚点重新溢出），整条命令只发**一个** `structure` 事件；行/列元数据、合并、公式改写和特性平移仍由命令自己负责。撤销不再保留整带快照——只保留被删的格子、文本被改写的公式、特性和元数据带，百万格表上的插行/删行及其撤销都在亚秒级完成（`RemoveDuplicatesCommand` 走同一套原语：只让有存储格的行参与，连续删除的行合并成整段搬移）。

### 数据功能

| 命令 | 参数 | 对应操作 |
|------|------|----------|
| `SortRangeCommand` | 范围 + `{ sortCol, direction: 'asc'\|'desc' }` | 排序 |
| `SetAutoFilterCommand` | 范围 + `{ enabled }` | 开关自动筛选 |
| `SetAutoFilterCriteriaCommand` | `{ column, criteria?, mode: 'set'\|'clearColumn'\|'clearAll' }` | 筛选条件 |
| `SetConditionalFormatCommand` | 范围 + `{ rules }` | 条件格式 |
| `SetSheetConditionalRulesCommand` | `{ entries }` | 整表条件格式规则集（管理器批量增删） |
| `SetValidationCommand` | 范围 + `{ rule }` | 数据验证 |
| `SetSparklineCommand` | 范围 + `{ type, targetRow, targetCol }` | 迷你图 |
| `TextToColumnsCommand` | `{ r1, c1, r2, options }` | 分列（分隔符模式） |
| `RemoveDuplicatesCommand` | `{ r1, c1, r2, c2, columns }` | 按列删除重复项 |

### 图表与浮动对象

| 命令 | 参数 | 对应操作 |
|------|------|----------|
| `CreateChartCommand` | 范围 + `{ type, title?, anchor? }` | 创建浮动图表对象 |
| `RemoveChartCommand` | `{ id }` | 删除浮动图表 |
| `SetChartAnchorCommand` | `{ id, anchor }` | 移动 / 缩放浮动图表 |
| `AddImageCommand` | `{ spec: ImageSpec }` | 插入浮动图片对象 |
| `RemoveImageCommand` | `{ id }` | 删除浮动图片 |
| `SetImageAnchorCommand` | `{ id, anchor }` | 移动 / 缩放浮动图片 |

## 撤销栈特性

- undo / redo 栈有上限（`MAX_HISTORY = 100` 条，与 Excel 一致），超出时丢弃最旧的记录。
- **撤销历史还有内存预算**：除步数外，`CommandManager` 按命令保留的单元格数（`Command.historyWeight()`，基类默认 0，各命令只统计自己实际保留的撤销载荷）计，上限 `MAX_HISTORY_RETAINED_CELLS = 2,000,000`（已导出）——超预算时从撤销栈**最旧**的一步开始淘汰，始终保留最新一步；`CommandManager.historyWeight()` 返回当前保留数，供调试/测试。
- **无操作命令不进历史**：命令可重写 `isNoOp()`，`execute` 后若未产生任何变化（如对无合并区域「取消合并」、单列「跨越合并」），`CommandManager` 不压栈、不更新 F4 重复源——对齐 Excel「没变化的操作不可撤销」。
- 撤销通过执行逆命令实现（`cmd.getUndo().execute(store)`），因此「撤销公式」连计算结果也会一起恢复。
- 初始数据（构造时传入的 `data` / `sheets`、IndexedDB 恢复）在加载后调用 `cmdManager.clear()`，**不计入撤销历史**——用户不能把初始内容「撤销掉」。
- `getUndoStack()` / `getRedoStack()` 返回 `HistoryEntry[]`（`{ description, index }`），可用于自绘历史面板；`undoToIndex(i)` 可一次回退多步。
- **程序化执行不进历史**：`execute(cmd, options?)` 现在返回 `boolean`（默认 `record: true` 即普通用户编辑路径——命令体跑完为 `true`，被工作表保护拒绝或抛异常为 `false`）。`{ record: false }` 把命令当作程序化编辑（时间线回放、导入、迁移）应用：同样的 store 批处理与异常边界，但不进撤销栈、不清重做栈、不更新 F4 重复源、不发任何 `command:*` 事件、工作表保护检查不适用。

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

## 命令标识与回放

每个命令类都覆写 `kind()`，返回**压缩后不变的稳定身份**（类名在压缩构建后不可靠，`CompositeCommand` 返回 `null`）；`args` 是 public readonly，工具可以按类型采样而无需导入命令类。这些名字会进入持久化格式（模拟平台的时间线与复现包），**只能新增、不能改名**。

其中 **31 种**命令在回放白名单里（`src/commands/replayRegistry.ts`）：凭记录的参数（kind + args）即可安全重建——覆盖单元格编辑、行列结构、样式/边框/数字格式、轴样式（`setAxisStyle` / `clearAxisStyle`）、合并、验证、条件格式、超链接、批注、移动/填充/排序/去重/分列、自动筛选与表格样式；图表 / 图片 / 迷你图命令引用执行期生成的对象 id、整块值命令载荷过大，有意不进白名单。时间线里这批命令以 `{ kind: 'command', command, args }` 载荷持久化（参数不是纯数据时不带载荷）；回放遇到未知命令名会计入 skipped 继续执行。导出的 `isReplayableKind` / `buildReplayableCommand` / `REPLAYABLE_KINDS`（类型 `ReplayableCommandKind`）供宿主自查。

被撤销掉的操作不会在回放里留下痕迹：撤销条目记录它撤销的那一条（`undoes`），没有逆载荷的撤销（行高、样式、合并等）在回放时与它指向的正向条目一起跳过；有逆载荷的撤销（单元格编辑、插入/删除行列）回放逆操作。

设计细节与操作记录子系统见[模拟平台设计](/plan/2026-10-20-mock-platform)。

::: tip 从包根可用的命令
42 个命令中，以下 17 个从包根导出，可直接 `import { ... } from 'web-spreadsheet'`：

`InsertRowCommand`、`InsertColCommand`、`DeleteRowCommand`、`DeleteColCommand`、`SetCellStyleCommand`、`SetRangeStyleCommand`、`SetRangeBorderCommand`（含 `edgesForPreset`）、`SetAxisStyleCommand`、`ClearAxisStyleCommand`（另附 `axisSelectionOf` / `reservedAxisStyleId` 辅助函数）、`SetConditionalFormatCommand`、`SetValidationCommand`、`CreateChartCommand`、`RemoveChartCommand`、`SetChartAnchorCommand`、`SetRowsHiddenCommand`、`SetColsHiddenCommand`、`SetSparklineCommand`。

其余命令（`SetCellText`、`SetRangeValues`、`MoveRange`、`FillRangeCommand`、`SortRangeCommand`、超链接 / 图片 / 分列 / 去重等）目前仅在包内部使用，未导出——UI 通过菜单与手势派发它们；宿主如需程序化执行，可走 `Spreadsheet` 暴露的菜单回调或等待后续导出。
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
