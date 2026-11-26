# 数据模型

本章说明电子表格的数据结构：单元格、样式、行/列元数据、合并单元格以及序列化格式。`Cell`、`Cell` 相关基础类型（`CellValue` / `RowMeta` / `ColMeta` / `Style`）从包根导出；`RichTextRun`、`CellHyperlink`、`CellComment`、`ImageSpec`、`RowGroupDef` 等扩展类型目前需从仓库内部路径引用（或依赖类型推断），包根导出清单见 [API 文档](/api/spreadsheet)。

## CellInput（输入格式）

构造 `Spreadsheet` 时（或通过命令写入时），单元格接受宽松的输入格式：

```ts
export type CellInput = string | Partial<Cell>;
```

| 输入 | 行为 |
|------|------|
| `'100'` | 作为 `text`，并尝试 `Number()` 解析出 `value` |
| `'=SUM(A1:A2)'` | 以 `=` 开头视为公式，写入 `formula` 字段 |
| `{ text: '产品' }` | 直接作为显示文本 |
| `{ formula: '=B1+C1' }` | `text` 自动取公式串，进入公式引擎 |
| `{ text: '123', styleId: 's1' }` | 文本 + 样式引用 |

规范化规则（`normalizeCellInput`）：对象输入以 `text ?? formula` 为文本；有公式时忽略 `value`（由公式引擎计算），否则尝试从文本解析数值。

## Cell（存储格式）

```ts
export type CellValue = string | number | boolean | Date | null;

export interface Cell {
  text: string;         // 必填，显示文本
  value?: CellValue;    // 解析后的值（数字/日期/布尔等）
  formula?: string;     // 公式（以 '=' 开头）
  styleId?: string;     // 指向样式表 SheetData.styles 的键
  type?: 'text' | 'number' | 'date' | 'boolean';
  richText?: RichTextRun[];  // 富文本（文本常量格；text 恒等于各 run 串联）
  spillOf?: string;     // 动态数组影子格：锚点公式的 "sheetId:r,c"（见公式引擎）
  hyperlink?: CellHyperlink; // 超链接 { target, tooltip? }
  comment?: CellComment;     // 批注 { text, author?, createdAt? }
}
```

`RichTextRun { text, style? }` 的 `style` 支持 bold/italic/underline/strike/字号/字体/颜色/上下标。`spillOf` 影子格随单元格序列化，锚点每次重算时整批重建。

单元格以数值键 `r * TOTAL_COLS + c` 存在 `Map` 里（`src/store/SheetData.ts`），空单元格不占存储；对外的 `getCells()` / `serialize()` 仍产出 `"r,c"`（行,列，从 0 开始）字符串键。网格是 Excel 的地址空间（1,048,576 行 × 16,384 列），核心原则是**地址空间不是分配**——键是一个数字，任何遍历都只走已存储的格子（见下文「稀疏遍历与范围 API」）。

## Style（样式）

```ts
export interface Style {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;     // 删除线
  color?: string;       // 字体颜色
  bgcolor?: string;     // 背景色
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  fontSize?: number;
  fontFamily?: string;
  numberFormat?: string; // 内置名或 Excel 自定义格式串，见「格式化」
  wrap?: boolean;        // 自动换行
  indent?: number;       // 缩进级别（0–15）
  textRotation?: number; // 文字旋转（−90…90）
  border?: { top?: string; bottom?: string; left?: string; right?: string };
}
```

样式去重存储：相同的样式共享一个 `styleId`，单元格只存引用。

::: warning 注意
字段名是 `numberFormat`（不是 `format`）。
:::

## 行 / 列元数据

```ts
export interface RowMeta { height?: number; hide?: boolean; styleId?: string; }
export interface ColMeta { width?: number; hide?: boolean; styleId?: string; }
```

`styleId` 是**列/行默认样式**（整列/整行格式化，Excel 语义）：没有自有样式的格子显示它，之后输入的格子也立即生效。有效样式的解析顺序是**格子自有样式 > 行默认 > 列默认**，入口是 `Store.getCellStyle(r, c, cell?, sheetId?)`（详见[格式化](/guide/formatting)的「列/行默认样式」）。

默认尺寸（全局常量，非 per-sheet 配置）：

| 常量 | 值 |
|------|-----|
| `TOTAL_ROWS` | 1,048,576 |
| `TOTAL_COLS` | 16,384（A–XFD） |
| `ROW_HEIGHT` | 20px |
| `COL_WIDTH` | 64px |
| `ROW_HEADER_WIDTH` | 46px |
| `COL_HEADER_HEIGHT` | 20px |

