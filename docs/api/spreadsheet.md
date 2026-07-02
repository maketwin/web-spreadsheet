# Spreadsheet API

## Spreadsheet 类

SDK 的主入口，负责创建和管理电子表格实例。

```ts
import { Spreadsheet } from 'web-spreadsheet';
```

### 构造函数

```ts
new Spreadsheet(root: HTMLElement | string, options?: SpreadsheetOptions)
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `root` | `HTMLElement \| string` | 挂载的 DOM 元素或元素 ID |
| `options` | `SpreadsheetOptions` | 配置选项 |

### SpreadsheetOptions

```ts
interface SpreadsheetOptions {
  data?: readonly (readonly CellInput[])[];
  sheets?: readonly SheetInput[];
  theme?: Theme | false;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `data` | `CellInput[][]` | 单 Sheet 初始数据 |
| `sheets` | `SheetInput[]` | 多 Sheet 初始数据 |
| `theme` | `'light' \| 'dark' \| false` | 主题配置，默认跟随系统 |

### 方法

| 方法 | 说明 |
|------|------|
| `mount()` | 挂载到 DOM，开始渲染 |
| `destroy()` | 卸载组件，清理资源 |
| `use(plugin)` | 注册插件，返回 `this` 支持链式调用 |

### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `store` | `Store` | 数据存储层 |
| `events` | `EventBus` | 事件总线 |
| `cmdManager` | `CommandManager` | 命令管理器 |
| `formula` | `FormulaEngine` | 公式引擎 |
| `rowCount` | `number` | 数据行数 |

## Store

响应式数据层，管理单元格、Sheet 和样式。

```ts
import { Store } from 'web-spreadsheet';
```

### 常用方法

| 方法 | 说明 |
|------|------|
| `getCell(r, c)` | 获取单元格 |
| `setCell(r, c, cell)` | 设置单元格 |
| `getSheets()` | 获取所有 Sheet |
| `getActiveSheetId()` | 获取当前活动 Sheet ID |
| `activateSheet(id)` | 切换活动 Sheet |
| `addSheet(name?)` | 添加 Sheet |
| `deleteSheet(id)` | 删除 Sheet |
| `renameSheet(id, name)` | 重命名 Sheet |
| `getStyle(id)` | 获取样式 |
| `subscribe(callback)` | 订阅变更事件 |
| `serialize()` | 序列化为 JSON |
| `deserialize(data)` | 从 JSON 反序列化 |

## FormulaEngine

公式引擎，支持 32+ 内置函数和增量重算。

```ts
import { FormulaEngine } from 'web-spreadsheet';
```

### 常用方法

| 方法 | 说明 |
|------|------|
| `setFormula(id, text, deps, sheetId?)` | 设置公式 |
| `removeFormula(id, sheetId?)` | 移除公式 |
| `onCellChanged(id, sheetId?)` | 通知单元格变更触发重算 |

## CommandManager

命令管理器，实现 Undo/Redo。

```ts
import { CommandManager } from 'web-spreadsheet';
```

### 方法

| 方法 | 说明 |
|------|------|
| `execute(cmd)` | 执行命令 |
| `undo()` | 撤销 |
| `redo()` | 重做 |
| `clear()` | 清空历史 |

## VirtualScroller

虚拟滚动，计算可见区域。

```ts
import { VirtualScroller } from 'web-spreadsheet';
```

### 方法

| 方法 | 说明 |
|------|------|
| `getVisibleRange()` | 获取可见行列范围 |
| `cellToPixel(r, c)` | 单元格坐标转像素 |
| `setScroll(top, left)` | 设置滚动位置 |
| `setViewport(w, h)` | 设置视口大小 |
| `setRowHeight(r, h)` | 设置行高 |
| `setColWidth(c, w)` | 设置列宽 |

## ClipboardService

剪贴板服务，支持复制/剪切/粘贴。

```ts
import { ClipboardService } from 'web-spreadsheet';
```

### 方法

| 方法 | 说明 |
|------|------|
| `copy(store, range)` | 复制范围到剪贴板 |
| `cut(store, range)` | 剪切范围到剪贴板 |
| `read()` | 从剪贴板读取数据 |
