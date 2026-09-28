# Roadmap

## v0.1 — Foundation (Week 1)
- [x] Vite + vitest + TS strict
- [x] Dark mode
- [x] Domain types

## v0.5 — Data Layer (Week 2-3)
- [x] Store (reactive, snapshot)
- [x] Command + CommandManager
- [x] 5 core commands
- [x] EventBus

## v1.0 — Renderer + Formula + Plugin (Week 4-7, released)
- [x] VirtualScroller
- [x] DirtyRegionTracker
- [x] CanvasRenderer
- [x] 5 UI components (Toolbar/BottomBar/Editor/Menu/Spreadsheet)
- [x] Formula engine v1 (32 functions)
- [x] Dependency graph
- [x] PluginManager + PluginAPI
- [x] CsvImport example
- [x] ARCHITECTURE.md
- [x] v1.0 release

## v1.1 — Persistence & I/O (2026-07-01, released)
- [x] Auto-save to IndexedDB (Dexie) + startup restore
- [x] Real xlsx import/export (SheetJS)
- [x] Status bar (selection stats, zoom, autosave state)
- [x] IME-aware cell editor
- [x] Sticky sheet tabs

## v1.5 — Docs & Polish (2026-07-02, released)
- [x] React ErrorBoundary
- [x] Accessibility: ARIA roles, keyboard navigation, focus-visible
- [x] 10k-row virtual scroll benchmark
- [x] VitePress documentation site (GitHub Pages)

## v2.0 — Rendering Overhaul & Excel Parity (2026-07 → 08, released 2.0.0)
- [x] Rendering engine overhaul: AxisIndex O(log n) lookups, dirty-rect invalidation, freeze quadrants
- [x] Clipboard session + marching ants; session paste with formula-reference shifting
- [x] Keyboard parity: Enter commits & moves, F2 edit mode, End mode, Ctrl+; / Ctrl+1 / Ctrl+PgUp/PgDn, Alt+=, two-stage Ctrl+A
- [x] Formula point mode + F4 `$`-anchor cycling
- [x] Multi-selection (Ctrl+click/drag), multi-area delete
- [x] Find & Replace rebuilt: regex, workbook scope, find-all list, counted replace-all
- [x] Printing rebuilt: PrintPaginator / PrintPainter / PrintPipeline, print preview, `@page` injection
- [x] Charts (Chart.js) + in-cell sparklines (line/bar/win-loss)
- [x] CSV export (BOM'd UTF-8, displayed values) + GBK smart decode on import
- [x] Hide/unhide rows & columns (undoable commands)
- [x] Editable name box (ranges / `Sheet2!A1` / defined names)
- [x] Trackpad pinch zoom (Ctrl+wheel, 50–200%)
- [x] Hot formulas +24: SUMPRODUCT, XLOOKUP, SUBTOTAL, TEXTJOIN, DATEDIF, RANK.EQ, STDEV.S/P, MAXIFS/MINIFS, ROW/COLUMN …
- [x] Array-aware binary operators (`SUMPRODUCT((区域="x")*区域)`)

## v2.2 — Mobile Adaptation（2026-09-28，当前）
- [x] 响应式布局：dvh、pointer:coarse 触控目标、窄屏压缩、safe-area（docs/plan/2026-09-28-mobile-adaptation.md）
- [x] 触摸手势：单指平移滚动、长按上下文菜单（画布 + sheet 标签）、双指捏合修复（pinchBase 单位 bug）、双 tap 编辑
- [x] 触控热区：填充柄/行列边框命中容差放大（touch/pen 专属）
- [x] 软键盘适配：visualViewport → scrollCellIntoView 编辑格滚动到键盘上方
- [x] Playwright chromium-touch project（390×844）5 条手势 e2e + jsdom 手势单测
- [ ] 真机 QA 清单执行（iOS Safari / Android Chrome / 嵌入式 webview，见 plan 文档）
- [ ] 下一档（Excel 移动级）：触摸选择手柄、平移动量、移动端底部公式栏

## v2.1 — Parity Completion（2026-09-28，released）
- [x] Rich text: in-cell runs, formula-bar edits, theme tints, Ctrl+Enter fill
- [x] Hyperlinks: insert / Ctrl+click / paste / fill, SheetJS round-trip (comments removed by product decision)
- [x] Conditional formatting: icon sets, highlight shortcuts, 管理规则 dialog (single-step undo)
- [x] Name manager dialog (公式 → 名称管理器)
- [x] Row groups: outline expand/collapse, intersect-aware
- [x] Sheet protection (hashed password, edit-entry guard)
- [x] Sheet Move or Copy dialog; tab drag reorder + tab color
- [x] Data tools: 删除重复项 / 分列 (undoable commands)
- [x] Formula registry 32 → 76 functions; dynamic-array spill — SEQUENCE/FILTER/UNIQUE/SORT/XLOOKUP vectors, `#SPILL!`, shadow cells + serialization
- [x] antd 5 → 6.6.5, React 18 → 19.3 (SDK peer stays `react >= 18`)
- [x] Spreadsheet.tsx split phase 2 → `keyboard.ts` + `spreadsheetActions.ts` (React-free, unit-tested)
- [x] PrintPipeline coverage 19.5% → 97.7% (suite 179 files / 1149 tests)
- [x] Playwright e2e scaffolding + 8 context-menu/dialog scripts (`pnpm e2e`)

### v2.1 收尾项（post-A+ 计划，2026-09-28 全部完成）
- [x] Spreadsheet.tsx 三期拆分 → 811 行（InteractionToolbar / useCanvasRenderer / formulaSync / workbookInit / applyMoveOrCopySheet 各自成文件）
- [x] `formulaAssist` 98.3% / `useClipboardSession` 100% 补测（含 stripLiterals 相邻字面量吞分隔符修复）
- [x] 多 sheet 打印（打印对话框「整个工作簿」，跨表全局 {page}/{pages}）；填充拖拽选区落在填充结果区（Excel 对齐）
- [x] demo IndexedDB 恢复失败可见提示条 + 一键清除本地存档
