# 单元格富文本（Rich Text Runs）

单元格内的**部分文字**可以单独设置字体、字号、加粗、斜体、下划线、删除线、颜色与上下标——与 Excel 的「单元格中的富文本」行为一致。

## 使用方式

- **编辑态分段设置**：双击（或 F2）进入单元格编辑后，选中部分字符，再点击工具栏/菜单的加粗、斜体、下划线、字体、字号、字体颜色。这些字符级属性会作用于选中片段，整格属性（背景色、对齐、数字格式、换行）仍然作用于整格。
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

1. **公式栏**显示平铺纯文本，在公式栏提交视为整格替换（Excel 编辑栏显示富文本且可保留分段编辑）。
2. **theme 颜色**（`<color theme="n"/>`）按内置 Office 12 色近似映射，不解析 theme1.xml，忽略 tint。
3. **Ctrl+B/I/U 快捷键**在编辑态不作用于选区（工具栏/菜单按钮可以），仅非编辑态生效。
4. 双击进入编辑时光标定位于末尾，未定位到点击位置。
5. Ctrl+Enter 多格填充使用平铺文本（不带 runs）。
6. 编辑器内粘贴按纯文本处理（不解析剪贴板 HTML 分段）。

## 测试

- `test/util/richText.test.ts` — run 模型纯函数
- `test/renderer/richTextLayout.test.ts` — 共享排版
- `test/io/XlsxRichText.test.ts` — xlsx 导入/导出往返
- `test/find/FindReplaceService.test.ts` — 保格式替换
- `test/clipboard/RichClipboard.test.ts` — 剪贴板 HTML 双向
- `test/components/RichEditor.test.tsx` — 编辑器选区改样式
