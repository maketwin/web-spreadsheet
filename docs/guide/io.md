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

**导出流水线**：SheetJS 写出基础包 → fflate 一次解包（解的是自己的输出，不套导入上限）→ 四个后处理器在内存文件表上就地修改（稀疏打包的坐标还原 → 样式 → 表特性 → 图表、批注）→ fflate 一次压缩打包。**输出文件是 deflate 压缩的**（SheetJS 自己的 zip 不压缩）。整条流水线只逐个处理已存储的格子，地址空间永不展开——只在 A1 和 XFD1048576 有内容的两个格子，导出也是毫秒级。

**稀疏打包**（`src/io/sheetPackingExport.ts`）：已用范围里的空地址超过 `MAX_DENSE_EXPORT_EMPTY_CELLS`（100 万，内部调优常量）时，SheetJS 的写入器会逐地址走过巨大的 `!ref` 矩形；此时格子先按行主序稠密打包进一个紧凑块写出，写完后在 sheet XML 里把真实坐标还原——成品文件与普通路径逐字节等价，普通形状的工作簿保持原样。

| 能力 | 支持情况 |
|------|----------|
| 多 Sheet | ✅ 每个 sheet 一张表，保留 sheet 名 |
| 公式 | ✅ 写入 `f` 字段（缓存值随行，Excel 打开后重算） |
| 数字格式 | ✅ 写入 xlsx 单元格 `z` 字段；内置格式映射：`number→#,##0.00`、`currency→¥#,##0.00`、`percent→0.00%`、`date→yyyy-mm-dd`、`time→hh:mm:ss`、`scientific→0.00E+00` |
| 合并单元格 | ✅ 写入 `!merges` |
| 单元格样式 | ✅ 自写 `styles.xml`（fonts / fills / numFmts / borders / cellXfs）：粗/斜/下划线/删除线、字号与字体名、文字颜色、实底填充色、水平垂直对齐、自动换行、数字格式、四边边框 |
| 列/行元数据 | ✅ `<cols>`（列宽、列隐藏、列默认样式 `style=`）与 `<row>` 属性（行高 `ht`、行隐藏、行默认样式 `s` + `customFormat`） |
| 冻结窗格 | ✅ `<pane>`（每张工作表的 `SheetFreeze`，见[数据模型](/guide/data-model)） |
| 自动筛选 | ⚠️ 只写筛选**范围** `<autoFilter ref>`，筛选条件不导出 |
| 条件格式 | ✅ 条件格式规则（含公式规则，按范围左上角定位）；禁用的规则不导出 |
| 数据验证 | ✅ 下拉列表 / 整数 / 小数 / 日期 / 文本长度 / 自定义公式 |

