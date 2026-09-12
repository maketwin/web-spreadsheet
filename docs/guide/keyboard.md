# 键盘快捷键

键盘事件由 `KeyboardHandler` 统一解析（`src/keys/KeyboardHandler.ts`），画布聚焦时生效。移动类操作受网格边界 clamp（1000 行 × 26 列）。

## 导航

| 按键 | 行为 |
|------|------|
| `↑` `↓` `←` `→` | 移动一个单元格 |
| `Shift` + 方向键 | 从锚点扩展选区 |
| `Tab` | 右移一格 |
| `Shift + Enter` | 上移一格 |
| `Home` / `End` | 行首 / 行尾 |
| `PageUp` / `PageDown` | 上 / 下移动 10 行 |

## 编辑

| 按键 | 行为 |
|------|------|
| `Enter` 或 `F2` | 开始编辑当前单元格 |
| 任意字符键 | 直接进入编辑并输入该字符 |
| `Delete` / `Backspace` | 清空选区内容 |
| `Escape` | 取消编辑；无编辑时取消剪贴板会话（清除蚂蚁线，见[剪贴板](/guide/io#应用内剪贴板会话-蚂蚁线)） |

## 菜单命令（`Ctrl/Cmd` + …）

| 按键 | 命令 |
|------|------|
| `C` / `V` / `X` | 复制 / 粘贴 / 剪切 |
| `Z` / `Y` | 撤销 / 重做 |
| `S` | 保存（下载 xlsx） |
| `F` / `H` | 查找 / 替换 |
| `A` | 全选（Excel 两段式：第一次选中当前数据区域，再按选全表；孤立空单元格直接选全表） |
| `B` / `I` / `U` | 粗体 / 斜体 / 下划线 |
| `0` | 缩放复位 100% |
| `+`（或 `=`）/ `-` | 放大 / 缩小 |

在内部解析为 `{ type: 'menu', command: ... }` 动作，`MenuShortcutCommand` 的全部取值：`save`、`find`、`replace`、`selectAll`、`bold`、`italic`、`underline`、`zoom100`、`zoomIn`、`zoomOut`、`undo`、`redo`。

## 鼠标

| 操作 | 行为 |
|------|------|
| 点击单元格 / 行头 / 列头 / 全选角 | 选中 |
| `Shift` + 点击 | 从锚点扩展选区 |
| 拖动 | 连续选区 |
| 拖动行/列头边缘 | 调整行高 / 列宽（15–500px） |
| 双击行/列头边缘 | 自动适应内容 |
| 拖动选区 | 移动区域（`MoveRange`，可撤销） |
| 拖动选区右下角填充柄 | 智能填充（见[智能填充](/guide/fill)） |
| 右键单元格 / 行列头 | 上下文菜单 |

## 程序化解析

`KeyboardHandler` 是纯静态工具，可复用于自己的输入处理：

```ts
import { KeyboardHandler } from 'web-spreadsheet';

const action = KeyboardHandler.next('z', range, false, true); // Cmd+Z
// → { type: 'menu', command: 'undo' }
```

签名：`next(key, range, shiftKey?, metaKey?, ctrlKey?): KeyboardAction | null`。`KeyboardAction` 的 `type` 取值：`move`、`edit`、`clear`、`cancel`、`copy`、`paste`、`cut`、`type`、`menu`。
