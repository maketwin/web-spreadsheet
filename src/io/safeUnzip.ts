import { unzipSync, type UnzipFileInfo } from 'fflate';

/** Reject zip entries that claim an absurd uncompressed size (xlsx zip bombs). */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** A package refused because inflating it would exceed the limits; the message is shown to the user as is. */
export class ZipTooLargeError extends Error {
  public constructor() {
    super('文件解压后过大，已拒绝读取');
    this.name = 'ZipTooLargeError';
  }
}

export interface SafeUnzipOptions {
  /**
   * What happens to a package over the limits. `skip` (default) leaves the
   * oversized entries out — right for packages this app wrote itself.
   * `throw` refuses the whole package — right for imports, where a missing
   * part means a broken workbook.
   */
  readonly oversized?: 'skip' | 'throw';
}

export function safeUnzip(data: Uint8Array, options: SafeUnzipOptions = {}): Record<string, Uint8Array> {
  let total = 0;
  return unzipSync(data, {
    filter(file: UnzipFileInfo): boolean {
      const size = file.originalSize;
      if (Number.isFinite(size) && size >= 0 && size <= MAX_ENTRY_BYTES && total + size <= MAX_TOTAL_BYTES) {
        total += size;
        return true;
      }
      if (options.oversized === 'throw') throw new ZipTooLargeError();
      return false;
    },
  });
}
