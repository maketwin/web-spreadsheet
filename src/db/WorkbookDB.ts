import Dexie, { type EntityTable } from 'dexie';
import type { SerializedSheetData, SerializedStore } from '../store/Store';

/**
 * v1 kept the whole workbook as one object graph, so IndexedDB had to
 * structured-clone a million Cell objects on every save. v2 stores workbook
 * fields directly and one JSON string per sheet: cloning strings is a copy,
 * and the auto-save encoder can rewrite only the sheets that changed.
 */
export interface WorkbookRecord {
  readonly id: string;
  readonly updatedAt: number;
  /** Missing on records saved before versions were kept; those read as version 1. */
  readonly formatVersion?: number | undefined;
  /** v1: the whole workbook as an object graph. */
  readonly data?: SerializedStore;
  /** v2: workbook-level fields plus one JSON string per sheet. */
  readonly activeSheetId?: string | undefined;
  readonly passwordHash?: string | undefined;
  readonly sheets?: Array<{ readonly id: string; readonly name: string; readonly color?: string; readonly data: string }>;
}

const DB_NAME = 'web-spreadsheet';
const DEFAULT_ID = 'default';

/**
 * The shape of a saved workbook. Bump it when a change lands that older builds
 * must not read: a build refuses a newer record instead of loading shapes it
 * does not understand. Version 2 splits the record into per-sheet JSON
 * strings; version 1 builds refuse a v2 record (no `data` field) the same way.
 */
export const WORKBOOK_FORMAT_VERSION = 2;

class WorkbookDB extends Dexie {
  public workbooks!: EntityTable<WorkbookRecord, 'id'>;

  public constructor() {
    super(DB_NAME);
    // formatVersion is not indexed, so existing databases need no schema bump.
    this.version(1).stores({
      workbooks: 'id, updatedAt',
    });
  }
}

const db = new WorkbookDB();

/** One sheet of a `SerializedStore` as a v2 record entry (JSON string). */
function sheetToRecord(sheet: SerializedStore['sheets'][number]): { id: string; name: string; color?: string; data: string } {
  const data = JSON.stringify(sheet.data);
  const base = { id: sheet.id, name: sheet.name, data };
  return sheet.color === undefined ? base : { ...base, color: sheet.color };
}

/** The whole workbook as a v2 record, encoded synchronously (manual saves). */
function storeToRecord(id: string, data: SerializedStore): WorkbookRecord {
  return {
    id,
    updatedAt: Date.now(),
    formatVersion: WORKBOOK_FORMAT_VERSION,
    activeSheetId: data.activeSheetId,
    passwordHash: data.passwordHash,
    sheets: data.sheets.map(sheetToRecord),
  };
}

/** A v2 record as a `SerializedStore`, parsing each sheet's JSON string. */
function recordToStore(record: WorkbookRecord): SerializedStore {
  const sheets = (record.sheets ?? []).map((sheet) => {
    const data = JSON.parse(sheet.data) as SerializedSheetData;
    return sheet.color === undefined ? { id: sheet.id, name: sheet.name, data } : { id: sheet.id, name: sheet.name, color: sheet.color, data };
  });
  return {
    activeSheetId: record.activeSheetId ?? sheets[0]?.id ?? 'sheet-1',
    passwordHash: record.passwordHash,
    sheets,
  };
}

export async function saveWorkbook(id: string, data: SerializedStore): Promise<void> {
  await db.workbooks.put(storeToRecord(id, data));
}

/**
 * Writes a fully built record verbatim (used by the sharded auto-save
 * encoder, which assembles it from cached and freshly encoded sheets).
 */
export async function putWorkbookRecord(record: WorkbookRecord): Promise<void> {
  await db.workbooks.put(record);
}

/**
 * The workbook stored under `id`, or undefined when there is none. Rejects
 * for a record written by a newer format: the record is left as it is.
 */
export async function loadWorkbook(id: string): Promise<SerializedStore | undefined> {
  const record = await db.workbooks.get(id);
  if (record === undefined) return undefined;
  const version = record.formatVersion ?? 1;
  if (version > WORKBOOK_FORMAT_VERSION) {
    throw new Error(`Saved workbook "${id}" is in format version ${version}; this build reads up to version ${WORKBOOK_FORMAT_VERSION}. The record was left untouched.`);
  }
  return version >= 2 ? recordToStore(record) : record.data;
}

export async function deleteWorkbook(id: string): Promise<void> {
  await db.workbooks.delete(id);
}

export { DEFAULT_ID };
