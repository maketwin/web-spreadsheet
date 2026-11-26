import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveWorkbook, loadWorkbook, deleteWorkbook, DEFAULT_ID, WORKBOOK_FORMAT_VERSION } from '../../src/db/WorkbookDB';
import type { WorkbookRecord } from '../../src/db/WorkbookDB';
import { Store } from '../../src/store/Store';

/** Talks to the same database the way a previous build would have: raw records, no helpers. */
function rawRecord(id: string, record?: Omit<Record<string, unknown>, 'id'>): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('web-spreadsheet');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const tx = database.transaction('workbooks', record === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('workbooks');
      const request = record === undefined ? store.get(id) : store.put({ id, ...record });
      tx.oncomplete = () => { database.close(); resolve(request.result as Record<string, unknown> | undefined); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/** A workbook exercising every serialized feature: two sheets, one tinted,
 * styles, merges, row/col meta, formulas, rich text, a transient pasteStyle. */
function richStore(): Store {
  const store = new Store();
  const first = store.getActiveSheetId();
  const second = store.addSheet('数据');
  store.setSheetColor(second, '#ff0000');
  store.activateSheet(first);
  store.batch(() => {
    store.setCell(0, 0, { text: 'Hello', value: 'Hello' });
    store.setCell(0, 1, { text: '=A1+1', formula: '=A1+1', value: 2 });
    store.setCell(1, 0, { text: 'ab', richText: [{ text: 'a' }, { text: 'b', style: { bold: true } }] });
    store.setCell(2, 0, { text: 'pasted', value: 'pasted', pasteStyle: { bold: true } });
    store.setCell(0, 2, { text: 'styled', value: 'styled', styleId: 'fmt-1' });
    store.setStyle('fmt-1', { bold: true, bgcolor: '#ffff00', numberFormat: '#,##0.00' }, first);
    store.addMerge('A5:B6', first);
    store.setRow(0, { height: 42 }, first);
    store.setCol(1, { width: 130 }, first);
    store.setCell(0, 0, { text: '第二表', value: '第二表' }, second);
  });
  return store;
}

describe('WorkbookDB', () => {
  const testId = `test-${Date.now()}`;

  beforeEach(async () => {
    await deleteWorkbook(testId).catch(() => undefined);
  });

  it('saves and loads a workbook', async () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello', value: 'Hello' });
    const data = store.serialize();

    await saveWorkbook(testId, data);
    const loaded = await loadWorkbook(testId);

    expect(loaded).toBeDefined();
    expect(loaded).toEqual(data);
    expect(loaded!.sheets[0]!.data.cells.length).toBeGreaterThan(0);
  });

  it('saves a v2 record: one JSON string per sheet, no object graph', async () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello', value: 'Hello' });

    await saveWorkbook(testId, store.serialize());
    const record = await rawRecord(testId);

    expect(record?.formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
    expect(record?.data).toBeUndefined();
    expect(record?.activeSheetId).toBe('sheet-1');
    const sheets = record?.sheets as WorkbookRecord['sheets'];
    expect(sheets).toHaveLength(1);
    expect(typeof sheets![0]!.data).toBe('string');
    expect(JSON.parse(sheets![0]!.data)).toEqual(store.getSheetData()!.serialize());
  });

  it('reads a hand-written v2 record', async () => {
    const store = new Store();
    const second = store.addSheet('Tinted');
    store.setSheetColor(second, '#00ff00');
    store.setCell(0, 0, { text: 'v2', value: 'v2' });
    store.setCell(0, 0, { text: 'on2', value: 'on2' }, second);
    const data = store.serialize();

    await rawRecord(testId, {
      updatedAt: 1234,
      formatVersion: 2,
      activeSheetId: second,
      passwordHash: 'abc123',
      sheets: data.sheets.map((sheet) => ({
        id: sheet.id,
        name: sheet.name,
        ...(sheet.color === undefined ? {} : { color: sheet.color }),
        data: JSON.stringify(sheet.data),
      })),
    });
    const loaded = await loadWorkbook(testId);

    expect(loaded).toEqual({ ...data, passwordHash: 'abc123' });
    expect(loaded?.activeSheetId).toBe(second);
  });

  it('round-trips a rich workbook exactly (multi-sheet, styles, merges, axis meta, formulas, rich text, dropped pasteStyle)', async () => {
    const store = richStore();
    const data = store.serialize();

    await saveWorkbook(testId, data);
    const loaded = await loadWorkbook(testId);

    expect(loaded).toEqual(data);
    expect(Store.deserialize(loaded!).serialize()).toEqual(Store.deserialize(data).serialize());
    // The transient paste style never reaches the stored JSON.
    await rawRecord(testId).then((record) => {
      const sheets = record?.sheets as WorkbookRecord['sheets'];
      expect(sheets!.some((sheet) => sheet.data.includes('pasteStyle'))).toBe(false);
    });
  });

  it('loads undefined for missing workbook', async () => {
    const loaded = await loadWorkbook('nonexistent-id');
    expect(loaded).toBeUndefined();
  });

  it('deletes a workbook', async () => {
    const delId = `del-${Date.now()}`;
    const store = new Store();
    await saveWorkbook(delId, store.serialize());

    await deleteWorkbook(delId);
    const loaded = await loadWorkbook(delId);

    expect(loaded).toBeUndefined();
  });

  it('DEFAULT_ID is "default"', () => {
    expect(DEFAULT_ID).toBe('default');
  });

  it('stamps a saved record with the format version', async () => {
    await saveWorkbook(testId, new Store().serialize());
    const record = await rawRecord(testId);
    expect(record?.formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
  });

  it('reads a record saved before versions were kept', async () => {
    const data = new Store().serialize();
    await rawRecord(testId, { data, updatedAt: Date.now() });
    const loaded = await loadWorkbook(testId);
    expect(loaded).toEqual(data);
  });

  it('refuses a record from a newer format, says which, and leaves it untouched', async () => {
    const newer = WORKBOOK_FORMAT_VERSION + 1;
    const data = new Store().serialize();
    await rawRecord(testId, { data, updatedAt: Date.now(), formatVersion: newer });

    await expect(loadWorkbook(testId)).rejects.toThrow(new RegExp(`format version ${newer}`));
    await expect(loadWorkbook(testId)).rejects.toThrow(new RegExp(`up to version ${WORKBOOK_FORMAT_VERSION}`));
    expect((await rawRecord(testId))?.formatVersion).toBe(newer);
  });

  it('refuses a v3 record written in the v2 shape and leaves it untouched', async () => {
    const sheets = [{ id: 'sheet-1', name: 'Sheet1', data: JSON.stringify(new Store().getSheetData()!.serialize()) }];
    await rawRecord(testId, { updatedAt: 42, formatVersion: 3, activeSheetId: 'sheet-1', sheets });

    await expect(loadWorkbook(testId)).rejects.toThrow(/format version 3/);
    const after = await rawRecord(testId);
    expect(after?.formatVersion).toBe(3);
    expect(after?.sheets).toEqual(sheets);
  });
});
