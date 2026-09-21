# Excel 对齐 — 热门功能缺口（下一轮）

日期：2026-09-20  
前置：`37d5310` 已收口编辑/公式/格式「已列偏差」（见 `2026-09-20-excel-parity-edit-formula-format.md`）。  
原则：只补日常高频、与 Excel 行为对齐的能力；**不加**产品级新范式。  
执行：本机 Mac（Cloud Agents 当前套餐不可用）；改完再统一 commit / push。

## 明确不做（本轮与后续默认排除）

| 项 | 原因 |
|----|------|
| 数据透视表 | 体量大，另立项 |
| Power Query / 获取数据 | 另立项 |
| 宏 / VBA / LAMBDA 生态 | 另立项 |
| Excel 表（ListObject）整套 + 结构化引用 | 另立项（可进 Phase E 评估） |
| 动态数组溢出（`FILTER`/`UNIQUE`/`SORT`/`SEQUENCE` 完整 spill） | 另立项 |
| Center Across Selection | 曾明确跳过 |
| 全函数库扫尾 | 只补本表列出的高频函数 |
| 协同编辑 / 实时多人 | 不在本产品范围 |
| 批注 / 备注 / 现代评论线程 | **明确不做**（2026-09-20） |

## 现状速览（已有，不重复做）

- 数据：自动筛选、清除/重应用、升/降序、数据验证（含 decimal / textLength / custom）
- 插入：图表（柱/线/饼）、迷你图、插删行列
- 公式：`VLOOKUP`、`SUMIF(S)`/`COUNTIF(S)`、`IFERROR`/`IFNA`、基础统计/文本/日期、`INDEX`/`MATCH`
- 编辑：选择性粘贴、格式刷、查找替换、富文本、冻结、合并、保护工作表
- 格式：条件格式数据条 / 色阶 / 单元格值 / 公式条件

## 总览

| Phase | 主题 | 价值 | 预估体量 |
|-------|------|------|----------|
| A | 高频公式补齐 | 查找/汇总/拼接日常立刻可用 | 中 |
| B | 数据工具 | 清洗表：删重复、分列 | 中 |
| C | 超链接（**不做批注**） | 导航刚需 | 中 |
| D | 条件格式加深 | 图标集 + 规则管理 | 中 |
| E | 体验收口 | 名称管理器、文档纠偏、小缺口 | 小～中 |

建议顺序：**A → B → C → D → E**。A/B 可并行评估；**批注/备注已明确不做**；C 仅超链接（可整段跳过直接进 D）。

---

## Phase A — 高频公式补齐

目标：补齐「查表 / 条件平均 / 筛选后汇总 / 文本拼接」四类最高频缺口。

| # | 项 | Excel 对齐要点 | 主要落点 | 状态 |
|---|----|----------------|----------|------|
| A1 | `HLOOKUP` | 与现有 `VLOOKUP` 对称；`range_lookup` 精确/近似 | `evaluator.ts`（可复用 vlookup 二维表逻辑）、`registry` 若需登记、测例 | 完成 |
| A2 | `XLOOKUP` | 默认精确；`if_not_found`；可选匹配模式先做 exact + 通配（`*`/`?`）；不实现动态数组 spill 返回多列时可先限单列/单值 | `evaluator` 专用分支、guide | 完成 |
| A3 | `AVERAGEIF` / `AVERAGEIFS` | 条件语义对齐 `SUMIF(S)`/`COUNTIF(S)`（已有 criteria 解析尽量复用） | `registry.ts` + 共用 criteria 工具 | 完成 |
| A4 | `SUBTOTAL` | 功能号 1–11 / 101–111；**忽略筛选隐藏行**（与当前 AutoFilter 联动） | `registry` + 读 filter 隐藏行 API；测例含「筛选后平均值」 | 完成 |
| A5 | `TEXTJOIN` | `delimiter`、`ignore_empty`、多参数/区域展平 | `registry.ts` | 完成 |
| A6 | 文档 | 更新 `docs/guide/formulas.md` 函数表与「已知限制」；去掉已过时描述 | guide + CHANGELOG | 完成 |

### A 验收

- [ ] 上表函数均有 vitest（含典型边界：`#N/A`、空、通配、筛选隐藏）
- [ ] `npx tsc --noEmit`
- [ ] demo 手工：`XLOOKUP` 精确命中 / 未命中回落；筛选后 `SUBTOTAL(101, …)` ≠ `AVERAGE`

### A 风险

- `XLOOKUP` 参数面大：本轮**不做** search mode 二分、不做返回多单元格 spill；多列返回可降级为 `#SPILL!` 或只取首列并在 guide 写明。
- `SUBTOTAL` 必须接到真实隐藏行来源（filter + 手动隐藏），测例要覆盖两种。

---

## Phase B — 数据工具（删除重复 / 分列）

目标：数据菜单补上清洗表最高频两项，交互贴近 Excel 对话框，不做 Power Query。

| # | 项 | Excel 对齐要点 | 主要落点 | 状态 |
|---|----|----------------|----------|------|
| B1 | 删除重复项 | 对话框：列勾选、是否有标题行；在选区（或当前区域）内删行；可撤销；公式引用按「删行」语义重映射（复用 `rowMoveRefs` / 插删行路径） | 新 dialog + command；`MenuBar` `data:removeDuplicates`；Store/SheetData | 完成 |
| B2 | 分列（Text to Columns） | 向导简化为**两步**：分隔符（Tab/分号/逗号/空格/自定义）或固定宽度可二期；结果写入右侧列；可选「逐列数据类型」先做通用/文本；可撤销 | 新 dialog + command；选区首列源 | 完成 |
| B3 | 菜单与快捷入口 | 数据 → 删除重复项… / 分列…；必要时右键数据区入口（可选） | `MenuBar` dataItems | 完成 |
| B4 | 文档 | `docs/guide/data-features.md` 增节 | guide + CHANGELOG | 完成 |

