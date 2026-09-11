# 第一梯队功能补全计划：撤销联动 / 智能填充 / 自定义数字格式

> 日期：2026-09-11
> 范围：第一梯队缺口第 2、3、4 项
> 执行模式：**主任务 → Kimi**（架构设计、核心算法、复杂联动）；**简单任务 → glm-flash**（枚举式补全、机械测试、文档）
> 验收基线：`npx tsc --noEmit` 通过 + `npx vitest run` 全绿 + `npm run lint` 无错

---

## 现状摘要（已核实）

- **撤销**：`src/commands/Command.ts` 已有 `getUndo()` 抽象 + `UndoCommand` 机制；新增命令（`SetAutoFilter`/`SetAutoFilterCriteria`/`SortRange`）需逐一核查是否实现反向命令；公式重算与 undo 的联动未确认。
- **填充**：`src/fill/FillHandle.ts` 已有拖拽手柄（含 Ctrl 复制语义），但 `onFill` 回调背后的填充逻辑需确认是否支持智能序列（数字递增、日期、月份、公式相对引用）。
- **数字格式**：`src/format/NumberFormatter.ts` 仅 74 行，硬编码 6 种枚举格式（`Intl.toLocaleString` 实现），不支持自定义格式串；`Style.numberFormat` 是联合类型枚举，需扩展为支持任意字符串。

---

## 任务一：撤销/重做完整性 + 公式重算联动

### T1.1 [Kimi｜主任务] 撤销体系审计与补齐
- 输出一份命令清单矩阵：每个 `src/commands/impl/*` 命令 ×（是否有 undo / undo 是否完整还原 / 是否有对应测试）。
- 为新命令 `SetAutoFilter`、`SetAutoFilterCriteria`、`SortRange` 补齐 `getUndo()`：
  - `SortRange` 的 undo 需保存排序前行序快照（参考 `sheetSnapshot.ts`）。
  - `SetAutoFilterCriteria` 的 undo 需还原旧 criteria（含 undefined 情况）。
- 统一约定：undo 后必须触发与正向执行相同的 store 事件，保证渲染/依赖方刷新。

### T1.2 [Kimi｜主任务] Undo 与公式重算联动
- 现状排查：`src/formula/dependency.ts` 的依赖图在 undo 恢复单元格值后是否触发重算。
- 设计：undo 恢复 cell 后走与 `SetCellText` 相同的重算入口，保证公式单元格值一致。
- 边界：undo 一次排序后，引用被排序区域的公式结果必须恢复。

### T1.3 [glm-flash｜简单任务] Undo 测试补全
- 按 T1.1 的矩阵，为每个命令补"执行→undo→断言状态全等"的机械测试。
- 命名：`test/commands/<CommandName>.undo.test.ts`。
- 依赖：需 T1.1 完成后开工。

### 验收
- [ ] 所有命令均有 undo 测试且通过
- [ ] 排序/筛选 undo 后公式结果与排序前一致（新增集成测试）

---

## 任务二：填充柄智能序列

### T2.1 [Kimi｜主任务] 序列推断引擎 `src/fill/series.ts`
- 输入：源区域值序列 + 方向；输出：目标单元格的填充值。
- 支持序列类型（对齐 Excel 行为）：
  1. 数字等差（单值默认复制，Ctrl 切换递增；两值以上按公差推断）
  2. 日期/时间序列（日、工作日、月、年递增）
  3. 内置文本序列（Mon..Sun、Jan..Dec、中英文星期/月份）
  4. 文本+数字混合（`Item1 → Item2`）
  5. 公式相对引用平移（复用现有 parser 做引用偏移）
- 纯函数、无 UI 依赖，便于测试。

### T2.2 [Kimi｜主任务] FillHandle 接入 + 双向填充
- 把 `onFill` 回调接到 T2.1 引擎；生成 `FillRange` 命令（保证可 undo）。
- 支持向上/向左拖拽反填；多行多列源区域按列/行分别推断。

### T2.3 [glm-flash｜简单任务] 序列测试用例
- 按 T2.1 的 5 类各写枚举式用例：`test/fill/series.test.ts`。
- 每类至少 5 组（含边界：跨年、月末、空值混入）。
- 可与 T2.1 并行开工（先写测试即 TDD）。

### 验收
- [ ] 数字/日期/文本序列/公式平移填充结果与 Excel 一致
- [ ] 填充可 undo，一次拖拽 = 一次 undo 步进

---

## 任务三：自定义数字格式串

### T3.1 [Kimi｜主任务] 格式串解析器 + 求值器 `src/format/CustomFormat.ts`
- 支持子集（先覆盖用户高频，语法对齐 Excel）：
  - 数字：`0`、`#`、`?`、`,`（千分位）、`.`、 `%`、`E+00`
  - 分节：`正数;负数;零;文本`（至少支持前两节）
  - 颜色与条件可后置（本期不做 `[Red]`/`[>100]`，留扩展点）
  - 日期：`yyyy`/`yy`、`mm`/`mmm`、`dd`、`hh`、`ss`、`AM/PM`（注意 mm 上下文歧义：邻近 h 为分钟）
  - 字面量转义：`"text"`、`\x`
- 架构：`Style.numberFormat` 从枚举扩展为 `string`（保留旧枚举值为合法格式串别名，保证向后兼容与 xlsx 互操作）。
- `formatValue` 改为：内置枚举走快路径，其余走自定义解析（带编译缓存）。

### T3.2 [Kimi｜主任务] 联动改造
- `types.ts` 类型扩展 + `CanvasRenderer`/`NumberFormatter`/`XlsxImporter`/`XlsxExporter` 全链路贯通（导入 xlsx 的 numFmt 直接保留格式串）。
- UI：`FormatMenu` 增加常用自定义格式项 + 自定义输入。

### T3.3 [glm-flash｜简单任务] 格式串测试矩阵
- `test/format/CustomFormat.test.ts`：按 T3.1 语法点逐条枚举用例（正值/负值/零/文本 × 各格式串）。
- 参考用例可直接从 Excel 行为抄：`#,##0.00`、`0.0%`、`yyyy-mm-dd`、`h:mm AM/PM`、`0.00E+00`。
- 可与 T3.1 并行开工（TDD）。

### 验收
- [ ] 上述 5 个代表性格式串渲染与 Excel 一致
- [ ] xlsx 导入导出自定义格式串不丢失（round-trip 测试）
- [ ] 旧枚举格式行为不变（回归测试）

---

## 排期与分工总览

| 阶段 | Kimi（主） | glm-flash（辅） | 产出 |
|---|---|---|---|
| 1 | T1.1 + T1.2 | — | 撤销矩阵 + 联动修复 |
| 2 | T2.1 + T2.2 | T1.3（阶段1后）、T2.3（并行） | 智能填充 |
| 3 | T3.1 + T3.2 | T3.3（并行） | 自定义数字格式 |

**依赖顺序**：T1.3 ← T1.1；其余 glm-flash 测试任务均可与对应主任务并行（测试先行）。
**建议分支**：`codex/undo-recalc`、`codex/fill-series`、`codex/custom-numfmt`，各自独立 PR。
