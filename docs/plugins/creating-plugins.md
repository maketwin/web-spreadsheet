# 插件开发指南

web-spreadsheet 通过 `Plugin` 接口支持扩展。插件在 `install` 时拿到一个 `PluginAPI`，可以访问 store、命令管理器、事件总线，还能**注册自定义公式函数**。

## 插件接口

```ts
interface Plugin {
  readonly name?: string;              // 唯一标识，kebab-case，缺省显示为 'anonymous'
  install: (api: PluginAPI) => void;
}
```

| 属性/方法 | 说明 |
|-----------|------|
| `name` | 插件唯一标识（可选） |
| `install(api)` | 安装插件，接收 `PluginAPI` 实例 |
| 返回值 | 无；资源清理靠退订函数与 `destroy` 时机 |

## PluginAPI

```ts
class PluginAPI {
  get store(): Store;                        // 未绑定到实例时抛 Error
  get cmdManager(): CommandManager;
  get events(): EventBus;
  get formula(): FormulaEngine;              // 公式引擎本体（求值/重算入口）

  registerFunction(name: string, spec: FunctionSpec): () => void;
  on<K extends string>(event: K, handler: (payload: K extends keyof SpreadsheetEvents ? SpreadsheetEvents[K] : unknown) => void): () => void;
}
```

| 成员 | 说明 |
|------|------|
| `store` | 数据层，读写单元格、样式、规则 |
| `cmdManager` | 执行命令（走命令系统的修改可撤销） |
| `events` | 事件总线（类型化的 `EventBus<SpreadsheetEvents>`），监听 `command:executed` 等 |
| `formula` | 公式引擎（`FormulaEngine`），需要主动求值/重算时使用 |
| `registerFunction` | 向公式引擎注册函数，`FunctionSpec = { minArgs, maxArgs, evaluate(args, ctx?) }`；注册落在宿主引擎**自己的函数表**上（一张以共享 `registry` 为父表的私有表——内置函数仍然可用，本表的注册不外泄到其它引擎）；返回该注册的**撤销函数**（恢复注册前的旧定义，或移除新函数） |
| `on` | 订阅事件（类型化：内置事件名的载荷类型精确，自定义事件名保持 `unknown`），返回退订函数 |

## 注册自定义公式函数

```ts
import type { Plugin } from 'web-spreadsheet';

const StatsPlugin: Plugin = {
  name: 'stats',
  install(api) {
    api.registerFunction('MEDIAN', {
      minArgs: 1,
      maxArgs: 255,
      evaluate: (args) => {
        const nums = args
          .flatMap((a) => (Array.isArray(a) ? a : [a]))
          .map(Number)
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        const mid = Math.floor(nums.length / 2);
        return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
      },
    });
    // 声明第二个参数 ctx（FunctionContext）可获知公式所在单元格 / 工作表；
    // 引擎求值路径一定有值，不带上下文的直接求值（条件格式/验证规则）里为 undefined
    api.registerFunction('MYTAG', {
      minArgs: 0,
      maxArgs: 0,
      evaluate: (_args, ctx) => (ctx ? `${ctx.sheetId}!${ctx.cell.r},${ctx.cell.c}` : ''),
    });
  },
};
```

注册后即可在任意单元格使用 `=MEDIAN(A1:A10)`。函数名统一按大写存储，可通过 `registry.list()` 查看。

::: warning 作用域边界
私有表里的函数只对**单元格公式**生效：条件格式规则与数据验证规则里的公式不带引擎注册表直接求值，看不到这些函数；公式自动补全默认也查共享 `registry`。
:::

## 监听事件

`api.on` 与 `api.events.on` 都可用；内置事件名（`SpreadsheetEvents` 表）的 handler 载荷类型精确：

```ts
const LoggerPlugin: Plugin = {
  name: 'logger',
  install(api) {
    // payload 类型为 SpreadsheetEvents['command:executed']，即 { cmd: Command }
    const off = api.on('command:executed', ({ cmd }) => {
      console.log('executed:', cmd.describe());
    });
    // 保存 off，在合适的时机退订
  },
};
```

## 使用插件

```ts
import { Spreadsheet } from 'web-spreadsheet';

const ss = new Spreadsheet('app');
ss.use(new MyPlugin())   // 也可以传对象字面量
  .use(StatsPlugin);
ss.mount();
```

- `use()` 返回 `this`，支持链式调用；插件在 `mount()` 前后注册都可以。
- `PluginManager.clear()` / `ss.destroy()` 会**自动撤销**每个插件注册的公式函数与事件订阅（`PluginAPI.dispose()`）；`install` 中途抛错时同样回滚已注册的内容，且该插件不进入插件列表。
- `PluginManager` 构造参数是结构化的 `PluginHost`（`{ store, cmdManager, events, formula }`）——React `Spreadsheet` 类天然满足；无头宿主（`web-spreadsheet/core` 组合自己的四件套）也能直接使用插件层。
- 调试辅助：`PluginManager.list()` 返回已注册插件名列表。

## 内置示例：CsvImportPlugin

包内置的 `CsvImportPlugin` 是最简参考实现——它监听 `csv:import` 事件并把 CSV 文本写入活动 sheet：

```ts
import { Spreadsheet, CsvImportPlugin } from 'web-spreadsheet';

const ss = new Spreadsheet('app');
ss.use(CsvImportPlugin);
ss.mount();

// 触发导入：向事件总线发送 CSV 字符串
ss.events.emit('csv:import', '名称,数量\n产品A,10\n产品B,20');
```

实现只有 20 行：按 `\n` 分行、每行按 `,` 切分、逐格 `api.store.setCell(r, c, { text })`。注意它不支持引号包裹字段，导入起点是 `(0,0)`。

## 最佳实践

1. **命名** — 插件名用 kebab-case，保持唯一。
2. **走命令** — 修改数据时用 `api.cmdManager.execute(命令)`，让用户能撤销；直接 `store.setCell` 只适合初始化。
3. **退订** — 保存 `api.on(...)` 返回的退订函数，需要提前退订时调用（`destroy()` 时未退订的订阅也会被统一撤销）。
4. **事件驱动** — 监听 `command:executed` / `Store.subscribe` 响应变化，而不是轮询。
5. **类型** — 导出插件的配置接口，充分利用 SDK 导出的 `Style`、`RangeAddress`、`Cell` 等类型。
