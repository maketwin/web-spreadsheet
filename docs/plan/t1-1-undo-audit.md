# T1.1 撤销体系审计矩阵（交接给 Kimi）

> 审计时间：2026-09-11 ｜ 结论：**22 个命令全部已有 `getUndo()` 实现，无缺失**。
> 实际缺口 = ① 7 个命令缺 undo 测试 ② undo 后公式重算联动未验证。

## 命令 × undo 实现 × 测试矩阵

| 命令 | getUndo | undo 测试 | 备注 |
|---|---|---|---|
| CreateChart | ✅ | ❌ | RestoreChart |
| DeleteCol | ✅ | ✅ | 整表快照恢复 |
| DeleteRow | ✅ | ✅ | 同上 |
| FillRange | ✅ | ✅ | |
| InsertCol | ✅ | ✅ | |
| InsertRow | ✅ | ✅ | |
| MoveRange | ✅ | ✅ | |
| **SetAutoFilter** | ✅ | ❌ | 本轮新增，需补测 |
| **SetAutoFilterCriteria** | ✅ | ❌ | 本轮新增，注意 criteria=undefined 还原 |
| SetCellStyle | ✅ | ✅ | |
| SetCellText | ✅ | ✅ | |
| SetColWidth | ✅ | ✅ | |
| SetConditionalFormat | ✅ | ❌ | |
| SetMerge | ✅ | ✅ | |
| SetNumberFormat | ✅ | ✅ | |
| SetRangeBorder | ✅ | ✅ | |
| SetRangeStyle | ✅ | ❌ | |
| SetRangeValues | ✅ | ✅ | |
| SetRowHeight | ✅ | ✅ | |
| SetSparkline | ✅ | ❌ | |
| **SortRange** | ✅ | ❌ | 本轮新增，重点验证行序快照还原 |
| SetValidation | ✅ | ❌ | |

## 待办（分配给 glm-flash，T1.3）
为缺测的 7 个命令补 `test/commands/<Name>.undo.test.ts`：
- [ ] CreateChart / SetAutoFilter / SetAutoFilterCriteria / SetConditionalFormat / SetRangeStyle / SetSparkline / SetValidation / SortRange（共 8 个，SortRange 优先级最高）
- 模式统一：构造 store → 执行命令 → undo → 深比较断言状态全等（参考 `SetRangeValues.test.ts` 现有模式）

## 待办（分配给 Kimi，T1.2）
- [ ] 排查 `src/formula/dependency.ts`：undo 恢复单元格后是否触发依赖重算
- [ ] 集成测试：A1:A3 排序 → undo → 断言 `=SUM(A1:A3)` 及引用 A 列的公式结果恢复
