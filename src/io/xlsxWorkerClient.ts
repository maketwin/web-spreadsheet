import { Store, type SerializedStore } from '../store/Store';
import { exportXlsxBuffer } from './XlsxExporter';
import { importXlsx } from './XlsxImporter';
import { ZipTooLargeError } from './safeUnzip';
import type { XlsxImportResult, XlsxWorkerRequest, XlsxWorkerResponse } from './xlsxWorker';

type Result = XlsxImportResult | ArrayBuffer;
/** A request without its id, kind by kind (a plain Omit would merge the kinds). */
type RequestBody<T = XlsxWorkerRequest> = T extends XlsxWorkerRequest ? Omit<T, 'id'> : never;
interface Pending {
  /** The same work on the main thread, for when the worker cannot do it. */
  readonly fallback: () => Result;
  /** What the user is told when the work fails without a reason of its own. */
  readonly failureMessage: string;
  readonly resolve: (value: Result) => void;
  readonly reject: (error: Error) => void;
}

const IMPORT_FAILED = 'xlsx 解析失败，请检查文件是否损坏';
const EXPORT_FAILED = 'xlsx 导出失败';

/** undefined: not made yet. null: it cannot be made here, or it failed — everything runs on the main thread. */
let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

/** A refusal that names its reason ("too large") is passed on; anything else is not for the user. */
function failureOf(error: unknown, failureMessage: string): Error {
  return new Error(error instanceof ZipTooLargeError ? error.message : failureMessage);
}

function settle(response: XlsxWorkerResponse): void {
  const entry = pending.get(response.id);
  if (entry === undefined) return;
  pending.delete(response.id);
  if (response.ok) entry.resolve(response.result);
  else entry.reject(new Error(response.userFacing ? response.error : entry.failureMessage));
}

/** The worker is gone: what it still held is done here instead. */
function loseWorker(): void {
  worker = null;
  const held = [...pending.values()];
  pending.clear();
  for (const entry of held) {
    try {
      entry.resolve(entry.fallback());
    } catch (error) {
      entry.reject(failureOf(error, entry.failureMessage));
    }
  }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') {
    worker = null;
    return null;
  }
  try {
    const created = new Worker(new URL('./xlsxWorker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<XlsxWorkerResponse>) => settle(event.data);
    // A worker that cannot load (CSP, a bundler that dropped its chunk) must
    // not take the feature with it.
    created.onerror = (event) => { event.preventDefault(); created.terminate(); loseWorker(); };
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

function run(request: RequestBody, entry: Omit<Pending, 'resolve' | 'reject'>): Promise<Result> {
  const failureMessage = entry.failureMessage;
  const current = getWorker();
  if (current === null) {
    // Resolved in a microtask: callers have one, asynchronous, contract.
    return new Promise((resolve, reject) => {
      try {
        resolve(entry.fallback());
      } catch (error) {
        reject(failureOf(error, failureMessage));
      }
    });
  }
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { ...entry, resolve, reject });
    // The import buffer is copied, not transferred: the main thread needs the bytes if it has to read them itself.
    current.postMessage({ ...request, id }, []);
  });
}

/**
 * Read an xlsx package. It is parsed in a worker when the page allows one, so
 * the page stays responsive while a large file is read. Rejects with a
 * message meant for the user.
 */
export function importXlsxOffThread(buffer: ArrayBuffer): Promise<XlsxImportResult> {
  return run({ kind: 'import', buffer }, {
    failureMessage: IMPORT_FAILED,
    fallback: () => {
      const warnings: string[] = [];
      return { workbook: importXlsx(buffer, (warning) => { warnings.push(warning); }), warnings };
    },
  }) as Promise<XlsxImportResult>;
}

/** Build the xlsx package of a serialized workbook (see {@link importXlsxOffThread}). */
export function exportXlsxOffThread(workbook: SerializedStore): Promise<ArrayBuffer> {
  return run({ kind: 'export', workbook }, { failureMessage: EXPORT_FAILED, fallback: () => exportXlsxBuffer(Store.deserialize(workbook)) }) as Promise<ArrayBuffer>;
}

/** Where the next request runs — `main` in tests, Node and locked-down pages. */
export function xlsxThread(): 'worker' | 'main' {
  return getWorker() === null ? 'main' : 'worker';
}
