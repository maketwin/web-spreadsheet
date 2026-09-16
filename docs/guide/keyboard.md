# 键盘快捷键

键盘事件由 `KeyboardHandler` 统一解析（`src/keys/KeyboardHandler.ts`），画布聚焦时生效。移动类操作受网格边界 clamp（1000 行 × 26 列）。

## 导航

| 按键 | 行为 |
|------|------|
| `↑` `↓` `←` `→` | 移动一个单元格 |
| `Ctrl/Cmd` + 方向键 | 跳到数据区域边缘（空单元格跳到下一片数据；无数据则到网格边界） |
| `Shift` + 方向键 | 从锚点扩展选区 |
| `Ctrl/Cmd` + `Shift` + 方向键 | 扩展选区到数据区域边缘 |
| `Tab` / `Shift + Tab` | 右移 / 左移一格 |
| `Enter` / `Shift + Enter` | 下移 / 上移一格；多格选区内沿选区循环（Enter 纵向、Tab 横向） |
| `Home` | 行首 |
| `End` | 进入 **End 模式**：下一个方向键边缘跳转（等同 `Ctrl` + 方向键，`Shift` 可扩展），其他任意键解除 |
| `Ctrl/Cmd + Home` | 回到 A1（冻结时回到滚动区首格） |
| `Ctrl/Cmd + End` | 跳到最后使用过的单元格 |
| `Ctrl/Cmd + Space` | 选中当前列（整列） |
| `Shift + Space` | 选中当前行（整行） |
| `PageUp` / `PageDown` | 上 / 下移动一屏（按当前视口行数计算，随缩放变化） |
| `Ctrl/Cmd + PageUp` / `PageDown` | 切换到上一张 / 下一张工作表 |

## 编辑

进入编辑的两种方式（Excel 同款语义）：

- **编辑模式**：`F2` 或双击单元格——方向键在文本内移动光标；
- **输入模式**：直接键入字符、`Backspace` 或 `Alt+=`——方向键直接提交并移动。

| 按键 | 行为 |
|------|------|
| `F2` / 双击 | 编辑模式进入编辑 |
| 任意字符键 | 输入模式进入编辑并输入该字符 |
| `Backspace` | 清空当前单元格并进入空编辑器（Excel 同款） |
| `Delete` | 清空选区内容（多选区时一次清空所有区域，合并为单个撤销） |
| `Enter`（编辑器） | 提交并下移一格（`Shift` 上移）；多格选区内沿选区循环 |
| `Tab`（编辑器） | 提交并右移一格（`Shift` 左移）；多格选区内沿选区循环 |
| `Enter`（画布 + 蚂蚁线） | 粘贴一次并结束剪贴板会话 |
| `Escape` | 取消编辑；无编辑时取消剪贴板会话（清除蚂蚁线，见[剪贴板](/guide/io#应用内剪贴板会话-蚂蚁线)），选区不变 |
| `F4` | 重复上一次操作并作用于当前选区（Excel）；撤销/重做不会成为重复源。编辑器内则是 `$` 锚定循环（见下） |

### 编辑器内

| 按键 | 行为 |
|------|------|
| 方向键（公式 point 模式） | 公式在等待操作数时（如 `=`、`+` 后），方向键插入/移动引用而不是提交，见[公式](/guide/formulas#point-模式与引用编辑) |
| `F4` | 循环光标处引用的 `$` 锚定：`A1` → `$A$1` → `A$1` → `$A1` |
| `Alt + Enter` | 输入换行，自动开启自动换行并加高行 |

## 菜单命令（`Ctrl/Cmd` + …）

| 按键 | 命令 |
|------|------|
| `C` / `V` / `X` | 复制 / 粘贴 / 剪切 |
| `D` / `R` | 向下填充 / 向右填充（复制语义，公式引用随位置平移） |
| `Z` / `Y` | 撤销 / 重做 |
| `S` | 保存（下载 xlsx） |
| `F` / `H` | 查找 / 替换 |
| `A` | 全选（Excel 两段式：第一次选中当前数据区域，再按选全表；孤立空单元格直接选全表） |
| `B` / `I` / `U` | 粗体 / 斜体 / 下划线 |
| `1` | 设置单元格格式（打开数字格式对话框） |
| `;` | 插入当前日期（`yyyy/m/d`） |
| `0` | 缩放复位 100% |
| `+`（或 `=`）/ `-` | 放大 / 缩小 |

`Alt + =`：在活动单元格生成 AutoSum 公式（优先对上方连续数字求和，其次左侧），并进入编辑模式。

在内部解析为 `{ type: 'menu', command: ... }` 动作，`MenuShortcutCommand` 的全部取值：`save`、`find`、`replace`、`selectAll`、`bold`、`italic`、`underline`、`zoom100`、`zoomIn`、`zoomOut`、`undo`、`redo`、`formatCells`、`nextSheet`、`prevSheet`。

## 鼠标

| 操作 | 行为 |
|------|------|
| 点击单元格 / 行头 / 列头 / 全选角 | 选中 |
| `Shift` + 点击 | 从锚点扩展选区 |
| `Ctrl/Cmd` + 点击 / 拖动 | 添加**多选区域**（Excel 同款）：原选区保留为附加区域（照常着色，无活动单元格与填充柄），点击的单元格成为新的活动单元格 |
| 拖动 | 连续选区 |
| 拖动行/列头边缘 | 调整行高 / 列宽（15–500px） |
| 双击行/列头边缘 | 自动适应内容 |
| 拖动选区 | 移动区域（`MoveRange`，可撤销） |
| `Ctrl/Cmd` + 拖动选区 | 复制区域（源保留，可撤销） |
| 拖动选区右下角填充柄 | 智能填充（见[智能填充](/guide/fill)） |
| 双击填充柄 | 向下填充到相邻列的数据长度（Excel 同款） |
| 滚轮 / 触控板滚动 | 纵向滚动网格 |
| `Shift` + 滚轮 | 横向滚动 |
| 触控板捏合（`Ctrl` + 滚轮） | 缩放 50%–200%，步进 10% |
| 右键单元格 / 行列头 | 上下文菜单 |

## 程序化解析

`KeyboardHandler` 是纯静态工具，可复用于自己的输入处理：

```ts
import { KeyboardHandler } from 'web-spreadsheet';

const action = KeyboardHandler.next('z', range, false, true); // Cmd+Z
// → { type: 'menu', command: 'undo' }
```

签名：`next(key, range, shiftKey?, metaKey?, ctrlKey?): KeyboardAction | null`。`KeyboardAction` 的 `type` 取值：`move`、`moveEdge`、`jump`、`page`（翻屏，附带 `pageDir: -1 | 1`，由调用方按视口行数解析）、`edit`、`backspace`、`insertDate`、`fill`、`clear`、`cancel`、`copy`、`paste`、`cut`、`type`、`menu`、`selectColumn`、`selectRow`。