行高/列宽拖拽调整的下限/上限：行高 15–500px，列宽 30–500px。双击行头/列头触发自动适应（auto-fit）。

## 稀疏遍历与范围 API

网格大小只是**地址空间**：遍历和统计永远只碰已存储的格子。`Store` 上新增的 API（均有可选 `sheetId` 尾参）：

```ts
store.forEachCell((r, c, cell) => { ... });            // 每个已存储格子调用一次
store.forEachCellInRect(rect, (r, c, cell) => { ... }); // 只回调 rect 内已存储的格子
store.getCellCount();                                   // 已存储格子数
store.getUsedBounds();                                  // 已用范围 { r1, c1, r2, c2 }；空表 undefined
store.limitToData(range);                               // 选区 ∩ 已用范围
```

- `forEachCellInRect` 的代价按「矩形地址数与已存储格子数中较小者」走：小矩形逐地址查表，大矩形一次全扫过滤。
- `limitToData` 把选区收缩到与已用范围的交集；**不相交时回落到选区首格**——对空选区的操作仍有一个格子可落点，永远不会扫地址空间。
- `CellRect { r1, c1, r2, c2 }` 与合并查询的 `MergeRect` 类型都从两个包入口导出。

## 物化上限常量

会**创建或展开**格子的操作有硬上限（`src/util/limits.ts`，前两个从两个包入口导出）：

| 常量 | 值 | 约束 |
|------|-----|------|
| `MAX_MATERIALIZED_CELLS` | 250,000 | 一次粘贴平铺 / 智能填充最多写入的格子数；Excel 会把复制块平铺填满整列选区，这里粘贴只在锚点落一次、填充到该数为止 |
| `MAX_DENSE_RANGE_CELLS` | 2,000,000 | 一个区间引用最多读进一个稠密数组的格子数；更大的区间仍然精确——聚合类函数只走已存储的格子，其余函数返回 `#VALUE!`（见[公式引擎](/guide/formulas)） |

逐格类命令（样式、数字格式、边框、清空等）按同一原则收缩处理范围，见[命令与撤销](/guide/commands)的「有效范围与逐格命令」。

## 合并单元格

合并以 A1 风格的范围字符串（如 `"A1:B2"`）存在 `SheetData.merges` 集合中，通过 Store 操作：

```ts
store.addMerge('A1:B2');    // 合并
store.removeMerge('A1:B2'); // 取消合并
store.getMergeAt(0, 0);     // 查询 (0,0) 所在的合并区域（A1 串）
store.getMergeRectAt(0, 0); // 同上，返回解析后的边界 { r1, c1, r2, c2, range }
store.getMerges();          // 当前 sheet 全部合并区域
```

`getMergeAt` / `getMergeRectAt` 由 SheetData 内的按行合并索引支撑（不再每次线性扫描并解析 A1 串）；返回的 `MergeRect` 是内部共享对象，调用方应视为只读。

UI 层由 `mergeSelection`（`src/components/mergeActions.ts`）统一入口，菜单栏与工具栏共用，语义对齐 Excel：