产出标准 xlsx 二进制（MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`），UI 下载为 `workbook.xlsx`。

### 导入

```ts
const imported: SerializedStore = importXlsx(buffer);
store.replaceAll(imported);  // 整体热替换当前工作簿
cmdManager.clear();          // Excel 语义：打开文件不可撤销
```

**导入上限**（`src/io/safeUnzip.ts`）：单个 zip 条目解压后 128 MiB、总计 256 MiB（此前 32 / 64 MiB）。防炸弹能力不变——fflate 在解压**前**读中央目录里声明的大小，超限直接拒绝、从不真实膨胀。网格就是 Excel 的全部地址空间，不再有「超出网格被截断」的警告。

| 能力 | 支持情况 |
|------|----------|
| 多 Sheet | ✅ 全部导入，sheet 名保留（含中文名） |
| 公式 | ✅ 读 `f` 字段写入 `cell.formula`，缓存值随行，UI 公式引擎接管重算 |
| 数字格式 | ✅ 从 `z` 字段提取进 `style.numberFormat`；与内置格式等价的反向映射回枚举名（`#,##0.00→number` 等），其余作为自定义格式串 |
| 日期 | ✅ 保留 Excel 序列值 + 日期格式识别（`cell.type='date'`），渲染层按格式显示 |
| 布尔 / 错误 | ✅ `TRUE/FALSE` 与 `#DIV/0!` 等错误字面量 |
| 合并单元格 | ✅ 读 `!merges` |
| 单元格样式 | ✅ 粗体/斜体/下划线/字号/字体/文字颜色/实底背景色/水平垂直对齐/自动换行；含「有样式无内容」的空单元格（从原始 sheet XML 的 `s` 属性恢复样式索引，再映射 SheetJS 解析好的 styles.xml 字体/填充/对齐表） |
| 行高 / 列宽 | ✅ `!rows` / `!cols`（含隐藏标记与列/行默认样式）。行高 `ht` 是**磅**，按 ×4/3 换算成像素（此前被当成像素直接用）；列宽改用 `<col width>` 原始属性换算（字符数 × 7px + 5px，不再依赖 SheetJS 猜出来的 `wpx`/`wch`）。**迁移说明**：旧版本导入时行高会偏大 4/3 倍，重新导入同一文件即可得到正确高度 |
| 冻结窗格 | ✅ `<pane>` → 每张工作表的 `SheetFreeze` |
| 自动筛选 | ✅ `<autoFilter ref>` → 筛选范围（条件不导入） |
| 条件格式 | ✅ 条件格式规则（dxfs）；`notBetween` / `notEqual` 单元格值规则与 `beginsWith` / `endsWith` / `containsBlanks` / `containsErrors` 类型暂跳过；引用其他单元格的条件以字面文本存储 |
| 数据验证 | ✅ 下拉列表 / 整数 / 小数 / 日期 / 文本长度 / 自定义公式；`time` 验证与 `notEqual` / `notBetween` 运算符暂跳过 |

- UI 的「导入 xlsx」用 `Store.replaceAll` 热替换整个工作簿并清空撤销历史（Excel 打开文件同样不可撤销）；解析失败弹错误提示。注意 `replaceAll` 不再逐格发 `cell` 事件（见[事件系统](/guide/events)的迁移说明）。
- 超链接 target 里的 `&` 导入后不再带着 `&amp;`（SheetJS 读属性不解实体，导入侧统一解码一次）。
- 已知限制：迷你图、浮动图片、行分组、命名区域与主题色（theme/indexed 非实底填充）不导入。图表、批注、超链接**已导入**（drawing/chart XML、comment XML 与 `hyperlink` 关系）。
- 导出侧的缺口：迷你图与浮动图片不导出到 xlsx，自动筛选条件不导出，禁用的条件格式规则不导出。
- 文件选择器接受 `.csv .tsv .xlsx .json`。

## CSV / TSV / JSON

| 方向 | 格式 | 机制 |
|------|------|------|
| 导入 | CSV / TSV | 文本按行、按 Tab 切分写入（CSV 的逗号先统一替换为 Tab）；**不支持引号包裹字段**。编码自动探测：UTF-16LE BOM → UTF-8（BOM / 严格解码）→ GBK 回退（兼容中文 Excel 导出的 GBK 文件） |
| 导入 | JSON | 以 `{` 开头按 JSON 解析，走 `Store.deserialize` 后拷入当前 store |
| 导出 | JSON | `JSON.stringify(store.serialize(), null, 2)`，下载为 `workbook.json` |
| 导出 | CSV | ✅ `exportCsv` / `exportCsvBlob` / `csvQuote` / `CsvRangeTooLargeError`（已从包根导出）：BOM'd UTF-8、写出显示值（数字格式已应用，且按**有效样式**解析——列/行默认的数字格式生效）、引号转义；下载为 `workbook.csv`。已用范围面积超过 `MAX_DENSE_RANGE_CELLS`（200 万格）时抛 `CsvRangeTooLargeError`（演示页菜单里以错误提示显示）——两个相距极远的格子会让稠密写出扫过整片空地址，删掉孤立格即可恢复。TSV 暂无文件导出（复制到剪贴板时是 TSV 格式） |

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
- **规模行为**（`copySourceRect`）：复制范围是选区内**已存储格子**的最小外接矩形（空选区复制出一个空白格），远处一格孤值不会把整张表的已用范围拖进剪贴板；剪切的源清除只碰已存储的格子；多选区按 Delete 与单选区口径一致。复制继承来的有效样式（列/行默认）会被物化成自有 `styleId`（见[格式化](/guide/formatting)）。
- 粘贴只带文本内容，不带样式与公式；天然支持跨 sheet、跨应用粘贴。
- **平铺粘贴**（Excel 同款）：目标选区行、列都是源块整数倍时（如 2×3 份），整块重复填充；否则只粘贴一份。平铺与填充写入的格子总数受 `MAX_MATERIALIZED_CELLS`（25 万，已导出）约束——Excel 会把复制块平铺填满整列选区，这里粘贴只在锚点落一次、填充写到上限为止（见[规模与性能](/guide/scale)）。

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

