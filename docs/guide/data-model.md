# 数据模型

本章说明电子表格的数据结构：单元格、样式、行/列元数据、合并单元格以及序列化格式。所有类型均从包根导出。

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
  text: string;        // 必填，显示文本
  value?: CellValue;   // 解析后的值（数字/日期/布尔等）
  formula?: string;    // 公式（以 '=' 开头）
  styleId?: string;    // 指向样式表 SheetData.styles 的键
  type?: 'text' | 'number' | 'date' | 'boolean';
}
```

单元格按 `"r,c"`（行,列，从 0 开始）为键存在 `Map` 里，空单元格不占存储。

## Style（样式）

```ts
export interface Style {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;       // 字体颜色
  bgcolor?: string;     // 背景色
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  fontSize?: number;
  fontFamily?: string;
  numberFormat?: string; // 内置名或 Excel 自定义格式串，见「格式化」
  wrap?: boolean;        // 自动换行
  border?: { top?: string; bottom?: string; left?: string; right?: string };
}
```

样式去重存储：相同的样式共享一个 `styleId`，单元格只存引用。

::: warning 注意
字段名是 `numberFormat`（不是 `format`）。样式暂不支持删除线、文字旋转。
:::

## 行 / 列元数据

```ts
export interface RowMeta { height?: number; hide?: boolean; }
export interface ColMeta { width?: number; hide?: boolean; }
```

默认尺寸（全局常量，非 per-sheet 配置）：

| 常量 | 值 |
|------|-----|
| `TOTAL_ROWS` | 1000 |
| `TOTAL_COLS` | 26（A–Z） |
| `ROW_HEIGHT` | 20px |
| `COL_WIDTH` | 64px |
| `ROW_HEADER_WIDTH` | 46px |
| `COL_HEADER_HEIGHT` | 20px |

行高/列宽拖拽调整的下限/上限：行高 15–500px，列宽 30–500px。双击行头/列头触发自动适应（auto-fit）。

## 合并单元格

合并以 A1 风格的范围字符串（如 `"A1:B2"`）存在 `SheetData.merges` 集合中，通过 Store 操作：

```ts
store.addMerge('A1:B2');    // 合并
store.removeMerge('A1:B2'); // 取消合并
store.getMergeAt(0, 0);     // 查询 (0,0) 所在的合并区域
store.getMerges();          // 当前 sheet 全部合并区域
```

UI 层对应 `SetMerge` 命令（`{ range, active: boolean }`），可撤销。

## Sheet

工作簿由 `Store` 持有若干 `SheetData` + 名字。每个 `SheetData` 内部包含：

| 数据 | 说明 |
|------|------|
| `cells` | `"r,c" → Cell` |
| `rows` / `cols` | 行高列宽、隐藏标记 |
| `styles` | `styleId → Style` 样式表 |
| `merges` | 合并区域集合 |
| `conditionalRules` | 条件格式规则（见[格式化](/guide/formatting)） |
| `charts` / `sparklines` | 图表 / 迷你图定义 |
| `validationRules` | 数据验证规则 |
| `namedRanges` | 命名区域 |
| `protection` | 工作表保护状态 |
| `autoFilter` | 自动筛选状态 |

::: tip
冻结窗格不在 Sheet 数据里——它是纯视图状态（`FreezeManager`），不参与序列化。
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
