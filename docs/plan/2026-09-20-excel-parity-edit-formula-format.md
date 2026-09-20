# Excel 对齐 — 编辑 / 公式 / 格式（已列偏差）

日期：2026-09-20  
范围：只修已列偏差；不做全函数库、不做数据透视/宏/Power Query、不做 Center Across。  
执行：本机 Mac（Cloud Agents 当前套餐不可用）。

## Phase 1 — 编辑 / 富文本 / 交互

| # | 项 | 状态 |
|---|----|------|
| 1 | 工作表「移动或复制」对话框 | 完成 |
| 2 | 公式栏 runs 显示与精细编辑 | 完成 |
| 3 | 双击 caret 混合字号 | 完成 |
| 4 | 无选区加粗等不单靠 execCommand | 完成 |
| 5 | Excel HTML 粘贴主题色等降级减少 | 完成 |
| 6 | 跨应用粘贴尽量保留样式（会话粘贴仍为完整路径） | 完成 |

## Phase 2 — 公式

| # | 项 | 状态 |
|---|----|------|
| 1 | 错误值 #DIV/0! #REF! #VALUE! #NAME? #N/A #NULL! #NUM! | 完成 |
| 2 | 循环引用检测与提示 | 完成 |
| 3 | 高频函数 SUMIF/SUMIFS/COUNTIFS/IFERROR/IFNA/TEXT/VALUE/ROUNDUP/… | 完成 |
| 4 | 更新 docs/guide/formulas.md | 完成 |

## Phase 3 — 格式

| # | 项 | 状态 |
|---|----|------|
| 1 | 删除线 / 文字旋转 / 缩进 | 完成 |
| 2 | 数字格式 [Red]、条件段（locale 仍跳过） | 完成 |
| 3 | 条件格式 cell-value 规则 | 完成 |
| 4 | 数据验证 decimal / text length / custom | 完成 |

## 验收

- `npx tsc --noEmit`
- 相关 vitest 通过
- CHANGELOG + guide 偏差列表与现实一致
