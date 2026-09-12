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
| 数字格式 | ✅ 写入 xlsx 单元格 `z` 字段；内置格式映射：`number→#,##0.00`、`currency→¥#,##0.00`、`percent→0.00%`、`date→yyyy-mm-dd`、`time→hh:mm:ss`、`scientific→0.00E+00` |
| 单元格样式 | ❌ 不导出 |
| 合并单元格 | ❌ 不导出 |

产出标准 xlsx 二进制（MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`），UI 下载为 `workbook.xlsx`。

### 导入

```ts
const result = importXlsx(buffer); // { sheets: [{ name, cells, numberFormats }] }
```

- 用 `XLSX.read(buffer, { type: 'array', cellNF: true })` 读取，每个 sheet 转为二维单元格数组。
- 数字格式从 xlsx `z` 字段提取，随内容一起应用。
- 当前 UI 的「打开文件」**只导入第一个 sheet** 到当前表，数字格式以 `SetNumberFormatCommand` 批量应用；样式与合并单元格不导入。
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
- 复制/剪切后源区域显示 Excel 风格蚂蚁线（流动虚线框），Esc 取消；剪切在粘贴落地时才清空源区域（移动语义），且只能粘贴一次；复制可重复粘贴。
- 应用内复制/剪切会保存内部快照，粘贴优先使用该快照；无会话时读系统剪贴板（跨应用粘贴）。
- 粘贴以 HTML 优先（`parsePaste`），因此从 Excel / 网页表格粘贴能保留行列结构；纯文本降级按 TSV 解析。
- 粘贴只带文本内容，不带样式与公式；天然支持跨 sheet、跨应用粘贴。

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
