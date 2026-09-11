# 数据功能

本章汇总日常表格操作类功能：筛选与排序、命名区域、工作表保护、冻结窗格、查找替换、图表与迷你图。

## 自动筛选与排序

`FilterService` 提供筛选下拉与排序能力：

```ts
import { FilterService } from 'web-spreadsheet';

const filter = new FilterService(store);

filter.setAutoFilter();           // 按数据区域推断范围，开启筛选
filter.getFilterItems(1);         // 第 2 列的下拉项：{ text, blank, selected, count }
filter.hasColumnFilter(1);
filter.setColumnFilter(1, {
  selected: ['产品A', '产品B'],
  includeBlanks: false,
});
filter.clearColumnFilter(1);
filter.clearFilters();            // 清除全部条件
filter.applyFilters();
```

### 筛选条件

下拉里的勾选项之外，还支持自定义条件（优先于勾选列表，可 `and` / `or` 组合）：

```ts
type FilterConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'between' | 'contains' | 'notContains'
  | 'beginsWith' | 'endsWith';

filter.setColumnFilter(1, {
  selected: [],
  includeBlanks: true,
  conditions: [{ operator: 'contains', value: '华东' }],
  conditionsOp: 'and',
});
```

- 匹配大小写不敏感；空白项在下拉中显示为「(空白)」。
- 隐藏通过 `row.hide` 实现，不删数据。
- UI 上的筛选按钮点击、条件弹窗已内置。

### 排序

```ts
// 排序在 UI 里通过工具栏/右键菜单触发，内部走 SortRangeCommand（可撤销）：
// cmdManager.execute(new SortRangeCommand(range, { sortCol: 1, direction: 'asc' }))
```

排序规则与 Excel 一致：数字排在文本前，空值始终排最后；排序在单个 batch 内完成，区间内公式引用的行号会重映射。

## 命名区域

```ts
import { NamedRangeService } from 'web-spreadsheet';

const nr = new NamedRangeService();

nr.add(store, '销售额', 'B2:B10');        // 注册命名区域
nr.lookup(store, '销售额');               // { range, sheetId? }
nr.resolveToA1(store, '销售额');          // 'B2:B10'
nr.list(store);                           // 全部命名区域
nr.remove(store, '销售额');
```

公式里可以直接用名字：`=SUM(销售额)`。解析链路是先把名字替换为范围串，再走常规公式求值（见[公式引擎](/guide/formulas)）。

## 工作表保护

```ts
import { protectSheet, verifyPassword, unprotectSheet } from 'web-spreadsheet';

store.setProtection(protectSheet('123456'));
store.isSheetProtected();                    // true
verifyPassword('123456', store.getProtection()!.passwordHash); // true
store.setProtection(unprotectSheet());       // 解除保护
```

- 保护状态下**禁止编辑**单元格（开始编辑时拦截并提示「工作表已保护，无法编辑」）。
- 密码以 Base64 编码存入 `passwordHash`——这是 MVP 级别的简单实现，**不是安全的哈希**，请不要用敏感密码。

## 冻结窗格

冻结是纯视图状态（`FreezeManager`），由工具栏/视图菜单驱动，不影响数据与序列化：

- 冻结语义与 Excel 一致：冻结到某格，即冻结其上方所有行和左侧所有列（在 B2 处冻结 = 冻结 1 行 1 列）。
- 冻结区域在滚动时固定，可见范围计算自动把滚动起点推到冻结区之后。

## 查找替换

```ts
import { FindReplaceService } from 'web-spreadsheet';

const find = new FindReplaceService();

find.find(store, { findText: '产品', caseSensitive: false });
find.findNext();                            // 循环跳到下一个匹配
find.replaceAll(store, { findText: '产品', replaceText: '商品' }); // 返回替换数量
```

| 选项 | 说明 |
|------|------|
| `findText` | 查找内容 |
| `replaceText` | 替换内容 |
| `caseSensitive` | 区分大小写（默认否） |
| `wholeWord` | 全字匹配（默认否，否则为包含匹配） |

匹配结果按行列排序；「下一个」从当前光标位置找距离最近的匹配。UI 快捷键：`Ctrl/Cmd + F` 查找、`Ctrl/Cmd + H` 替换。

## 图表

基于 Chart.js，支持三种类型：`'bar' | 'line' | 'pie'`。

```ts
import { CreateChartCommand, ChartPanel, type ChartSpec } from 'web-spreadsheet';

// 创建图表（可撤销）
ss.cmdManager.execute(new CreateChartCommand(
  { r1: 0, c1: 0, r2: 5, c2: 2 },
  { type: 'bar', title: '季度营收' },
));
```

数据读取规则：区域**首行为标签**，每行一个数据系列（标签取行首单元格，取 `cell.value` 数字，取不到按 `Number(text)` 兜底），内置 5 色调色板循环。`ChartPanel` 是渲染面板的 React 组件（`{ spec, store, onClose }` props），饼图显示图例、柱状/折线图隐藏。

## 迷你图

内联 SVG 渲染，三种类型：`'line' | 'bar' | 'winloss'`。

```ts
import { Sparkline, SetSparklineCommand, type SparklineSpec } from 'web-spreadsheet';

// 在目标单元格创建迷你图（可撤销）
ss.cmdManager.execute(new SetSparklineCommand(
  { r1: 0, c1: 0, r2: 0, c2: 6 },           // 数据范围（如一周数据）
  { type: 'winloss', targetRow: 1, targetCol: 8 },
));

// 也可以直接当独立组件用
<Sparkline data={[1, -2, 3, -1, 2]} type="bar" width={60} height={20} />
```

winloss 类型正值为蓝色柱、负值为红色柱，带中轴线；默认尺寸 60×20。
