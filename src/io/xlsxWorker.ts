import { Store, type SerializedStore } from '../store/Store';
import { exportXlsxBuffer } from './XlsxExporter';
import { importXlsx } from './XlsxImporter';
import { ZipTooLargeError } from './safeUnzip';

/**
 * xlsx import and export off the main thread. Reading a workbook is paid for
 * by the file, not by the grid: a large sheet takes SheetJS seconds even
 * though only 1000 × 26 cells of it are kept, and the page is frozen for
 * every one of them. The work is the same as on the main thread (the very
 * same functions), so the two paths cannot drift.
 *
 * The bundle is loaded only when an xlsx is first opened or saved, and
 * xlsxWorkerClient falls back to the main thread wherever a worker cannot be
 * made: tests, Node, a CSP without worker-src.
 */
export interface XlsxImportResult {
  readonly workbook: SerializedStore;
  /** What the import left out (cells beyond the grid, …), worded for the user. */
  readonly warnings: readonly string[];
}

export type XlsxWorkerRequest =
  | { readonly id: number; readonly kind: 'import'; readonly buffer: ArrayBuffer }
  | { readonly id: number; readonly kind: 'export'; readonly workbook: SerializedStore };

export type XlsxWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly result: XlsxImportResult | ArrayBuffer }
  | { readonly id: number; readonly ok: false; readonly error: string; readonly userFacing: boolean };

/** One request, start to finish — the whole worker as a function, so it can be unit-tested. */
export function handleXlsxRequest(request: XlsxWorkerRequest): XlsxWorkerResponse {
  try {
    if (request.kind === 'import') {
      const warnings: string[] = [];
      const workbook = importXlsx(request.buffer, (warning) => { warnings.push(warning); });
      return { id: request.id, ok: true, result: { workbook, warnings } };
    }
    return { id: request.id, ok: true, result: exportXlsxBuffer(Store.deserialize(request.workbook)) };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      // A refusal that names its reason ("too large") is meant for the user; a parser error is not.
      userFacing: error instanceof ZipTooLargeError,
    };
  }
}

const port = self as unknown as {
  onmessage: ((event: MessageEvent<XlsxWorkerRequest>) => void) | null;
  postMessage: (response: XlsxWorkerResponse, transfer?: Transferable[]) => void;
};

port.onmessage = (event) => {
  const response = handleXlsxRequest(event.data);
  port.postMessage(response, response.ok && response.result instanceof ArrayBuffer ? [response.result] : []);
};
