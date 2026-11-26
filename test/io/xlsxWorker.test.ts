import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSXLib from 'xlsx';
import type { CellObject, WorkSheet } from 'xlsx';
import { zipSync } from 'fflate';
import type { SerializedStore } from '../../src/store/Store';
import type * as ClientModule from '../../src/io/xlsxWorkerClient';
import type * as WorkerModule from '../../src/io/xlsxWorker';
import { TOTAL_ROWS } from '../../src/util/gridSize';

// Reading an xlsx is paid for by the file, not by the grid: a large sheet
// takes seconds to parse. That work belongs in a worker — and wherever a
// worker cannot be made, or fails, the same work must still happen here.
type Client = typeof ClientModule;
type Worker = typeof WorkerModule;
type Ports = { client: Client; worker: Worker };

/** A fresh client per test: which thread it uses is decided once and remembered. */
async function load(): Promise<Ports> {
  vi.resetModules();
  const [client, worker] = await Promise.all([import('../../src/io/xlsxWorkerClient'), import('../../src/io/xlsxWorker')]);
  return { client: client as Client, worker: worker as Worker };
}

function workbookBytes(cells: Record<string, CellObject>, ref = { s: { r: 0, c: 0 }, e: { r: 2, c: 2 } }): ArrayBuffer {
  const ws: WorkSheet = { ...cells, '!ref': XLSXLib.utils.encode_range(ref) };
  const wb = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSXLib.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const garbage = (): ArrayBuffer => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]).buffer as ArrayBuffer;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('xlsx worker request handling', () => {
  it('reads a package, dropping only beyond-space cells silently', async () => {
    const { worker } = await load();
    const bytes = workbookBytes({ A1: { t: 'n', v: 7 }, [`A${TOTAL_ROWS + 1}`]: { t: 'n', v: 1 } }, { s: { r: 0, c: 0 }, e: { r: TOTAL_ROWS, c: 0 } });
    const response = worker.handleXlsxRequest({ id: 1, kind: 'import', buffer: bytes });
    expect(response.ok).toBe(true);
    if (!response.ok || typeof response.result === 'string' || response.result instanceof ArrayBuffer) throw new Error('not an import result');
    // A1048577 lies past the address space (crafted garbage): dropped, and
    // since real files cannot exceed the space there is no truncation warning.
    expect(response.result.workbook.sheets[0]!.data.cells.map(([key]) => key)).toEqual(['0,0']);
    expect(response.result.warnings).toEqual([]);
  });

  it('exports a serialized workbook and reads it back', async () => {
    const { worker } = await load();
    const workbook: SerializedStore = { activeSheetId: 'sheet-1', sheets: [{ id: 'sheet-1', name: '数据', data: { cells: [['0,0', { text: '名称', value: '名称' }], ['1,0', { text: '42', value: 42 }]], rows: [], cols: [], styles: [], merges: [], conditionalRules: [], charts: [], images: [], validationRules: [], sparklines: [], namedRanges: [], rowGroups: [] } }] };
    const exported = worker.handleXlsxRequest({ id: 1, kind: 'export', workbook });
    expect(exported.ok).toBe(true);
    if (!exported.ok || !(exported.result instanceof ArrayBuffer)) throw new Error('not a buffer');
    const read = worker.handleXlsxRequest({ id: 2, kind: 'import', buffer: exported.result });
    if (!read.ok || typeof read.result === 'string' || read.result instanceof ArrayBuffer) throw new Error('not an import result');
    expect(read.result.workbook.sheets[0]!.name).toBe('数据');
    expect(read.result.workbook.sheets[0]!.data.cells.some(([, cell]) => cell.text === '42')).toBe(true);
  });

  it('tells a refusal that names its reason from a broken file', async () => {
    const { worker } = await load();
    // 129 MB of zeros: tiny compressed, over the entry limit once inflated.
    const zipped = zipSync({ 'xl/workbook.xml': new Uint8Array(129 * 1024 * 1024) });
    const tooLarge = worker.handleXlsxRequest({ id: 1, kind: 'import', buffer: zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer });
    expect(tooLarge).toEqual({ id: 1, ok: false, error: '文件解压后过大，已拒绝读取', userFacing: true });
    const broken = worker.handleXlsxRequest({ id: 2, kind: 'import', buffer: garbage() });
    expect(broken.ok).toBe(false);
    if (broken.ok) throw new Error('should fail');
    expect(broken.userFacing).toBe(false);
  });
});

describe('xlsx worker client', () => {
  it('runs on the main thread where there is no Worker, with the same results and messages', async () => {
    const { client } = await load();
    expect(typeof Worker === 'undefined' || client.xlsxThread() === 'main').toBe(true);
    const imported = await client.importXlsxOffThread(workbookBytes({ A1: { t: 'n', v: 7 } }));
    expect(imported.workbook.sheets[0]!.data.cells[0]![1].value).toBe(7);
    await expect(client.importXlsxOffThread(garbage())).rejects.toThrow('xlsx 解析失败，请检查文件是否损坏');
    const zipped = zipSync({ 'big.bin': new Uint8Array(129 * 1024 * 1024) });
    await expect(client.importXlsxOffThread(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer)).rejects.toThrow('文件解压后过大，已拒绝读取');
  });

  it('uses a worker when the page provides one', async () => {
    const { worker } = await load();
    class FakeWorker {
      static instances: FakeWorker[] = [];
      onmessage: ((event: { data: WorkerModule.XlsxWorkerResponse }) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      terminated = false;
      constructor(public readonly url: URL, public readonly options: WorkerOptions | undefined) { FakeWorker.instances.push(this); }
      postMessage(request: WorkerModule.XlsxWorkerRequest): void { queueMicrotask(() => { this.onmessage?.({ data: worker.handleXlsxRequest(request) }); }); }
      terminate(): void { this.terminated = true; }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const { client } = await load();
    expect(client.xlsxThread()).toBe('worker');
    const imported = await client.importXlsxOffThread(workbookBytes({ B2: { t: 'n', v: 9 } }));
    expect(imported.workbook.sheets[0]!.data.cells.some(([, cell]) => cell.value === 9)).toBe(true);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]!.url.pathname.endsWith('xlsxWorker.ts')).toBe(true);
    expect(FakeWorker.instances[0]!.options?.type).toBe('module');
    await expect(client.importXlsxOffThread(garbage())).rejects.toThrow('xlsx 解析失败，请检查文件是否损坏');
  });

  it('finishes on the main thread what a failing worker was holding', async () => {
    class DeadWorker {
      static instance: DeadWorker | null = null;
      onmessage: ((event: unknown) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor() { DeadWorker.instance = this; }
      postMessage(_request: unknown): void { /* never answers */ }
      terminate(): void { /* gone */ }
    }
    vi.stubGlobal('Worker', DeadWorker);
    const { client } = await load();
    const pending = client.importXlsxOffThread(workbookBytes({ C3: { t: 'n', v: 3 } }));
    expect(DeadWorker.instance).not.toBeNull();
    // The chunk does not load: the worker reports an error and is dropped.
    DeadWorker.instance!.onerror?.(new Event('error'));
    const imported = await pending;
    expect(imported.workbook.sheets[0]!.data.cells.some(([, cell]) => cell.value === 3)).toBe(true);
    expect(client.xlsxThread()).toBe('main');
  });
});
