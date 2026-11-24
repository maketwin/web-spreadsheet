import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * 接口侦察面板是独立的内联脚本（无模块导出），这里把 proxy/dashboard.html 的
 * <script> 提出来，在注入的最小 DOM 桩里真实执行，验证轮询游标、清空、代理重启、
 * 展开状态与滚动锚点这些纯逻辑行为。
 */

const html = readFileSync(join(process.cwd(), 'proxy', 'dashboard.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
if (script === '') throw new Error('dashboard.html 里没找到内联脚本');

interface CallRecord {
  readonly seq: number;
  readonly kind: string;
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly status: number;
  readonly ms: number;
  readonly ts: number;
  readonly reqType: string;
  readonly reqBody: unknown;
  readonly resType: string;
  readonly resBody: unknown;
}

const call = (seq: number): CallRecord => ({
  seq,
  kind: 'xhr',
  method: 'GET',
  path: '/api/leaf',
  query: {},
  status: 200,
  ms: 5,
  ts: Date.now(),
  reqType: 'json',
  reqBody: null,
  resType: 'json',
  resBody: '{}',
});

interface RowStub {
  readonly dataset: { readonly seq: string };
  readonly offsetTop: number;
  readonly classList: { toggle(cls: string): void; contains(cls: string): boolean };
}

function makeRow(seq: number, open: boolean, offsetTop: number): RowStub {
  let isOpen = open;
  return {
    dataset: { seq: String(seq) },
    offsetTop,
    classList: {
      toggle: (cls: string) => {
        if (cls === 'open') isOpen = !isOpen;
      },
      contains: (cls: string) => cls === 'open' && isOpen,
    },
  };
}

/** #rows 的桩：innerHTML 赋值时按渲染结果重建行桩（offsetTop 每行 10px）。 */
class RowsEl {
  private htmlText = '';
  private rows: RowStub[] = [];
  public renderCount = 0;
  public clickHandler: ((e: unknown) => void) | null = null;

  public get innerHTML(): string {
    return this.htmlText;
  }

  public set innerHTML(value: string) {
    this.htmlText = value;
    this.renderCount += 1;
    const rows: RowStub[] = [];
    let index = 0;
    for (const m of value.matchAll(/<div class="row([^"]*)" data-seq="(\d+)">/g)) {
      rows.push(makeRow(Number(m[2]), (m[1] ?? '').includes('open'), index * 10));
      index += 1;
    }
    this.rows = rows;
  }

  public addEventListener(type: string, fn: (e: unknown) => void): void {
    if (type === 'click') this.clickHandler = fn;
  }

  public querySelectorAll(selector: string): RowStub[] {
    return selector === '.row' ? this.rows : [];
  }

  public querySelector(selector: string): RowStub | null {
    const seq = selector.match(/data-seq="(\d+)"/)?.[1];
    return seq === undefined ? null : (this.rows.find((r) => r.dataset.seq === seq) ?? null);
  }

  public clickRow(seq: number): void {
    const row = this.rows.find((r) => r.dataset.seq === String(seq));
    this.clickHandler?.({ target: { closest: () => row ?? null } });
  }
}

interface ButtonStub {
  readonly classList: { toggle(cls: string, force?: boolean): void; contains(cls: string): boolean };
  addEventListener(type: string, fn: (e: unknown) => void): void;
  clickHandler: ((e: unknown) => void) | null;
}

function makeButton(): ButtonStub {
  const classes = new Set<string>();
  const stub: ButtonStub = {
    classList: {
      toggle: (cls: string, force?: boolean) => {
        const on = force ?? !classes.has(cls);
        if (on) classes.add(cls);
        else classes.delete(cls);
      },
      contains: (cls: string) => classes.has(cls),
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'click') stub.clickHandler = fn;
    },
    clickHandler: null,
  };
  return stub;
}

