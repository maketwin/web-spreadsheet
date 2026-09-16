# 文件 I/O 与持久化

## xlsx 导入导出

基于 SheetJS（`xlsx` 库）实现真实的 Excel 文件读写，位于 `src/io/`。

### 导出

```ts
import { exportXlsx, exportXlsxBuffer } from 'web-spreadsheet';
```

::: warning
`exportXlsx` / `exportXlsxBuffer` / `importXlsx` 目前是内部实现，**未从包根导出**——UI 的「文件 → 下载 xlsx」已自动接线。下表说明能力边界，深层次定制请关注仓库后续版本。
:::

| 能力 | 支持情况 |
|------|----------|
| 多 Sheet | ✅ 每个 sheet 一张表，保留 sheet 名 |
| 公式 | ✅ 写入 `f` 字段（缓存值随行，Excel 打开后重算） |
| 数字格式 | ✅ 写入 xlsx 单元格 `z` 字段；内置格式映射：`number→#,##0.00`、`currency→¥#,##0.00`、`percent→0.00%`、`date→yyyy-mm-dd`、`time→hh:mm:ss`、`scientific→0.00E+00` |
| 合并单元格 | ✅ 写入 `!merges` |
| 单元格样式 | ❌ 不导出（SheetJS 社区版限制） |

产出标准 xlsx 二进制（MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`），UI 下载为 `workbook.xlsx`。

### 导入

```ts
const imported: SerializedStore = importXlsx(buffer);
store.replaceAll(imported);  // 整体热替换当前工作簿
cmdManager.clear();          // Excel 语义：打开文件不可撤销
```

| 能力 | 支持情况 |
|------|----------|
| 多 Sheet | ✅ 全部导入，sheet 名保留（含中文名） |
| 公式 | ✅ 读 `f` 字段写入 `cell.formula`，缓存值随行，UI 公式引擎接管重算 |
| 数字格式 | ✅ 从 `z` 字段提取进 `style.numberFormat`；与内置格式等价的反向映射回枚举名（`#,##0.00→number` 等），其余作为自定义格式串 |
| 日期 | ✅ 保留 Excel 序列值 + 日期格式识别（`cell.type='date'`），渲染层按格式显示 |
| 布尔 / 错误 | ✅ `TRUE/FALSE` 与 `#DIV/0!` 等错误字面量 |
| 合并单元格 | ✅ 读 `!merges` |
| 单元格样式 | ✅ 粗体/斜体/下划线/字号/字体/文字颜色/实底背景色/水平垂直对齐/自动换行；含「有样式无内容」的空单元格（从原始 sheet XML 的 `s` 属性恢复样式索引，再映射 SheetJS 解析好的 styles.xml 字体/填充/对齐表） |
| 行高 / 列宽 | ✅ `!rows` / `!cols`（含隐藏标记） |

- UI 的「导入 xlsx」用 `Store.replaceAll` 热替换整个工作簿并清空撤销历史（Excel 打开文件同样不可撤销）；解析失败弹错误提示。
- 已知限制：图表、条件格式、数据验证、筛选状态、边框与主题色（theme/indexed 非实底填充）不导入。
- 文件选择器接受 `.csv .tsv .xlsx .json`。

## CSV / TSV / JSON

| 方向 | 格式 | 机制 |
|------|------|------|
| 导入 | CSV / TSV | 文本按行、按 Tab 切分写入（CSV 的逗号先统一替换为 Tab）；**不支持引号包裹字段** |
| 导入 | JSON | 以 `{` 开头按 JSON 解析，走 `Store.deserialize` 后拷入当前 store |
| 导出 | JSON | `JSON.stringify(store.serialize(), null, 2)`，下载为 `workbook.json` |
| 导出 | CSV / TSV | ❌ 暂无导出（复制到剪贴板时是 TSV 格式，可粘贴到文本编辑器） |

## 剪贴板（TSV + HTML 双格式）

`ClipboardService`（全静态方法，已从包根导出）实现跨应用复制粘贴：

```ts
import { ClipboardService } from 'web-spreadsheet';

await ClipboardService.copy(store, range); // 写入 text/plain（TSV）+ text/html（<table>）
await ClipboardService.read();             // 优先 HTML（保结构），降级纯文本 → Cell[][]
ClipboardService.parseText(text);          // TSV 文本 → Cell[][]
ClipboardService.parseHtml(html);          // <table> → Cell[][]
```

