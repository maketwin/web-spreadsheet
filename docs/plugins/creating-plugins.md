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

  registerFunction(name: string, spec: FunctionSpec): void;
  on(event: string, handler: (payload: unknown) => void): () => void;
}
```

| 成员 | 说明 |
|------|------|
| `store` | 数据层，读写单元格、样式、规则 |
| `cmdManager` | 执行命令（走命令系统的修改可撤销） |
| `events` | 事件总线，监听 `command:executed` 等 |
| `registerFunction` | 向公式引擎注册函数，`FunctionSpec = { minArgs, maxArgs, evaluate(args) }` |
| `on` | 订阅事件，返回退订函数 |

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
  },
};
```

注册后即可在任意单元格使用 `=MEDIAN(A1:A10)`。函数名统一按大写存储，可通过 `registry.list()` 查看。

## 监听事件

```ts
const LoggerPlugin: Plugin = {
  name: 'logger',
  install(api) {
    const off = api.events.on('command:executed', ({ cmd }) => {
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
- `ss.destroy()` 会清空插件列表（已注册的公式函数与事件监听不会自动撤销——请在插件内部管理退订）。
- `ss.cmdManager`… 之外的调试辅助：`PluginManager.list()` 返回已注册插件名列表。

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
3. **退订** — 保存 `api.on(...)` 返回的退订函数，在适当时机调用，避免泄漏。
4. **事件驱动** — 监听 `command:executed` / `Store.subscribe` 响应变化，而不是轮询。
5. **类型** — 导出插件的配置接口，充分利用 SDK 导出的 `Style`、`RangeAddress`、`Cell` 等类型。
