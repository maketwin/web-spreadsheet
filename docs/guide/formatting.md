# 格式化

本章覆盖三种「让单元格更好看 / 更受控」的机制：数字格式、条件格式、数据验证。它们都挂在样式/规则系统上，通过命令修改、可撤销。

## 数字格式

通过 `Style.numberFormat` 字段设置，接受**内置格式名**或 **Excel 自定义格式串**，经工具栏或 `SetNumberFormatCommand` 应用：

```ts
// 数字格式命令（UI 工具栏已接线，类目前未从包根导出）：
// cmdManager.execute(new SetNumberFormatCommand(
//   { r1: 0, c1: 1, r2: 9, c2: 1 },
//   { numberFormat: '#,##0.00' },
// ));
```

### 内置格式（7 种）

| 名称 | 效果示例 |
|------|----------|
| `general` | 原样显示（默认） |
| `number` | `1,234.00`（千分位 + 两位小数） |
| `currency` | `¥1,234.00` |
| `percent` | `12.34%` |
| `date` | `2026-09-11`（按 Excel 日期序列值） |
| `time` | `13:30:00`（小数天数） |
| `scientific` | `1.23E+03` |

### 自定义格式串（Excel 语法）

支持以下要素，与 Excel 的格式代码兼容：

| 要素 | 示例 | 说明 |
|------|------|------|
| 数字占位符 | `0` `#` `?` | 强制位 / 可选位 / 空格占位 |
| 千分位 | `#,##0` | |
| 小数点 | `0.00` | |
| 百分号 | `0.0%` | 数值 ×100 |
| 科学计数 | `0.00E+00` / `0.00E-00` | |
| 日期时间 | `yyyy yy mmmm mmm mm dd hh ss AM/PM` | `mm` 紧邻 `h` 或 `ss` 时解释为分钟 |
| 四段式 | `正;负;零;文本` | 负数段按绝对值渲染；`@` 代表文本 |
| 字面量 | `"元"`、`\x` | 引号包裹或反斜杠转义的字符原样输出 |

常用示例：`#,##0.00`、`0.00E+00`、`yyyy-mm-dd`、`h:mm AM/PM`、`#,##0"元";-#,##0"元";"零"`。

::: warning 暂不支持
`[Red]` 颜色段、`[>100]` 条件段、`[$¥-804]` 这类 locale 货币选择器的实际渲染（`[$...]` 会被跳过）。格式串无法解析时单元格回退显示原文。
:::

### xlsx 往返

数字格式随 xlsx 导入导出**双向保留**：导出时写入 xlsx 单元格的 `z` 字段（内置格式映射为对应 Excel 格式串），导入时从 `z` 字段提取回来。详见[文件 I/O](/guide/io)。

## 条件格式

三种规则类型（`ConditionalRule`），挂在范围上：

| 类型 | 参数 | 效果 |
|------|------|------|
| `dataBar` | `{ min, max, color }` | 按值画数据条，比例 clamp 到 0–1 |
| `colorScale` | `{ min, max, minColor, maxColor }` | 在两个十六进制颜色间按值线性插值背景色 |
| `formula` | `{ formula, style }` | 公式为真时应用样式，公式支持跨 sheet 引用 |

```ts
import { SetConditionalFormatCommand } from 'web-spreadsheet';

// 给 B2:B10 加数据条
ss.cmdManager.execute(new SetConditionalFormatCommand(
  { r1: 1, c1: 1, r2: 9, c2: 1 },
  [{ type: 'dataBar', min: 0, max: 100, color: '#4A90D9' }],
));
```

覆盖层（`ConditionalOverlay`）由 `ConditionalService.computeOverlay(store, r, c)` 实时计算，叠加在单元格原有样式之上；公式求值出错时不产生覆盖层。

## 数据验证

三种规则类型（`ValidationRule`）：

| 类型 | 参数 | 校验逻辑 |
|------|------|----------|
| `list` | `{ values: string[] }` | 值必须在列表内 |
| `integer` | `{ min, max }` | 必须是整数且在区间内 |
| `date` | `{ minDate, maxDate }` | 必须是有效日期且在区间内 |

```ts
import { SetValidationCommand } from 'web-spreadsheet';

ss.cmdManager.execute(new SetValidationCommand(
  { r1: 0, c1: 0, r2: 19, c2: 0 },
  { type: 'list', values: ['高', '中', '低'] },
));
```

校验失败返回中文错误消息，如 `"值 "x" 不在允许列表中"`、`"请输入整数"`、`"请输入有效日期"`。规则存储在 Sheet 上（按范围），可程序化调用：

```ts
import { DataValidationService } from 'web-spreadsheet';

const v = new DataValidationService();
v.validate('中', { type: 'list', values: ['高', '中', '低'] }); // { valid: true }
```
