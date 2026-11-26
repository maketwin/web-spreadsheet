# 公式引擎

公式引擎由三部分组成：`FormulaParser`（解析为 AST）、`DependencyGraph`（单元格依赖图）、`evaluate`（求值器），由 `FormulaEngine` 统一调度，支持**增量重算**——只重算受影响的下游单元格。

## 基本语法

公式以 `=` 开头，写在单元格的 `formula`（或 `text`）字段：

```ts
const ss = new Spreadsheet('app', {
  data: [
    ['100', '120', '=A1+B1'],
    ['2',   '3',   '=SUM(A1:B1)*A2'],
  ],
});
```

支持的语法要素：

| 语法 | 示例 | 说明 |
|------|------|------|
| 单元格引用 | `A1` | 列字母 + 行号（内部转 0 基坐标） |
| 区域引用 | `A1:B5` | 用在 `SUM` 等聚合函数里 |
| 整列 / 整行引用 | `A:A`、`A:C`、`1:1`、`3:5` | 跨整个地址空间的引用，见下文「大区间与稀疏求值」 |
| 开口区间 | `B2:B`（= `B2:B1048576`）、`B1:1`（= `B1:XFD1`） | 缺失的一端开向对应边缘；`$` 锚定与 `Sheet!` 前缀同样支持 |
| 跨 Sheet 引用 | `Sheet2!A1`、`SUM(Sheet2!A1:A5)` | 含空格的表名：`'My Sheet'!A1`；整列/整行与开口区间同样可带 `Sheet2!B:B` |
| 命名区域 | `=销售额*2` | 解析为 `name` 节点后经命名区域解析，见[数据功能](/guide/data-features) |
| 算术运算符 | `+` `-` `*` `/` | |
| 比较运算符 | `>` `<` | |
| 一元负号 | 结果层支持取负 | |
| 函数调用 | `SUM(A1:A5)` | 函数名大小写不敏感 |

插删行列时这些写法按 Excel 语义改写：有锚定端的开口区间（`B2:B`）锚定端按普通引用平移（插行后变 `B3:B`），开口端保持开口；整列/整行引用（`A:A`、`3:5`）本身没有锚定端，保持原样。`INDIRECT` 的字面量参数同样支持整列/整行与开口区间（`INDIRECT("B2:B")`）。

## 内置函数（91 个）

77 个经 `registry.register` 注册，另有 14 个（`VLOOKUP` / `HLOOKUP` / `XLOOKUP` / `SUBTOTAL` / `ROW` / `COLUMN` / `ROWS` / `COLUMNS` / `IFS` / `SWITCH` / `INDIRECT` / `OFFSET` / `IFERROR` / `IFNA`）因需要惰性求值或引用上下文在求值器里特殊分发。完整清单与自动补全签名见 `src/formula/functionCatalog.ts`。

### 数学

| 函数 | 参数 | 说明 |
|------|------|------|
| `SUM` | 1–255 | 求和（区域展开） |
| `SUMIF` | 2–3 | 按单个条件求和（`">1"` 等运算符条件） |
| `SUMIFS` | 3+ | 多条件求和（求和区在前） |
| `SUMPRODUCT` | 1–255 | 对应元素相乘再求和；文本/空按 0，比较结果 TRUE/FALSE 按 1/0 |
| `PRODUCT` | 1–255 | 所有参数乘积；文本/空忽略，全空返回 0 |
| `ROUND` | 1–2 | 四舍五入，可指定小数位 |
| `ROUNDUP` / `ROUNDDOWN` | 1–2 | 远离 / 朝零舍入到指定小数位 |
| `ABS` | 1 | 绝对值 |
| `INT` | 1 | 向下取整 |
| `MOD` | 2 | 取模 |
| `POWER` / `SQRT` / `PI` | — | 幂 / 平方根 / 圆周率 |

### 统计

