import Dexie, { type EntityTable } from 'dexie';
import type { SerializedStore } from '../store/Store';

interface WorkbookRecord {
  readonly id: string;
  readonly data: SerializedStore;
  readonly updatedAt: number;
}

const DB_NAME = 'web-spreadsheet';
const DEFAULT_ID = 'default';

class WorkbookDB extends Dexie {
  public workbooks!: EntityTable<WorkbookRecord, 'id'>;

  public constructor() {
    super(DB_NAME);
    this.version(1).stores({
      workbooks: 'id, updatedAt',
    });
  }
}

const db = new WorkbookDB();

export async function saveWorkbook(id: string, data: SerializedStore): Promise<void> {
  await db.workbooks.put({ id, data, updatedAt: Date.now() });
}

export async function loadWorkbook(id: string): Promise<SerializedStore | undefined> {
  const record = await db.workbooks.get(id);
  return record?.data;
}

export async function deleteWorkbook(id: string): Promise<void> {
  await db.workbooks.delete(id);
}

export { DEFAULT_ID };
