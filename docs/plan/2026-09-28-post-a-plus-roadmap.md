# Post-A+ 计划：补齐最后 10%（2026-09-28）

基线：176 文件 / 1117 测试全过；src 覆盖 92.3%；React 19.3 + antd 6.6.5；
完成度评估 ≈90%。本计划按价值/依赖排序，每项含验收标准。

## P0-1 数组公式溢出（spill）— 唯一的硬功能缺口

Excel 365 动态数组语义：`XLOOKUP`/`FILTER`/`SEQUENCE` 等返回多格结果时写入
以公式格为锚的溢出区域；区域被占用显示 `#SPILL!`；删除/修改阻塞格后自动
重算；源公式删除或移动时溢出区收缩清空。

实施顺序：
1. `FormulaEngine` 求值结果支持矩阵值（Value 类型扩展 `MatrixValue`）
2. `Store` 溢出区登记（每 sheet 一张 anchor→range 表），写入溢出格为
   "shadow" 单元格（引用锚点、不占 undo 独立步）
3. 依赖图：溢出区单元格入图，阻塞格变更触发锚点重算
4. 渲染：溢出区细边框（Excel 蓝色 accent），`#SPILL!` 错误值
5. 序列化/IndexedDB round-trip 溢出表
6. Excel 行为对齐测试：占据→报错→清障→恢复→删源→收缩

验收：`=SEQUENCE(3,3)`、`=FILTER(A:A,A:A>2)` 全链路 + undo；
xlsx 导入端不做溢出（Excel 已算好值，作为静态值导入）。

预估：3–5 个工作日，是本计划唯一的"功能"项。

## P1-2 Spreadsheet.tsx 拆分二期（1449 → ≤900 行）

- `handleCanvasKeyDown` 分发（约 90 行）+ `handleCanvasAction`（约 80 行）
  → `src/components/keyboard.ts`（纯函数，可单测按键→action 映射）
- 菜单/图表/图片接线 props → `useSpreadsheetWiring` hooks
- 验收：主文件 ≤900 行；键盘映射表单测覆盖 40+ 快捷键；全量测试绿

## P1-3 PrintPipeline 补测（19.5% → ≥80%）

分页编排（printPages/renderPrintPages）纯函数路径：纸张/方向/边距/缩放
组合的分页断点、打印区域裁剪、页眉页脚 `{page}/{pages}/{sheet}` 替换。
jsdom + stub ctx（PrintPainter.test 模式）。

## P1-4 右键菜单族 e2e（Playwright + 真浏览器）

背景：jsdom 无法测 ContextMenu（右键）、行列头菜单、迷你图、分列对话框
的完整交互（antd 弹层 actionability 需要 force/CDP 策略）。
- 建 `e2e/` 目录：Playwright config（chromium headless）+ 8 条核心剧本
  （单元格右键菜单、sheet 标签右键、移动/复制、隐藏行列、迷你图插入、
  分列、数据验证、图标集）
- CI 可选跑（本地 `pnpm e2e`）
- 顺带解决 Playwright 对本项目 antd 弹层的 actionability 策略并记录

## P2-5 文档补课

- ROADMAP.md 增补 v2.x 已完成段落（hyperlinks/CF/name manager/行组/
  打印/保护/依赖栈），勾选现状
- PLAN.md 历史勾选清理或加"已全部完成"注记
- ARCHITECTURE.md 增 EditorOverlay 拆分后的组件图
- CHANGELOG 发布段整理（升级 antd6/React19 为 v2.1.0 候选）

## P2-6 小项（各半天内）

- 多 sheet 打印（打印对话框"整个工作簿"选项）
- 填充拖拽 mouseup 后选区落在填充结果区（GUI 观察项，先复现再修）
- `formulaAssist.ts` 64% / `useClipboardSession` 66% 补测到 80%
- demo 首屏提示条：IndexedDB 恢复失败时的可见错误（现在只有 console）

## 不做（范围外）

评论/批注（产品已决策移除）、协同编辑、宏/VBA、移动端触控手势。

## 里程碑

- M1（P0-1 完成）：v2.1.0 —— spill 数组 + 文档，对外发版
- M2（P1 全完成）：内部质量版，e2e 上 CI
- M3（P2 全完成）：≈97%，剩余为长期对齐项