| 函数 | 参数 | 说明 |
|------|------|------|
| `AVERAGE` | 1–255 | 平均值 |
| `MAX` / `MIN` | 1–255 | 最大 / 最小 |
| `COUNT` | 1–255 | 数值个数 |
| `COUNTA` | 1–255 | 非空个数 |
| `COUNTBLANK` | 1 | 空白个数：未存储的地址与空串格子都算；稀疏区间上按「面积 − 已存储非空」算术补足 |
| `COUNTIF` | 2 | 条件计数 |
| `COUNTIFS` | 2n | 多条件计数 |
| `AVERAGEIF` / `AVERAGEIFS` | 2–3 / 3+ | 条件平均 |
| `MEDIAN` | 1–255 | 中位数 |
| `LARGE` / `SMALL` | 2 | 第 k 大 / 第 k 小 |
| `RANK.EQ` / `RANK` | 2–3 | 排名（并列取最优名次；第 3 参非 0 为升序） |
| `STDEV.S` / `STDEV` | 1–255 | 样本标准差（n−1） |
| `STDEV.P` / `STDEVP` | 1–255 | 总体标准差（n） |
| `MAXIFS` / `MINIFS` | 3+ | 多条件最大 / 最小；无匹配返回 0 |
| `SUBTOTAL` | 2+ | 分类汇总（功能号 1–11 / 101–111，忽略筛选隐藏行） |

### 逻辑

| 函数 | 参数 | 说明 |
|------|------|------|
| `IF` | 2–3 | 条件分支，第三参（假值）可省略 |
| `IFS` | 2n | 多分支：成对的「条件, 值」，取第一个命中的；全不命中 `#N/A` |
| `SWITCH` | 3+ | 与多值逐一比较，命中返回对应值；可带默认值 |
| `AND` / `OR` | 1–255 | 逻辑与 / 或；区间里的空格和文本被忽略（Excel 语义），一个逻辑值都没有时返回 `#VALUE!` |
| `NOT` | 1 | 逻辑非 |
| `IFERROR` / `IFNA` | 2 | 错误兜底（`#N/A` 专用见 `IFNA`） |
| `ISBLANK` / `ISNUMBER` / `ISTEXT` / `ISERROR` / `ISNA` | 1 | 信息判断 |
| `TRUE` / `FALSE` | 0 | 布尔常量 |

### 文本

| 函数 | 参数 | 说明 |
|------|------|------|
| `CONCAT` | 1–255 | 拼接 |
| `LEFT` / `RIGHT` | 1–2 | 左 / 右截取，默认 1 字符 |
| `MID` | 2–3 | 中间截取 |
| `LEN` | 1 | 长度 |
| `UPPER` / `LOWER` | 1 | 大小写转换 |
| `TRIM` | 1 | 去首尾空格 |
| `TEXTJOIN` | 3+ | 分隔符拼接，可忽略空值 |
| `FIND` | 2–3 | 区分大小写查找子串位置（1 起）；未找到 `#VALUE!` |
| `SEARCH` | 2–3 | 不区分大小写，支持 `*` `?` 通配（`~` 转义） |
| `SUBSTITUTE` | 3–4 | 替换所有 / 指定第 n 个匹配 |
| `REPLACE` | 4 | 按位置拼接替换 |
| `EXACT` | 2 | 区分大小写比较 |
| `TEXT` / `VALUE` / `CONCATENATE` | — | 格式化 / 转数值 / 拼接 |

### 查找

| 函数 | 参数 | 说明 |
|------|------|------|
| `INDEX` | 2–3 | 按行列号取值 |
| `MATCH` | 2–3 | 查找位置 |
| `VLOOKUP` | 3–4 | 首列查找并返回同行指定列；第 4 参为 `0`/`FALSE` 时精确匹配（文本不区分大小写），省略时为近似匹配（假设首列升序，取不大于查找值的最大键）；未命中返回 `#N/A` |
| `HLOOKUP` | 3–4 | 首行查找（与 `VLOOKUP` 对称） |
| `XLOOKUP` | 3–6 | 精确 + 通配匹配、`if_not_found`、首尾搜索方向；查找/返回列为向量时结果溢出到相邻格 |
| `ROW` / `COLUMN` | 0–1 | 无参返回公式所在行 / 列；带引用返回其行 / 列号 |
| `ROWS` / `COLUMNS` | 1 | 区域行数 / 列数 |
| `INDIRECT` | 1–2 | 文本转引用（`"Sheet2!A1"`、`"A1:B3"`），支持跨表 |
| `OFFSET` | 3–5 | 从基准引用偏移取区域 |

### 动态数组与溢出

Excel 365 风格：结果为多值时**溢出**到右侧/下方相邻空格，锚点格保留公式，覆盖格称为影子格（见[数据模型](/guide/data-model)的 `spillOf`）。

