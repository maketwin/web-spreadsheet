import { unzipSync, type UnzipFileInfo } from 'fflate';

/**
 * Ceilings for untrusted packages (imports). The filter below runs BEFORE any
 * entry is decompressed: fflate reads each entry's `originalSize` straight
 * from the central directory, so a zip bomb is rejected on its declared size
 * and never inflates. A lying declaration cannot amplify either — fflate
 * inflates into a buffer of exactly the declared size, so at worst the data
 * is truncated at it. The numbers only need to cover honest Excel output: a
 * million-row worksheet part is ~40-50 MB uncompressed, so the old 32 MiB
 * entry cap refused real files; a bomb still has to claim hundreds of MB.
 */
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

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