## 打印与 PDF 导出

打印管线位于 `src/print/`（`PrintPipeline` 分页 + `PrintPainter` 绘制，192-dpi 离屏 canvas 渲染每页），当前为内部实现（未从包根导出），UI 的 `Ctrl+P` 打印预览已自动接线。

- **打印设置**：纸张（A4/Letter 等）、方向、页边距预设、缩放（适应页宽 / 自定义百分比 50–200）、是否打印网格线、打印区域（`A1:F20` 语法，仅当前工作表范围有效）。
- **页眉页脚**：支持 `{page}`、`{pages}`、`{sheet}` 占位符。
- **范围**：打印预览提供「当前工作表 / 整个工作簿」切换——整簿按标签顺序逐表分页，`{page}`/`{pages}` 用工作簿全局编号（适应页宽缩放仍按表独立计算）；PDF 导出整簿时文件名为 `工作簿.pdf`。
- **分页语义**：合并单元格感知的分页（不把合并块切断），冻结窗格不影响分页；打印范围把浮动图片/图表的锚点算进使用区域（`usedRange`）。
- **渐进渲染**：`renderWorkbookPrintPagesAsync(store, settings, scope, onProgress?, signal?)` 逐页渲染——每页之间让出主线程，`onProgress` 每完成一页回调一次，`AbortSignal` 可随时取消；整簿打印不再一次卡住主线程。
- **浮动图片**：data URL 图片会像 Excel 一样被打印（仅支持 data URL，不做网络请求）。
- **适应页宽**：只缩小、不放大——内容不足一页宽时按 100% 打印（与 Excel 一致）。

程序化接口（`src/print/PrintPipeline.ts` 与 `src/io/pdfExport.ts`，暂未从包根导出，调用形态供参考）：

```ts
// planWorkbookPrintPages(store, settings, scope)     → 便宜的纯分页估算（不绘制），页数/每表布局
// renderWorkbookPrintPages(store, settings, scope)   → 同步整簿渲染（一次性画完，阻塞主线程）
// renderWorkbookPrintPagesAsync(store, settings, scope, onProgress?, signal?)
//                                                    → 渐进渲染，可取消、带进度回调
// printPages(result, settings)                       → 唤起浏览器打印
// exportPagesToPdf(result, settings)                 → Promise<Blob>（PDF）
```

打印预览对话框先用 `planWorkbookPrintPages` 做分页估算（页数与缩放即时可见），确认后再走异步渲染。

## IndexedDB 自动保存与恢复

基于 Dexie，数据库名 `web-spreadsheet`，对象仓库 `workbooks`（主键 `id`，索引 `updatedAt`）。

### 工作机制

