# 移动端适配（2026-09-28）

范围：触屏/窄屏的"基础可用"档——响应式布局、单指平移、长按菜单、软键盘适配、
触控热区放大。桌面行为零改动（pointer 路径按 pointerType 分流）。

## 已落地

| 项 | 落点 |
|---|---|
| 响应式布局：dvh 视口、`@media (pointer: coarse)` 触控目标 32–36px、`@media (max-width: 768px)` 窄屏压缩、safe-area 底部内边距、`overscroll-behavior: none`、`viewport-fit=cover` + `interactive-widget=resizes-content` | `index.html` |
| 单指拖动 = 平移滚动（此前触摸无法滚动网格）；拖动 6px 滑差后接管，平移不是选区手势 | `CanvasRenderer` pan 状态 |
| 长按 550ms = 上下文菜单（单元格/行列表头自动路由）；移动 12px、第二根手指、抬起均取消；对象拖拽（移动/填充/调宽高）期间不触发 | `CanvasRenderer.fireLongPress` |
| sheet 标签长按 = 标签菜单；长按后跟随的合成 click 被吞掉（否则 window click 监听把菜单秒关） | `BottomBar.tsx` |
| 触控热区：填充柄命中容差 +18px、行高列宽边框命中容差 +18px（仅 pointerType touch/pen） | `FillHandle` / `ResizeHandler` |
| 软键盘：`visualViewport` resize/scroll → `scrollCellIntoView(r, c, 可视高度)` 把编辑中的单元格滚到键盘上方，并 bump 布局让编辑浮层重定位 | `CanvasRenderer.scrollCellIntoView` + `Spreadsheet.tsx` 同步 effect |
| 既有：双指捏合缩放（修复：pinchBase 单位错误——zoom() 是小数、onZoomTo 要百分比，捏合一直被钳到下限 50%）、双 tap 双击、Pointer 分流 | `CanvasRenderer` |

测试：jsdom 手势单测（`test/renderer/TouchGestures.test.ts` 8 条）、BottomBar 长按
4 条、FillHandle 容差 1 条；Playwright `chromium-touch` project（390×844）5 条
剧本（点选/双击编辑/长按菜单/平移/捏合/标签长按）。桌面 8 条 e2e 回归无变化。

## 触摸选区的刻意取舍

单指拖动改为平移后，**触摸下没有"拖拽拉框选区"**（与 Excel/Sheets 移动端一致，
它们用点选后出现的选择手柄）。补齐选区能力需要渲染选择手柄 + 手柄拖拽命中，
属于下一档（Excel 移动级）的工作。当前触屏选区途径：点选、行/列表头拖选、
填充柄拖拽、双击编辑、名称框跳转。

## 真机 QA 清单（无头浏览器覆盖不了的部分）

- [ ] **iOS Safari**：编辑单元格唤起软键盘后，编辑框滚动到键盘上方可见（visualViewport 同步）；键盘收起后浮层位置正常。
- [ ] iOS Safari：双 tap 打开编辑器（合成 dblclick）；捏合缩放跟手、与页面缩放不冲突。
- [ ] **Android Chrome**：长按单元格弹菜单时**不**同时弹出浏览器原生文字选择/菜单；长按 sheet 标签同。
- [ ] Android Chrome：地址栏收展（dvh）时网格不出现空白条。
- [ ] **嵌入式 webview**（产品主战场）：rc-motion 离场冻结补丁（菜单/模态）在触屏 webview 内依旧生效——打开右键族菜单（长按触发）后点画布、点菜单项、Esc 关闭；关闭保护/查找对话框后整页可交互。
- [ ] 平板（iPad）：`pointer: coarse` 目标放大不破坏工具栏布局；横竖屏切换后画布尺寸自适应（ResizeObserver 路径）。
- [ ] 触摸惯性：当前平移为 1:1 跟手、无惯性——真机评估是否可接受（下一档可加动量）。
- [ ] 双指捏合时页面橡皮筋（iOS overscroll）不触发。
- [ ] 触屏输入法（中文）在编辑器中的 composition 正常上屏。