function makeEnv(initialBootId = 'boot-a') {
  const rowsEl = new RowsEl();
  const countEl = { textContent: '' };
  const buttons: Record<string, ButtonStub> = { xhrOnly: makeButton(), auto: makeButton(), clear: makeButton(), export: makeButton() };
  const scrollTo = vi.fn();
  const win = { scrollTo, scrollY: 0 };
  let served: readonly CallRecord[] = [];
  let bootId = initialBootId;
  const fetchStub = vi.fn(async (url: string) => {
    if (url.includes('/__spy/api/clear')) return { json: async () => ({ ok: true }) };
    const since = Number(new URL(url, 'http://local').searchParams.get('since') ?? 0);
    return { json: async () => ({ bootId, calls: served.filter((c) => c.seq > since) }) };
  });
  let poll: (() => Promise<void>) | null = null;
  const intervalStub = (fn: () => Promise<void>): number => {
    poll = fn;
    return 1;
  };
  const doc = {
    getElementById: (id: string): unknown => {
      if (id === 'rows') return rowsEl;
      if (id === 'count') return countEl;
      return buttons[id] ?? null;
    },
  };

  const runner = new Function('document', 'window', 'fetch', 'setInterval', script) as (
    d: unknown,
    w: unknown,
    f: unknown,
    s: unknown,
  ) => void;
  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  };
  return {
    rowsEl,
    countEl,
    scrollTo,
    win,
    run: (): void => runner(doc, win, fetchStub, intervalStub),
    serve: (calls: readonly CallRecord[]): void => {
      served = calls;
    },
    /** 模拟代理进程重启：内存里的记录清空，序号从 1 重新开始。 */
    restart: (id: string, calls: readonly CallRecord[] = []): void => {
      bootId = id;
      served = calls;
    },
    poll: async (): Promise<void> => {
      await poll?.();
      await settle();
    },
    click: async (id: string): Promise<void> => {
      const handler = buttons[id]?.clickHandler;
      if (handler !== null && handler !== undefined) handler({ target: buttons[id] });
      await settle();
    },
    callsUrls: (): string[] => fetchStub.mock.calls.map((args) => String(args[0])).filter((u) => u.includes('/__spy/api/calls')),
  };
}