1. 挂载后组件启动 `startAutoSave(store, id?, options?)`：订阅 store 变更，最后一次变化 **1500ms 后**保存（`AUTOSAVE_DEBOUNCE_MS`）；连续编辑不歇时，从**第一个未保存的变化起最迟 5000ms** 也会强制保存一次（`AUTOSAVE_MAX_WAIT_MS`）。`window` 的 `pagehide` 与 `document` 的 `visibilitychange`（变为 hidden）会**立即落盘**——即使此刻有一次写入在进行（IndexedDB 对同一条记录按创建顺序提交，新的快照会覆盖旧的）；其余时候同一时间只有一次写入。保存失败只 `console.error`，不会产生未处理的 rejection。`AutoSaveOptions.yieldFn` 可注入让出函数（测试用）。
2. **分片编码，按表标脏**（`src/db/workbookEncoder.ts`）：store 事件把内容变过的表标脏，保存时只重新编码这些表——没变的表直接复用上一次成功提交的 JSON 字符串。每张表按**每片约 20,000 个格子**分片编码、片间让出主线程，一张百万格的表也不会产生一个长任务；工作簿被整体替换时所有表重新标脏。离开页面（`pagehide` / 页面隐藏 / `stop()`）时改为一次同步全量写完（这是最后一个写入机会，宁可长任务也不丢数据）。
3. 默认记录 id 为 `'default'`（`DEFAULT_ID`）。
4. 下次 `mount()` 时，**只要构造 options 里没有 `data` 和 `sheets`**，就自动调用 `tryRestoreFromDB()` 恢复上次的工作簿（含多 sheet 名与逐格内容），恢复内容同样不计入撤销历史。

存档记录带**格式版本号**，当前为 **v2**（`WORKBOOK_FORMAT_VERSION = 2`，已从包根导出）：

```ts
{
  id: string;
  updatedAt: number;
  formatVersion: 2,
  activeSheetId: string,
  passwordHash?: string,
  sheets: Array<{ id: string; name: string; color?: string; data: string }>, // data = 该表 SerializedSheetData 的 JSON 字符串
}
```

v1 把整个工作簿存成一个对象图，每次保存都要 structured-clone 百万个 Cell 对象；v2 每张表只存一个 JSON 字符串（克隆字符串是拷贝），配合分片编码器可以只重写变过的表。**新版本能读 v1 记录**（缺 `formatVersion` 字段按 1 读）；**旧版本会拒绝 v2 记录**并保持原记录不动——`loadWorkbook` 遇到来自更新版本的存档会抛错（错误信息说明两个版本号，Dexie schema 没变）。`loadWorkbook` 的返回类型不变（`SerializedStore | undefined`），`saveWorkbook(id, data)` 签名不变。调用方原有的 `.catch` 自行处理——SDK 自身的恢复路径打 `console.error`，演示页显示「读取失败」提示条。

```ts
// 带初始数据 → 不恢复（覆盖场景）
new Spreadsheet('app', { data: [...] }).mount();

// 不带数据 → 自动恢复上次会话
new Spreadsheet('app').mount();
```

### 直接操作数据库

```ts
import { loadWorkbook, deleteWorkbook, DEFAULT_ID } from 'web-spreadsheet';
```

::: warning
`loadWorkbook` / `deleteWorkbook` / `DEFAULT_ID` / `WORKBOOK_FORMAT_VERSION` 已从包根导出；`saveWorkbook` 暂未导出（自动保存内部使用）。需要手动落盘时用上文的 `store.serialize()` 自行存储即可。
:::

### 禁用 / 清除

- 构造时始终传 `data` 或 `sheets`，即不会触发恢复（自动保存仍会写入，可忽略）。
- 调用 `destroy()` 会停止自动保存（冲刷尚未写入的挂起内容并移除页面隐藏监听）。
- 清除某份工作簿：删除 IndexedDB 中 `web-spreadsheet` 库的 `workbooks` 表对应 `id` 记录。

## 手动序列化

任何时刻都可以拿全量快照做自己的持久化（发到服务器、localStorage 等）：

```ts
const json = JSON.stringify(ss.store.serialize());
// …之后
const store = Store.deserialize(JSON.parse(json));
```

序列化格式见[数据模型](/guide/data-model#序列化格式)。