- **合并后居中（Merge & Center）**：合并 + 锚点居中是**单个撤销步**（`CompositeCommand`）；选区恰好等于某个已有合并时再点一次即取消合并（开关行为）。
- **跨越合并（Merge Across）**：选区每行独立合并，对应 `SetMergeAcross` 命令。
- **多值冲突警告**：选区内非锚点单元格有内容时先弹「仅保留左上角的值」确认（`mergeConflictCount`；公式单元格即使结果为空串也算有内容）。
- **重叠吸收**：新合并范围与已有合并相交时，旧合并整体移除，只保留新合并锚点的值。
- **单格守卫**：单个（未合并）单元格上合并/跨越合并/取消合并均无操作，「合并后居中」只居中；无实际变化的合并命令不进撤销历史（见[命令与撤销](/guide/commands#撤销栈特性)的 `isNoOp()`）。
- **行列增删**：插入时下方/右方合并平移、跨越插入点的合并扩大；删除时被覆盖的合并收缩或移除（`shiftMergesForInsert` / `shiftMergesForDelete`）。

底层命令为 `SetMerge`（`{ range, active: boolean }`），可撤销；粘贴等只需改动合并结构、不动值的场景使用 `ApplyMergeChanges`。

## Sheet

工作簿由 `Store` 持有若干 `SheetData` + 名字。每个 `SheetData` 内部包含：

| 数据 | 说明 |
|------|------|
| `cells` | 已存储格子（内部数值键 `r * TOTAL_COLS + c`，序列化为 `"r,c"` 键） |
| `rows` / `cols` | 行高列宽、隐藏标记、列/行默认样式（`styleId`） |
| `styles` | `styleId → Style` 样式表 |
| `merges` | 合并区域集合 |
| `conditionalRules` | 条件格式规则（见[格式化](/guide/formatting)） |
| `charts` / `sparklines` | 图表 / 迷你图定义 |
| `images` | 浮动图片对象（`ImageSpec`，data URL 持久化） |
| `rowGroups` | 行分组区间（`RowGroupDef { start, end }`） |
| `validationRules` | 数据验证规则 |
| `namedRanges` | 命名区域 |
| `protection` | 工作表保护状态 |
| `autoFilter` | 自动筛选状态 |
| `freeze` | 冻结窗格（`SheetFreeze { rows, cols }`，随工作表一起序列化，也随 xlsx 导入/导出） |

::: tip
冻结窗格是**每张工作表的数据**（`SheetData.freeze`），不再只是视图状态：随工作表一起序列化、随 xlsx 导入/导出，通过 `store.getFreeze(sheetId?)` / `store.setFreeze(freeze | undefined, sheetId?)` 读写；视图显示活动工作表的冻结，组件在两者间同步（`src/components/hooks/useSheetFreeze.ts`）。
:::

## 序列化格式

`store.serialize()` 返回可 JSON 化的完整工作簿快照，`Store.deserialize(data)` 从快照还原：

```ts
export interface SerializedStore {
  readonly activeSheetId: string;
  readonly sheets: Array<{
    readonly id: string;
    readonly name: string;
    readonly data: SerializedSheetData;
  }>;
}
```

`SerializedSheetData` 中 `cells` 是 `[key, Cell]` 数组（键 `"r,c"`）、`rows`/`cols`/`styles` 同为数组对、`merges` 是范围字符串数组，其余为对应规则数组。这也是 JSON 导出（`workbook.json`）与 IndexedDB 自动保存使用的格式。

## 读取 / 写入数据（Store API）

```ts
// 读
store.getCell(r, c);                          // Cell | undefined
store.getCellBySheetName('Sheet2', r, c);
store.getStyle(cell.styleId!);                // Style | undefined
store.getActiveSheetId();                     // 'sheet-1'、'sheet-2' …
store.getSheets();                            // [{ id, name }]
store.getRowEntries();                        // 带元数据的行：[index, RowMeta][]
store.getColEntries();                        // 带元数据的列：[index, ColMeta][]

// 写
store.setCell(r, c, { text: 'hello' });
store.setCell(r, c, undefined);               // 清空
store.setRow(r, { height: 32 });
store.setCol(c, { hide: true });

// 订阅变更
const off = store.subscribe((e) => { /* StoreEvent */ });
```

完整的 Store / 服务类方法列表见 [API 文档](/api/spreadsheet)，变更事件见[事件系统](/guide/events)。

::: warning
直接调 `store.setCell` 不会进入撤销历史，也不会触发公式重算的完整链路。应用层的修改应通过 `cmdManager.execute(命令)` 走命令系统（见[命令与撤销](/guide/commands)），Store 直写仅适合初始化或只读场景。
:::

## 超链接

单元格可选 `hyperlink: { target, tooltip? }`：

- `target`：`http(s)://`、`mailto:`、`A1` 或 `Sheet1!A1`（及 `#Sheet1!A1`）
- 插入：菜单 **插入 → 链接...**（`Ctrl+K` 若已绑定则同）
- 打开：选中带链接的单元格后 **Ctrl+单击**（外链新标签；表内跳转）
- 粘贴 / 填充跟随链接语义（会话与系统剪贴板携带 `hyperlink`，覆盖写入清除旧链接）
- xlsx：通过 SheetJS 的 `l` 字段与 hyperlink 关系双向往返；JSON 工作簿完整保留

## 批注

数据模型支持批注（`Cell.comment`，xlsx 经 comment XML 双向往返），并提供 `SetCellCommentCommand` 命令；**UI 入口（右键菜单/红三角指示）已按产品决策移除**，当前只有程序化写入路径。

