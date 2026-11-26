import type { Cell } from '../types';
import type { SerializedSheetData, Store } from '../store/Store';
import type { SheetData } from '../store/SheetData';
import { WORKBOOK_FORMAT_VERSION, putWorkbookRecord, type WorkbookRecord } from './WorkbookDB';

/**
 * Chunked workbook encoding for background auto-saves. The old auto-save put
 * the whole object graph (or one giant JSON string) per save: structured
 * cloning or stringifying a million-cell workbook blocked the main thread for
 * hundreds of milliseconds, and editing one cell paid for the whole workbook
 * again. Here the store events mark sheets dirty, `snapshot()` sweeps only
 * the dirty ones (one `forEachCell` pass each), `encode()` turns each sheet
 * into its JSON string in ~20k-cell chunks that yield the main thread in
 * between, and sheets that did not change reuse the string of their last
 * successful commit.
 */

/** Cells per chunk: a chunk stringifies in a few milliseconds and the yield
 * after it keeps every background task well under the long-task threshold. */
export const AUTOSAVE_ENCODE_CHUNK_CELLS = 20_000;

/** Waits one task turn between encode chunks (injectable for tests). */
export type YieldFn = () => Promise<void>;

function defaultYield(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A cell as it goes into JSON: the transient pasteStyle is dropped, same as serialize(). */
function jsonCell(cell: Cell): Cell {
  if (cell.pasteStyle === undefined) return cell;
  const { pasteStyle: _p, ...rest } = cell;
  return rest;
}

/** A dirty sheet as taken by snapshot(): cells as flat r, c, cell triples in
 * forEachCell visit order — one synchronous sweep, no "r,c" strings or tuples
 * built here. encode() makes those per chunk when it stringifies. */
export interface SheetSnapshot {
  readonly sheetId: string;
  /** Flat triples: index % 3 === 0 is the row, +1 the column, +2 the cell. */
  readonly cells: Array<number | Cell>;
  readonly features: Omit<SerializedSheetData, 'cells'>;
}

export interface WorkbookSnapshot {
  /** Encoder epoch when the snapshot was taken; a bump voids the snapshot. */
  readonly epoch: number;
  readonly sheets: readonly SheetSnapshot[];
}

function snapshotCells(sheet: SheetData): Array<number | Cell> {
  const triples: Array<number | Cell> = [];
  sheet.forEachCell((r, c, cell) => {
    triples.push(r, c, cell);
  });
  return triples;
}

export class WorkbookEncoder {
  private readonly store: Store;
  private readonly yieldFn: YieldFn;
  /** Sheets whose content changed since the last successful commit. */
  private readonly dirty = new Set<string>();
  /** JSON string per sheet as of the last successful commit; unchanged sheets reuse it. */
  private readonly cache = new Map<string, string>();
  /** Bumped when a snapshot in flight is void (workbook replace, full write). */
  private epoch = 0;

  public constructor(store: Store, yieldFn?: YieldFn | undefined) {
    this.store = store;
    this.yieldFn = yieldFn ?? defaultYield;
  }

  /** A sheet's content changed (cells, axes, styles, merges, features). */
  public noteChange(sheetId: string | undefined): void {
    this.dirty.add(sheetId ?? this.store.getActiveSheetId());
  }

  /** Sheets were added / deleted / renamed / moved / recolored: the record's
   * sheet array is rebuilt from the store on every save and the data strings
   * survive, so only the cache of a deleted sheet must not linger. A newly
   * added sheet has no cached string and is encoded on its first save. */
  public noteStructure(): void {
    const live = new Set(this.store.getSheets().map((sheet) => sheet.id));
    for (const sheetId of this.cache.keys()) {
      if (!live.has(sheetId)) this.cache.delete(sheetId);
    }
  }

  /** The whole workbook was swapped (open / new / restore): everything is
   * dirty, cached strings are void, and any round still encoding the old
   * snapshot aborts instead of writing a mix of old and new sheets. */
  public noteReplaced(): void {
    this.epoch += 1;
    this.cache.clear();
    for (const sheet of this.store.getSheets()) this.dirty.add(sheet.id);
  }

  /** A synchronous full write is starting (pagehide / hidden / stop): a
   * background round still encoding must not put over it — IndexedDB commits
   * puts to one record in creation order, so its later, stale put would win. */
  public noteLeaving(): void {
    this.epoch += 1;
  }

  /** Takes the dirty sheets' content synchronously (the one synchronous sweep
   * a background save is allowed) and clears the dirty set; changes from now
   * on belong to the next round. */
  public snapshot(): WorkbookSnapshot {
    const epoch = this.epoch;
    const dirty = [...this.dirty];
    this.dirty.clear();
    const sheets: SheetSnapshot[] = [];
    for (const sheetId of dirty) {
      const sheet = this.store.getSheetData(sheetId);
      if (sheet === undefined) continue; // deleted since it was marked
      sheets.push({ sheetId, cells: snapshotCells(sheet), features: sheet.serializeFeatures() });
    }
    return { epoch, sheets };
  }

  /** Puts a round's sheets back on the dirty set (a failed round must retry). */
  public redirty(snapshot: WorkbookSnapshot): void {
    for (const sheet of snapshot.sheets) this.dirty.add(sheet.sheetId);
  }

  /** Encodes every snapshot sheet to its JSON string, chunk by chunk with a
   * yield between chunks. Returns null when the workbook was replaced — or a
   * full write started — since the snapshot: the round is void and nothing
   * was encoded for the caller to use. */
  public async encode(snapshot: WorkbookSnapshot, yieldFn: YieldFn = this.yieldFn): Promise<ReadonlyMap<string, string> | null> {
    const strings = new Map<string, string>();
    for (const sheet of snapshot.sheets) {
      const json = await this.encodeSheet(sheet.cells, sheet.features, snapshot.epoch, yieldFn);
      if (json === null) return null;
      strings.set(sheet.sheetId, json);
    }
    return strings;
  }

  /**
   * Builds the v2 record from the store's current sheet list (order, names,
   * colors), fills sheets the snapshot missed (added mid-round, no cached
   * string) with a chunked encode, writes it, and on success adopts the
   * strings as the reusable cache. Returns false when superseded — nothing
   * was written, and the caller re-dirties the snapshot for the next round.
   */
  public async commitPut(id: string, snapshot: WorkbookSnapshot, encoded: ReadonlyMap<string, string>): Promise<boolean> {
    const strings = new Map(encoded);
    for (const sheet of this.store.getSheets()) {
      if (strings.has(sheet.id) || this.cache.has(sheet.id)) continue;
      const data = this.store.getSheetData(sheet.id);
      if (data === undefined) continue;
      const json = await this.encodeSheet(snapshotCells(data), data.serializeFeatures(), snapshot.epoch, this.yieldFn);
      if (json === null) return false;
      strings.set(sheet.id, json);
    }
    if (this.epoch !== snapshot.epoch) return false;
    await putWorkbookRecord(this.buildRecord(id, strings));
    const live = new Set(this.store.getSheets().map((sheet) => sheet.id));
    for (const [sheetId, json] of strings) {
      if (live.has(sheetId)) this.cache.set(sheetId, json);
    }
    for (const sheetId of this.cache.keys()) {
      if (!live.has(sheetId)) this.cache.delete(sheetId);
    }
    return true;
  }

  private buildRecord(id: string, strings: ReadonlyMap<string, string>): WorkbookRecord {
    const sheets = this.store.getSheets().map((sheet) => {
      const data = strings.get(sheet.id) ?? this.cache.get(sheet.id);
      // Only a sheet added during the very last yield can get here; the write
      // fails, is logged, and the next round saves it.
      if (data === undefined) throw new Error(`Auto-save lost the encoding of sheet ${sheet.id}`);
      const base = { id: sheet.id, name: sheet.name, data };
      return sheet.color === undefined ? base : { ...base, color: sheet.color };
    });
    return {
      id,
      updatedAt: Date.now(),
      formatVersion: WORKBOOK_FORMAT_VERSION,
      activeSheetId: this.store.getActiveSheetId(),
      passwordHash: this.store.getWorkbookPasswordHash(),
      sheets,
    };
  }

  /**
   * One sheet's SerializedSheetData as JSON, ~AUTOSAVE_ENCODE_CHUNK_CELLS
   * cells per chunk with a yield (and void check) between chunks. The string
   * is assembled piecewise — cells first, then the stringified feature tail —
   * so a million-cell sheet never stringifies in one task, and parses back to
   * exactly what serialize() would have produced (pasteStyle stripped).
   */
  private async encodeSheet(cells: Array<number | Cell>, features: Omit<SerializedSheetData, 'cells'>, epoch: number, yieldFn: YieldFn): Promise<string | null> {
    const parts: string[] = ['{"cells":['];
    const count = Math.floor(cells.length / 3);
    let first = true;
    for (let start = 0; start < count; start += AUTOSAVE_ENCODE_CHUNK_CELLS) {
      const end = Math.min(start + AUTOSAVE_ENCODE_CHUNK_CELLS, count);
      const chunk: string[] = [];
      for (let i = start; i < end; i += 1) {
        const r = cells[3 * i] as number;
        const c = cells[3 * i + 1] as number;
        const cell = cells[3 * i + 2] as Cell;
        chunk.push(JSON.stringify([`${r},${c}`, jsonCell(cell)]));
      }
      parts.push(first ? '' : ',', chunk.join(','));
      first = false;
      await yieldFn();
      if (this.epoch !== epoch) return null;
    }
    // The tail object's first key is dropped with its '{' — it lands right
    // after the cells array inside the sheet object.
    parts.push('],', JSON.stringify(features).slice(1));
    return parts.join('');
  }
}