- 复制时优先用 `ClipboardItem` 双写富文本与纯文本，环境不支持时降级 `writeText`。
- 粘贴以 HTML 优先（`parsePaste`），因此从 Excel / 网页表格粘贴能保留行列结构；纯文本降级按 TSV 解析。
- 粘贴只带文本内容，不带样式与公式；天然支持跨 sheet、跨应用粘贴。
- **平铺粘贴**（Excel 同款）：目标选区行、列都是源块整数倍时（如 2×3 份），整块重复填充；否则只粘贴一份。

### 应用内剪贴板会话（蚂蚁线）

复制/剪切除了写系统剪贴板，还会在应用内建立一个**剪贴板会话**（内置 UI 的行为；`ClipboardService` 本身保持无状态）。会话快照保存完整的单元格（含样式与公式），因此会话粘贴比系统剪贴板粘贴保留更多语义：

- 复制/剪切后，源区域显示 Excel 风格的**蚂蚁线**（流动虚线框），并在与选中范围重合时**替换选区实线边框与填充柄**——与 Excel 视觉一致，填充柄与边框拖拽此时不可用；
- 粘贴优先使用会话快照；没有会话时读系统剪贴板（跨应用粘贴，见上节）；
- **复制**会话粘贴时公式引用随目标平移（相对引用，`$` 绝对引用不动）、样式随行；
- **剪切**是移动语义——粘贴落地时才清空源区域，公式**原样保留**（引用不平移），且只能粘贴一次；
- 粘贴**完全替换**目标单元格：残留的旧公式、值、样式一并清除，不与源合并；
- 目标是源的整数倍时同样平铺，且每一块的公式按各自位置独立平移；
- 会话激活时按 `Enter` 直接粘贴一次并结束会话；
- 取消会话的方式：`Esc`，或开始编辑（进入编辑即取消）；
- 再次复制/剪切会以新范围重建会话。

#### 多选区复制（Ctrl+点击）

对 `Ctrl/Cmd` + 点击建立的**多选区域**执行复制/剪切时，遵循 Excel 规则：所有区域**行对齐**（按列拼接）或**列对齐**（按行拼接）才能合并为一个矩形块复制；否则提示「不能对多重选定区域使用此命令」。多选区上按 `Delete` 一次清空所有区域，合并为单个撤销步骤。

## IndexedDB 自动保存与恢复

基于 Dexie，数据库名 `web-spreadsheet`，对象仓库 `workbooks`（主键 `id`，索引 `updatedAt`）。

### 工作机制

1. 挂载后组件启动 `startAutoSave(store)`：订阅 store 变更，**1500ms 防抖**后把 `store.serialize()` 写入。
2. 默认记录 id 为 `'default'`（`DEFAULT_ID`）。
3. 下次 `mount()` 时，**只要构造 options 里没有 `data` 和 `sheets`**，就自动调用 `tryRestoreFromDB()` 恢复上次的工作簿（含多 sheet 名与逐格内容），恢复内容同样不计入撤销历史。

```ts
// 带初始数据 → 不恢复（覆盖场景）
new Spreadsheet('app', { data: [...] }).mount();

// 不带数据 → 自动恢复上次会话
new Spreadsheet('app').mount();
```

### 直接操作数据库

```ts
import { saveWorkbook, loadWorkbook, deleteWorkbook, DEFAULT_ID } from 'web-spreadsheet';
```

::: warning
`saveWorkbook` / `loadWorkbook` / `deleteWorkbook` / `DEFAULT_ID` 由 `src/db/` 提供，当前**未从包根导出**，以上 import 语句为规划用法；现阶段通过 `mount()` / `destroy()` 生命周期自动管理持久化即可。
:::

### 禁用 / 清除

- 构造时始终传 `data` 或 `sheets`，即不会触发恢复（自动保存仍会写入，可忽略）。
- 调用 `destroy()` 会停止自动保存计时器。
- 清除某份工作簿：删除 IndexedDB 中 `web-spreadsheet` 库的 `workbooks` 表对应 `id` 记录。

## 手动序列化

任何时刻都可以拿全量快照做自己的持久化（发到服务器、localStorage 等）：

```ts
const json = JSON.stringify(ss.store.serialize());
// …之后
const store = Store.deserialize(JSON.parse(json));
```

序列化格式见[数据模型](/guide/data-model#序列化格式)。