describe('proxy/dashboard.html（沙箱执行内联脚本）', () => {
  it('初始空态；轮询增量按新→旧排列，计数与 since 游标随最大 seq 前进', async () => {
    const env = makeEnv();
    env.run();
    await env.poll(); // 首轮轮询（空数据）
    expect(env.rowsEl.innerHTML).toContain('暂无记录');

    env.serve([call(1), call(2)]);
    await env.poll();
    expect(env.rowsEl.innerHTML.indexOf('data-seq="2"')).toBeLessThan(env.rowsEl.innerHTML.indexOf('data-seq="1"'));
    expect(env.countEl.textContent).toBe('2 条接口 / 2 条请求');

    // 无新数据时不再重建 DOM；下一次轮询带推进后的游标
    const renders = env.rowsEl.renderCount;
    await env.poll();
    expect(env.callsUrls().at(-1)).toBe('/__spy/api/calls?since=2');
    expect(env.rowsEl.renderCount).toBe(renders);
  });

  it('清空重置游标（since 回 0）：清空后到达的新请求能重新显示', async () => {
    const env = makeEnv();
    env.run();
    await env.poll();
    env.serve([call(3)]);
    await env.poll();
    expect(env.rowsEl.innerHTML).toContain('data-seq="3"');

    await env.click('clear');
    expect(env.rowsEl.innerHTML).toContain('暂无记录');

    // 服务器 seq 接续（clear 不重置服务端编号），游标已归零 → 新请求照常出现
    env.serve([call(7)]);
    await env.poll();
    expect(env.rowsEl.innerHTML).toContain('data-seq="7"');
    expect(env.callsUrls()).toContain('/__spy/api/calls?since=0');
    // 游标接续到新 seq
    await env.poll();
    expect(env.callsUrls().at(-1)).toBe('/__spy/api/calls?since=7');
  });

  it('代理重启后序号从 1 重新开始：丢掉旧记录与展开状态，从头拉取新进程的请求', async () => {
    const env = makeEnv();
    env.run();
    await env.poll();
    env.serve([call(1), call(2)]);
    await env.poll();
    env.rowsEl.clickRow(1);

    // 面板还拿着 since=2 的高水位；重启后的第一条请求是 #1
    env.restart('boot-b', [call(1)]);
    await env.poll();
    expect(env.rowsEl.innerHTML).toContain('data-seq="1"');
    expect(env.rowsEl.innerHTML).not.toContain('data-seq="2"');
    // 旧进程里 #1 是展开的，新进程的 #1 是另一条请求
    expect(env.rowsEl.innerHTML).not.toContain('class="row open"');
    expect(env.countEl.textContent).toBe('1 条接口 / 1 条请求');
    expect(env.callsUrls()).toContain('/__spy/api/calls?since=0');

    await env.poll();
    expect(env.callsUrls().at(-1)).toBe('/__spy/api/calls?since=1');
    env.restart('boot-b', [call(1), call(2)]);
    await env.poll();
    expect(env.rowsEl.innerHTML).toContain('data-seq="2"');
  });

  it('代理重启后还没有新请求：旧记录清掉，回到空态', async () => {
    const env = makeEnv();
    env.run();
    await env.poll();
    env.serve([call(1)]);
    await env.poll();
    expect(env.rowsEl.innerHTML).toContain('data-seq="1"');

    env.restart('boot-b');
    await env.poll();
    expect(env.rowsEl.innerHTML).toContain('暂无记录');
    expect(env.countEl.textContent).toBe('0 条接口 / 0 条请求');
  });

  it('点开展开的行，增量重建后展开状态保持', async () => {
    const env = makeEnv();
    env.run();
    await env.poll();
    env.serve([call(1), call(2)]);
    await env.poll();
    env.rowsEl.clickRow(1);

    env.serve([call(3)]);
    await env.poll();
    expect(env.rowsEl.innerHTML).toContain('<div class="row open" data-seq="1">');
    expect(env.rowsEl.innerHTML).not.toContain('<div class="row open" data-seq="2">');
  });

  it('滚动锚点：停在列表中间时，新行到达不把正在看的内容推走', async () => {
    const env = makeEnv();
    env.run();
    await env.poll();
    env.serve([call(1), call(2)]);
    await env.poll();
    // 行桩 offsetTop：seq2 → 0、seq1 → 10；此时视口顶上是 seq1
    env.serve([call(3)]);
    env.scrollTo.mockClear();
    // 模拟已滚动：render 读 window.scrollY 决定锚点
    env.win.scrollY = 10;
    await env.poll();
    // 新行 seq3 顶到最上面（offsetTop 0），seq1 被推到 offsetTop 20 → 滚回它原来的视位
    expect(env.scrollTo).toHaveBeenCalledWith(0, 20);
  });

  it('停在顶部时新行直接可见不额外滚动；auto 模式重建后回顶部', async () => {
    const env = makeEnv();
    env.run();
    await env.poll();
    env.serve([call(1)]);
    await env.poll();

    env.scrollTo.mockClear();
    env.serve([call(2)]);
    await env.poll();
    expect(env.scrollTo).not.toHaveBeenCalled(); // scrollY=0：新行直接出现在顶部

    await env.click('auto');
    env.serve([call(3)]);
    await env.poll();
    expect(env.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('只看接口：静态资源不进列表但计入总数', async () => {
    const env = makeEnv();
    env.run();
    await env.poll();
    env.serve([call(1), { ...call(2), kind: 'asset' }]);
    await env.poll();
    expect(env.rowsEl.innerHTML).toContain('data-seq="1"');
    expect(env.rowsEl.innerHTML).not.toContain('data-seq="2"');
    expect(env.countEl.textContent).toBe('1 条接口 / 2 条请求');
  });
});