### B 验收

- [ ] 删除重复：标题行开/关、多列组合键、空行、撤销恢复单元格与公式引用
- [ ] 分列：逗号/Tab 分隔、保留左侧原文或覆盖策略与 Excel 默认一致（写入前确认/覆盖右侧）
- [ ] tsc + 相关 vitest；demo 冒烟

### B 风险

- 删行与合并单元格、筛选隐藏行的交集：若选区含合并，对齐 Excel「拒绝或先拆分」——实现前用 Excel 对一下，写进 dialog 文案。
- 分列固定宽度、日期识别可列为 B2.1 可选，不挡主路径。

---

## Phase C — 超链接（批注已取消）

目标：仅单元格超链接可创建/编辑/打开/删除；**不做批注/备注/线程评论**（产品明确排除）。

| # | 项 | Excel 对齐要点 | 主要落点 | 状态 |
|---|----|----------------|----------|------|
| C1 | 数据模型（仅超链接） | `hyperlink?: { target, tooltip? }`；**无 comment 字段** | `types.ts`、`SheetData` serialize | 完成 |
| C2 | 批注 UI | — | — | **取消**（不做） |
| C3 | 超链接 UI | 插入/编辑/打开（http/mailto/表内引用）；Ctrl+单击打开；下划线+主题色 | dialog + 点击手势 | 完成 |
| C4 | 命令与撤销 | `SetHyperlink` / `ClearHyperlink` only | `commands/` | 完成 |
| C5 | xlsx I/O | 导入导出 hyperlinks（SheetJS 能力内）；批注不写 | `src/io/` | 完成 |
| C6 | 文档 | data-model / keyboard / CHANGELOG（注明无批注） | docs | 完成 |

### C 验收

- [ ] 超链接打开外链（新标签）与表内跳转；复制粘贴是否带链接：本轮定「带」或「不带」并测
- [ ] xlsx 往返至少覆盖「纯文本批注 + http 链接」黄金样例
- [ ] tsc + vitest

### C 风险

- SheetJS 对 notes/comments 支持参差：先保证内建 serialize，xlsx 能做多少做多少，剩余标为已知偏差。
- **批注/备注：已取消，不实现。**

---

## Phase D — 条件格式加深

目标：在现有四种规则之上补「图标集」与「管理规则」，不重做引擎。

| # | 项 | Excel 对齐要点 | 主要落点 | 状态 |
|---|----|----------------|----------|------|
| D1 | 图标集 | 3/4/5 档常用套件（先做 3 色箭头或 3 灯）按百分位或数值阈值；canvas 绘图标 | `conditional/*`、`CanvasRenderer`、菜单 | 完成 |
| D2 | 管理规则对话框 | 列出当前表（或选区）规则、启停、删除、优先级上/下移 | 新 dialog + `ConditionalService` API | 完成 |
| D3 | 文档与测例 | formatting / data-features 交叉引用 | docs + tests | 完成 |

### D 验收

- [ ] 图标集在数值列上观感接近 Excel（允许像素级差异）
- [ ] 管理器可删/停用并撤销（若规则变更走 command）
- [ ] tsc + vitest

### D 风险

- 图标资源：用 canvas path / emoji / 小型 SVG 数据 URI，避免外链字体图标授权问题。

---

## Phase E — 体验收口（小缺口）

| # | 项 | 说明 | 状态 |
|---|----|------|------|
| E1 | 名称管理器 | 已有 `namedrange` 服务与名称框跳转；补「公式 → 名称管理器」列表/新建/删除/引用编辑 | 完成 |
| E2 | 文档纠偏 | `docs/guide/rich-text.md`「已知偏差」已落后于 `37d5310`（公式栏 runs、typing style、混合字号）；改成与现实一致 | 完成 |
| E3 | `INDIRECT` / `OFFSET`（可选） | 若 A 完成后仍高频被要再开；本轮默认**可选** | 延期（可选，本轮未开） |
| E4 | CF「突出显示单元格」快捷 | 大于/小于/介于/等于 向导（可复用 cellValue） | 完成 |

---

## 里程碑与提交策略

1. **A 单独 commit**：`feat(formula): XLOOKUP/HLOOKUP, AVERAGEIF(S), SUBTOTAL, TEXTJOIN`
2. **B 单独 commit**：`feat(data): remove duplicates + text to columns`
3. **C（可选）**：仅 hyperlinks 一个 commit；若跳过 C 则直接 D
4. **D / E** 各自 commit
5. 每阶段末：`tsc` + 相关 vitest + 更新 CHANGELOG + 对应 guide；**不强制每阶段 push**，也可阶段末 push 一次。

## 建议的第一刀

若只开一刀：**Phase A（高频公式）**——无 UI 大改、测例好写、立刻提升「能算 Excel 表」的体感。  
第二刀：**Phase B（删除重复 + 分列）**——数据菜单从「筛选排序」补成「能清洗」。

## 验收总清单（整轮结束时）

- [ ] 本文件各 Phase 状态列更新为「完成」或「取消/延期」并写原因
- [ ] `npx tsc --noEmit` 全绿
- [ ] 新增/相关 vitest 全绿
- [ ] CHANGELOG + formulas / data-features / data-model / rich-text 与代码一致
- [ ] demo `:3010` 按各 Phase 验收项冒烟一遍
