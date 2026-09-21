# 单元格富文本（Rich Text Runs）

单元格内的**部分文字**可以单独设置字体、字号、加粗、斜体、下划线、删除线、颜色与上下标——与 Excel 的「单元格中的富文本」行为一致。

## 使用方式

- **编辑态分段设置**：双击（或 F2）进入单元格编辑后，选中部分字符，再点击工具栏/菜单的加粗、斜体、下划线、字体、字号、字体颜色，或直接按 Ctrl+B / Ctrl+I / Ctrl+U。这些字符级属性会作用于选中片段（切换语义与 Excel 一致：仅当整个选区都带该属性时才取消），整格属性（背景色、对齐、数字格式、换行）仍然作用于整格。
- **编辑栏（fx 栏）分段设置**：单击选中单元格后，直接在编辑栏里选中部分字符，再点工具栏/菜单的字符格式按钮或按 Ctrl+B/I/U——格式直接写入该单元格的 runs（无需进入单元格编辑态），一次撤销可整体恢复。数字格与公式格自动降级为整格格式。
- **纯文本格自动升级**：对普通单元格在编辑中第一次应用字符格式时，编辑器自动从 textarea 切换为富文本编辑器（contenteditable），此后输入的新字符继承光标处的格式（与 Excel 一致）。
- **中文输入法**：编辑器以非受控 DOM 方式管理内容，composition 期间不提交、不重渲染，候选词操作与普通输入一致。

## 数据模型

```ts
interface RunStyle {
  bold?; italic?; underline?; strike?;
  fontSize?; fontFamily?; color?;
  vertAlign?: 'subscript' | 'superscript';
}
interface RichTextRun { text: string; style?: RunStyle }
interface Cell {
  text: string;              // 恒等于 runs 的平铺串
  richText?: RichTextRun[];  // 纯文本格不存（单个无样式 run 不落盘）
  ...
}
```

- `RunStyle` 字段是对整格 `Style` 同名字段的**覆盖**，缺省继承整格样式。
- 纯函数操作集中在 `src/util/richText.ts`（拆分/合并/选区改样式/替换），渲染排版在 `src/renderer/richTextLayout.ts`（canvas 与打印共用）。

## Excel 行为对齐

| 行为 | 本实现 |
| --- | --- |
| 富文本仅对文本常量有效 | 公式/数字格的字符格式按钮自动降级为整格格式 |
| 整格覆盖写入丢弃分段 | 打字替换、清除内容、公式栏提交、外部纯文本粘贴都会清空 runs |
| 替换继承命中处格式 | 查找替换在 run 序列上拼接，未命中片段保留样式，替换文本继承命中首段样式 |
| 排序/公式/CSV 读平铺文本 | 全部下游消费走 `cell.text`，不受 runs 影响 |
| 自动行高按最大字号 | 行高计算使用行内最大 run 字号与共享排版断行 |

## xlsx 往返

- **导入**：从原始 `xl/sharedStrings.xml` 与 `t="inlineStr"` 解析 `<r><rPr>`（SheetJS 会把 runs 压平，因此走 fflate 旁路自解析）；SheetJS 偶发丢格（如 sst 索引 0）时以自解析结果回填。
- **导出**：富文本格写成 `t="inlineStr"` 内联字符串（Excel 原生支持，不触碰 SheetJS 的 sharedStrings）；同时补齐了整格样式（fonts/fills/numFmts/cellXfs）的 styles.xml 写入——此前导出侧样式完全丢失。

## 已知偏差（与 Excel 相比）

1. **公式栏**对文本常量按 runs 渲染（contenteditable），选区内 Ctrl+B/I/U 与工具栏字符格式直接作用于选中分段；多点增删的样式边界推断仍可能不如 Excel 精细。
2. **theme 颜色**（`<color theme="n"/>`）按内置 Office 12 色近似映射，不解析 theme1.xml；`tint` 按 OOXML 公式加深/变浅（仍非真实 theme1 色）。
3. 无选区时的字符格式（typing style）通过编辑器输入拦截实现（不依赖 `document.execCommand`），锁定后续输入的格式；极端 IME 组合下仍可能退化。
4. 双击进入编辑会按点击位置估算光标（含 Alt+Enter 硬换行与 wrap 软换行的 Y 落点）；混合字号/复杂排版仍是近似。
5. 编辑器内粘贴已解析 `text/html` 分段；跨应用 HTML 粘贴会尽量读取 `<td>` 上的粗体/颜色/底色等到单元格样式。复杂 Excel 剪贴板（条件格式碎片、真实 theme 色）仍可能降级。

## 测试

- `test/util/richText.test.ts` — run 模型纯函数
- `test/renderer/richTextLayout.test.ts` — 共享排版
- `test/io/XlsxRichText.test.ts` — xlsx 导入/导出往返
- `test/find/FindReplaceService.test.ts` — 保格式替换
- `test/clipboard/RichClipboard.test.ts` — 剪贴板 HTML 双向
- `test/components/RichEditor.test.tsx` — 编辑器选区改样式
- `test/util/caretHit.test.ts` — 双击多行/换行 caret
- `test/fill/fillSelection.test.ts` — Ctrl+Enter 含 runs
- `test/io/themeTint.test.ts` — theme tint
