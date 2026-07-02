# 插件开发指南

## 插件接口

web-spreadsheet 通过 `Plugin` 接口支持扩展：

```ts
import type { Plugin } from 'web-spreadsheet';
```

### Plugin 接口定义

```ts
interface Plugin {
  readonly name: string;
  install(api: PluginAPI): void;
  destroy?(): void;
}
```

| 属性/方法 | 说明 |
|-----------|------|
| `name` | 插件唯一标识 |
| `install(api)` | 安装插件，接收 PluginAPI 实例 |
| `destroy?()` | 可选的清理方法 |

## PluginAPI

插件通过 `PluginAPI` 访问电子表格内部能力：

```ts
interface PluginAPI {
  readonly store: Store;
  readonly events: EventBus;
  readonly cmdManager: CommandManager;
  readonly formula: FormulaEngine;
}
```

## 创建一个简单插件

```ts
import type { Plugin, PluginAPI } from 'web-spreadsheet';

class HelloWorldPlugin implements Plugin {
  public readonly name = 'hello-world';

  public install(api: PluginAPI): void {
    console.log('Hello from plugin!');

    api.events.subscribe((event) => {
      if (event.type === 'cell') {
        console.log(`Cell changed: ${event.r},${event.c}`);
      }
    });
  }

  public destroy(): void {
    console.log('Plugin destroyed');
  }
}
```

## 使用插件

```ts
import { Spreadsheet } from 'web-spreadsheet';

const ss = new Spreadsheet('app');
ss.use(new HelloWorldPlugin());
ss.mount();
```

## 内置插件示例：CsvImportPlugin

项目内置了 `CsvImportPlugin` 作为插件开发的参考：

```ts
import { CsvImportPlugin } from 'web-spreadsheet';
```

该插件注册了一个文件导入处理器，支持 CSV/TSV 文件的解析和导入。

## 最佳实践

1. **命名** — 插件名使用 kebab-case，如 `my-plugin`
2. **清理** — 在 `destroy()` 中取消事件订阅、释放资源
3. **命令** — 修改数据时通过 `CommandManager.execute()` 以支持 Undo/Redo
4. **事件** — 通过 `EventBus` 监听变更而非直接修改 Store
5. **类型** — 充分利用 TypeScript 类型，导出插件的配置接口
