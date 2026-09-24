import { unzipSync, type UnzipFileInfo } from 'fflate';

/** Reject zip entries that claim an absurd uncompressed size (xlsx zip bombs). */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export function safeUnzip(data: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  return unzipSync(data, {
    filter(file: UnzipFileInfo): boolean {
      const size = file.originalSize;
      if (!Number.isFinite(size) || size < 0 || size > MAX_ENTRY_BYTES) return false;
      if (total + size > MAX_TOTAL_BYTES) return false;
      total += size;
      return true;
    },
  });
}
