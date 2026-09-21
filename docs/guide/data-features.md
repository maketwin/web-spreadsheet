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

### 筛选范围与选择的关系（Excel 规则）

UI 的「数据 → 筛选」按**当前选择**决定筛选范围，规则与 Excel 一致（`autoFilterRangeFor(selection)`）：

| 当前的选择 | 应用的筛选范围 | 筛选按钮位置 |
|------------|----------------|--------------|
| 框选部分区域（如 `A3:C5`） | 精确按所选范围 | 所选区域第一行 |
| 整列选择（点列标，可多列） | 所选列自己的数据块 | 数据块首行 |
| 单个单元格 / 整行选择 / 全选 | 当前数据区域（CurrentRegion） | 数据区域首行 |
| 已开启筛选时再点「筛选」 | 关闭筛选（Excel 同款开关行为） | — |

- 想按自定义区域筛选，**先框选区域再点「筛选」**；单击一个单元格再加筛选时，按钮出现在整个数据区域的首行（通常是表头行），这正是 Excel 的行为。
- `CurrentRegion` 推断（`inferDataRegion`）：从锚点向四个方向生长，直到遇到整行/整列空白或表格边缘。
- `setAutoFilter()` 无参调用等价于对 `A1` 做区域推断；`autoFilterRangeFor` 是 UI 实际使用的入口，两者都在 `FilterService` 上。

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

排序规则与 Excel 一致：数字排在文本前，空值始终排最后；筛选状态下隐藏行钉在原位、只对可见行排序。排序在单个 batch 内完成，且按 Excel 的「移动语义」重映射引用：区间内公式的行号经置换表改写，区间外引用被移动单元格的公式（含跨表 `Sheet!A1` 引用）也会全簿跟随改写，并纳入同一次撤销。全簿重写由独立服务 `src/formula/rowMoveRefs.ts` 的 `remapRefsForMovedRows` 统一完成——任何「行移动」类操作（排序、将来的剪切移动/结构调整）只需产出置换表并调用它，不必各自实现引用维护。

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
find.findPrevious();                        // 上一个
find.replaceAll(store, { findText: '产品', replaceText: '商品' });
// → { replacements: 出现次数, cells: 受影响单元格数 }（Excel 按出现次数计）
```

| 选项 | 说明 |
|------|------|
| `findText` | 查找内容 |
| `replaceText` | 替换内容 |
| `caseSensitive` | 区分大小写（默认否） |
| `matchEntireCell` | 整格匹配：单元格须完全等于查找内容（默认否，否则为包含匹配） |
| `useRegex` | 正则模式：`findText` 作为正则源，替换支持 `$1` 分组引用；无效正则抛 `InvalidFindPatternError`（默认否） |
| `scope` | `'sheet'`（默认，当前工作表）或 `'workbook'`（从活动表开始按工作簿顺序遍历所有表） |

- 匹配基于公式源文本（Excel "Look in: Formulas"）；替换公式内的引用后会自动重算。
- 全部替换按表分组写回：紧凑匹配块是单条命令（一次撤销即可恢复），跨表替换后撤销会恢复到原表（`SetRangeValues` 记录执行时所在表）。
- 匹配按工作簿轮转顺序（活动表优先）+ 行列排序；「下一个」从当前光标位置向后找。

UI：`Ctrl/Cmd + F` 查找、`Ctrl/Cmd + H` 替换；对话框支持大小写/整格/正则/范围选项、上一个/下一个、结果列表点击跳转（跨表自动激活）、全部替换计数提示；画布高亮所有命中格（淡黄）并用橙色描边标记当前项，关闭对话框自动清除。

## 图表

基于 Chart.js 的 **Excel 式浮动图表对象**，支持三种类型：`'bar' | 'line' | 'pie'`。

```ts
import { CreateChartCommand, type ChartAnchor } from 'web-spreadsheet';

// 创建图表（可撤销）：数据范围为当前选区；
// anchor 是两单元格锚点（Excel 浮动对象模型：from/to 格子 + 格内像素偏移）
const anchor: ChartAnchor = {
  from: { r: 1, c: 6, offX: 0, offY: 0 },
  to: { r: 13, c: 13, offX: 0, offY: 0 },
};
ss.cmdManager.execute(new CreateChartCommand({
  r1: 0, c1: 0, r2: 5, c2: 2,
  type: 'bar',
  title: '季度营收',
  anchor,
}));
```

数据读取规则：区域**首行为标签**，每行一个数据系列（标签取行首单元格，取 `cell.value` 数字，取不到按 `Number(text)` 兜底），内置 5 色调色板循环。只选中单个单元格时插入会自动扩展到周围的连续数据区（Excel 行为）。

浮动对象行为与 Excel 一致：点选、拖拽移动、8 向手柄缩放、`Delete` 删除、`Ctrl+Z`/`Ctrl+Y` 撤销重做；插入/删除行列时锚点联动平移（move and size with cells）。SDK 侧对应 `SetChartAnchorCommand`（移动/缩放）、`RemoveChartCommand`（删除）；渲染组件为 `FloatingChart`（props：`{ spec, store, renderer, selected, onSelect, onGeometry, onRemove }`），需挂载在网格容器内并由宿主提供 `.ss-chart-layer` / `.ss-chart-object` 定位样式（参考 demo 的 `index.html`）。xlsx 导入/导出均携带 `twoCellAnchor` 位置与图表定义。

> 注：1.x 的 `ChartPanel` 面板组件（右上角面板形态）在 2.0 中由 `FloatingChart` 浮动对象取代。

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

## 删除重复项

菜单 **数据 → 删除重复项…**：

- 多格选区直接使用选区；单格则扩展到当前数据区域（与筛选相同的 `inferDataRegion`）。
- 对话框可选「数据包含标题行」与要参与比较的列；保留首次出现，删除后续重复的**整行**。
- 选区与合并单元格相交时拒绝操作。
- 可撤销（整表快照还原）。

## 分列

菜单 **数据 → 分列…**（分隔符模式）：

- 对选区（或数据区域）的**最左列**按分隔符拆分，结果从该列起向右覆盖写入。
- 支持 Tab / 分号 / 逗号 / 空格 / 自定义分隔符；可选「连续分隔符视为单个」。
- 固定宽度与逐列类型识别本轮不做。
- 可撤销。