| 函数 | 参数 | 说明 |
|------|------|------|
| `SEQUENCE` | 1–4 | 生成行×列的等差序列矩阵 |
| `FILTER` | 2–3 | 按条件筛选区域，结果纵向溢出 |
| `UNIQUE` | 1 | 去重，结果纵向溢出 |
| `SORT` | 1–2 | 升/降序排序，结果纵向溢出 |

溢出被非空格阻挡时锚点显示 `#SPILL!`；清开阻挡后自动恢复。编辑锚点为标量、删除行等结构操作都会让旧影子格退役（见 [CHANGELOG v2.2.0](https://github.com/maketwin/web-spreadsheet/blob/master/CHANGELOG.md)）。

## 大区间与稀疏求值

网格是 Excel 的地址空间，一个区间引用最多把 `MAX_DENSE_RANGE_CELLS`（200 万，`src/util/limits.ts`，已导出）个格子读进一个稠密数组。更大的区间以**稀疏值**表示（`SparseRangeValue`，守卫 `isSparseRange`，均已导出）：只携带区间形状和一次「已存储格子」的遍历，地址空间永不展开。

**按已存储格子求值（精确）**的函数：`SUM`、`AVERAGE`、`MIN`、`MAX`、`COUNT`、`COUNTA`、`COUNTBLANK`、`PRODUCT`、`MEDIAN`、`LARGE`、`SMALL`、`STDEV` 系列、`RANK`、`TEXTJOIN`、`CONCAT`、`COUNTIF` / `SUMIF` 及其 `IFS` / `AVERAGEIF(S)` / `MAXIFS` / `MINIFS`、`SUMPRODUCT`、`AND`、`OR`、`SUBTOTAL`、`VLOOKUP`、`HLOOKUP`（查找按存储位置逐格走，整列查找是 O(已存储) 而不是 O(行数)）。稀疏区间上匹配空格的条件（`COUNTIF(range, "")`、`=`）按「面积 − 已存储」算术补足，不逐空地址遍历。

**返回 `#VALUE!`** 的场景：区间类函数（`UNIQUE`、`SORT`、`FILTER`、`IS*` 族）以及把大区间当标量或做二元运算——它们需要整个网格或按位置索引，宁可报错也不分配。例外：**`INDEX` 的行、列参数都是标量时按地址直接取值**，`INDEX(A1:C1048576, 5, 2)` 可用，越界返回 `#REF!`；`MATCH` / `XLOOKUP` 的大区间仍返回 `#VALUE!`。

**Excel 语义对齐**：`AND` / `OR` 忽略区间里的空格和文本，一个逻辑值都没有返回 `#VALUE!`；`COUNTBLANK` 在稀疏区间上按算术补足空格数。

::: tip
大区间照样精确：`=SUM(A:A)` 覆盖 100 万个数字的求值在毫秒级完成（见[规模与性能](/guide/scale)），因为求值只走已存储的格子。
:::

### 日期时间

| 函数 | 参数 | 说明 |
|------|------|------|
| `NOW` | 0 | 当前日期时间（易失函数，每轮有工作的重算都会刷新） |
| `TODAY` | 0 | 当前日期（`yyyy-mm-dd` 字符串；易失函数，跨午夜自动更新） |
| `YEAR` / `MONTH` / `DAY` | 1 | 从日期值取年 / 月 / 日 |
| `HOUR` | 1 | 从日期值取小时 |
| `DATE` | 3 | 构造日期（月/日溢出自动进位），返回 `yyyy-mm-dd` |
| `TIME` | 3 | 构造时间（超过 24h 回绕），返回 `HH:mm:ss` |
| `DATEDIF` | 3 | 日期间隔，单位 `Y` / `M` / `D` / `YM` / `YD` / `MD`；起期晚于终期返回 `#NUM!` |

## point 模式与引用编辑

在 UI 里输入公式时，编辑器提供 Excel 同款的**引用拾取**体验（实现位于 `src/formula/pointMode.ts`）：

- **触发条件**：光标前的文本是等待操作数的公式——以 `=` 开头且结尾为 `=`、`+`、`-`、`*`、`/`、`^`、`&`、`(`、`,`、`:`、`;` 等之一；
- **方向键**：触发时方向键不提交编辑，而是插入一个引用（初始指向当前单元格），继续按方向键移动该引用（单格引用；`Shift`/`Ctrl` 修饰的方向键仍走默认行为）；
- **点击单元格**：触发时点击画布上的单元格会把它的引用插入光标处；已处于 point 模式时点击会替换尾部的引用。不触发时点击则提交编辑并选中该格；
- **`F4`**：对光标处的引用循环 `$` 锚定：`A1` → `$A$1` → `A$1` → `$A1`。

::: info 与平移语义的关系
`$` 锚定既被解析器接受（求值与普通引用一致），也被平移语义尊重：填充、排序、会话粘贴时绝对引用不随位置平移。
:::

**`Alt + =`（AutoSum）**：在活动单元格生成 `=SUM(...)`——优先取上方连续的数字区域，其次取左侧——并进入编辑模式方便直接回车确认。

## 名称管理器

菜单「公式(M) → 名称管理器…」提供 Excel 同款的命名区域管理（对话框见 `src/components/menu/dialogs/NameManagerDialog.tsx`）：

- **列表**：展示全部命名区域的名称与引用位置（A1 表示）；
- **新建 / 编辑**：名称不能与单元格引用同形（如 `A1`）、不含空格；引用位置输入 A1 区域（经 `parseNameBoxInput` 解析为内部坐标存储）；
- **删除**：移除命名后，引用该名称的公式在下次求值时得到 `#NAME?`；
- 名称管理器操作**不进撤销栈**（与 Excel 一致）；左上角名称框跳转/新建命名的既有入口不受影响。

## 依赖图与重算

- 每个公式的依赖（`A1`、`Sheet2!B2` 等）注册进 `DependencyGraph`；键为 `sheetId:单元格` 的 scoped key。
- **大区间登记成一个矩形依赖**（`src/formula/precedents.ts` 的 `RANGE_DEP_CELLS = 256`，已导出）：面积超过它的区间不再每格一条边（整列 `SUM` 否则要建 104 万条边），而是登记为一个矩形——矩形内任何一格变化就把归属公式标脏。区间内已有的公式仍保留精确的逐格边，环检测与拓扑序不受影响；标量查找函数（`INDEX` / `VLOOKUP` / `HLOOKUP` / `MATCH` / `XLOOKUP`）所在格子落在自己的大区间内不算自引用。
- 重算按 Excel 的规则调度：值可能过期的公式带「脏」标记，求值时只顺着脏的前驱拉取——同一次重算里每个公式最多求值一次；并且**只有值真的变了的单元格**才会让读它的公式变脏。
- 引擎写结果时内容没变就不写、不发事件；同步层（`createFormulaSync`）也不会把引擎自己的写入当成编辑再回流一遍。
- 一次操作里的多处改动（整行插入、批量粘贴、排序）经 `engine.coalesce()` 合并成一遍：先登记，再按依赖序统一求值。
- 跨 sheet 依赖自动按 `SheetName:cellId` 键补查。
- 循环引用有显式检测：`DependencyGraph.wouldCreateCycle` 只在登记公式（依赖边变化）时执行，环上单元格按 Excel 习惯显示 `0`，求值栈兜底，不会死循环。
- **易失函数**（`FunctionSpec.volatile`，内置的 `NOW` / `TODAY` 已标）所在单元格在每一轮「本来就有工作」的重算里重新求值（Excel 的易失规则）——表格开过午夜 `=TODAY()` 也会翻到新的一天；`recalculateAll()` 仍按依赖序把所有公式各求值一次。
- 整个工作簿被替换（新建 / 打开 / 恢复）时 Store 先发 `workbook` 事件，同步层调用 `engine.reloadFromStore()` 从最终状态重建全部登记，新工作簿里没有的单元格不会留下旧公式。
- 重算过程中的异常会被捕获并 `console.error`，不会导致 UI 崩溃。

## 已知限制

::: warning 编写公式前请了解
- **比较运算符**支持 `>`、`<`、`>=`、`<=`、`=`、`<>`：两侧均为数值时按数值比较，否则按文本比较（不区分大小写）。
- **字符串拼接**支持 `&` 运算符。
- **`$A$1` 绝对引用**：解析器接受 `$` 锚定（求值与普通引用一致）；公式平移（填充/排序/会话粘贴）尊重 `$` 锚定。
- **错误值**：`#DIV/0!`、`#VALUE!`、`#REF!`、`#NAME?`、`#NUM!`、`#N/A`、`#NULL!`、`#SPILL!`、`#CALC!` 会在运算与多数函数间传播；未知函数 → `#NAME?`。`IFERROR` / `ISERROR` 能捕获 `#SPILL!` / `#CALC!`。
- **循环引用**：迭代关闭时按 Excel 习惯对环上单元格显示 `0`（`DependencyGraph.wouldCreateCycle` / 求值栈检测）。
- `SUBTOTAL` 的 7/8/10/11 功能号未实现；`LAMBDA` / `LET` 未实现。
- `SUBTOTAL`：隐藏行（含筛选与手动隐藏，共用 `RowMeta.hide`）一律跳过，不区分 Excel 的 1–11 vs 101–111 细别。
- `INDIRECT` / `OFFSET` 已实现；依赖图只跟踪公式里的静态引用，**仅改动态目标单元格不一定触发重算**（与计划原「可选/延期」文档不同步处已按代码纠正）。
- 矩阵与区域可参与标量运算：`=SUM(A1:A3*SEQUENCE(3))` 等元素级运算已支持（矩阵操作数自动展平）。超过稠密上限的大区间不行——当标量或参与二元运算返回 `#VALUE!`（见上文「大区间与稀疏求值」）。
- 字符串字面量的引号不会被特殊处理，含引号的参数会连同引号一起成为字符串。
:::

大多数限制对 UI 使用影响不大（UI 侧的公式插入都是合法子集），但如果你在程序里生成公式，建议只用上表列出的语法。

## 程序化使用

```ts
import { FormulaParser, evaluate, registry, DependencyGraph } from 'web-spreadsheet';

// 解析为 AST
const ast = new FormulaParser().parse('SUM(A1:A3)');

// 注册自定义函数（也可在插件里通过 PluginAPI.registerFunction）
registry.register('DOUBLE', {
  minArgs: 1, maxArgs: 1,
  evaluate: ([x]) => Number(x) * 2,
});

// 函数可声明第二个参数，获知公式所在单元格 / 工作表（引擎求值路径一定有值；
// 条件格式 / 验证规则那种不带上下文的直接求值里为 undefined）
registry.register('MYCELL', {
  minArgs: 0, maxArgs: 0,
  evaluate: (_args, ctx) => ctx ? `${ctx.cell.r},${ctx.cell.c}@${ctx.sheetId}` : '',
});

// 易失函数：所在单元格在每一轮「本来就有工作」的重算里重新求值（NOW/TODAY 已标）
registry.register('FEED', {
  minArgs: 0, maxArgs: 0, volatile: true,
  evaluate: () => fetchFeedSnapshot(),
});

// 查看已注册函数
registry.list();   // ['SUM', 'AVERAGE', ..., 'DOUBLE']
```

### 私有函数注册表

`registry` 是所有引擎共享的注册表；`FunctionRegistry` 是导出的类，构造时可传父表：

```ts
import { FormulaEngine, FunctionRegistry, registry } from 'web-spreadsheet';

const table = new FunctionRegistry(registry); // 私有表：查不到的名字回落到共享表
table.register('FEED', { minArgs: 0, maxArgs: 0, evaluate: () => feed() });

const engine = new FormulaEngine(store, { registry: table }); // 引擎改用私有表
engine.registry;                 // 可读
```

- 私有表里注册的函数本引擎可用、不外泄；内置函数仍然可用（回落父表）。
- 插件里的 `api.registerFunction` 注册到宿主引擎自己的表上，撤销（插件卸载/销毁）时恢复原定义。
- **默认不变**：`new FormulaEngine(store)` 用的仍是共享 `registry`。

::: warning 私有表的边界
条件格式规则与数据验证规则里的公式是直接调用 `evaluate()` 求值的，不带引擎的注册表——私有表里的函数对它们**不可见**，只对单元格公式生效。公式自动补全（`autoCompleteNames`）默认也查共享表。
:::

`FormulaEngine` 的方法见 [API 文档](/api/spreadsheet#formulaengine)。单元格公式的同步与重算由 UI 自动完成，一般无需手动调用。
