import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteWorkbook, loadWorkbook } from '../../src/db/WorkbookDB';
import type { WorkbookRecord } from '../../src/db/WorkbookDB';
import { AUTOSAVE_ENCODE_CHUNK_CELLS, WorkbookEncoder } from '../../src/db/workbookEncoder';
import { Store } from '../../src/store/Store';

/** Yields without a task turn: chunk boundaries stay deterministic in tests. */
const immediateYield = (): Promise<void> => Promise.resolve();

/** Talks to the same database without going through the encoder. */
function rawRecord(id: string): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('web-spreadsheet');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const tx = database.transaction('workbooks', 'readonly');
      const request = tx.objectStore('workbooks').get(id);
      tx.oncomplete = () => { database.close(); resolve(request.result as Record<string, unknown> | undefined); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

function sheetsOf(id: string): Promise<NonNullable<WorkbookRecord['sheets']>> {
  return rawRecord(id).then((record) => (record?.sheets ?? []) as NonNullable<WorkbookRecord['sheets']>);
}

/** One full round: sweep the dirty sheets, encode them, write the record. */
async function commitAll(id: string, encoder: WorkbookEncoder): Promise<void> {
  const snapshot = encoder.snapshot();
  const strings = await encoder.encode(snapshot);
  expect(strings).not.toBeNull();
  expect(await encoder.commitPut(id, snapshot, strings!)).toBe(true);
}

function fillCells(store: Store, count: number, text: (i: number) => string): void {
  store.batch(() => {
    for (let i = 0; i < count; i += 1) {
      store.setCell(Math.floor(i / 10), i % 10, { text: text(i), value: i });
    }
  });
}

describe('WorkbookEncoder', () => {
  const usedIds = ['enc-boundary', 'enc-rich', 'enc-first', 'enc-dirty', 'enc-mutating', 'enc-structure', 'enc-delete', 'enc-replaced', 'enc-superseded', 'enc-rename-only', 'enc-smoke'];
  afterEach(async () => {
    for (const id of usedIds) await deleteWorkbook(id).catch(() => undefined);
  });

  it('encodes correctly across chunk boundaries and parses back to serialize()', async () => {
    const store = new Store();
    fillCells(store, 45_000, (i) => String(i)); // 45,000 cells → chunks of 20k / 20k / 5k
    const encoder = new WorkbookEncoder(store, immediateYield);
    encoder.noteChange(store.getActiveSheetId());
    const yieldFn = vi.fn(immediateYield);

    const snapshot = encoder.snapshot();
    const strings = await encoder.encode(snapshot, yieldFn);
    const json = strings!.get('sheet-1')!;

    const expected = store.getSheetData('sheet-1')!.serialize();
    expect(JSON.parse(json)).toEqual(expected);
    // Both sides of the first chunk boundary survive the split.
    expect(JSON.parse(json).cells[19_999]).toEqual(expected.cells[19_999]);
    expect(JSON.parse(json).cells[20_000]).toEqual(expected.cells[20_000]);
    expect(yieldFn).toHaveBeenCalledTimes(Math.ceil(45_000 / AUTOSAVE_ENCODE_CHUNK_CELLS));
  });

  it('round-trips a rich workbook through chunked encoding exactly', async () => {
    const id = 'enc-rich';
    const store = new Store();
    const first = store.getActiveSheetId();
    const second = store.addSheet('数据');
    store.setSheetColor(second, '#00ff00');
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
    const data = store.serialize();
    const encoder = new WorkbookEncoder(store, immediateYield);
    encoder.noteChange(first);
    encoder.noteChange(second);

    await commitAll(id, encoder);
    const loaded = await loadWorkbook(id);

    expect(loaded).toEqual(data);
    expect(JSON.stringify(loaded)).not.toContain('pasteStyle');
  });

  it('encodes sheets that were never marked dirty on the first save', async () => {
    const id = 'enc-first';
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    const second = store.addSheet('Second');
    store.setCell(0, 0, { text: 'b' }, second);
    const data = store.serialize();
    const encoder = new WorkbookEncoder(store, immediateYield); // nothing noted dirty

    await commitAll(id, encoder);
    const loaded = await loadWorkbook(id);

    expect(loaded).toEqual(data);
    expect(loaded?.sheets).toHaveLength(2);
  });

  it('re-encodes only the dirty sheet but keeps every sheet in the record', async () => {
    const id = 'enc-dirty';
    const store = new Store();
    store.setCell(0, 0, { text: 'a1' });
    const second = store.addSheet('Second');
    store.setCell(0, 0, { text: 'b1' }, second);
    const encoder = new WorkbookEncoder(store, immediateYield);
    const sheetA = store.getSheetData('sheet-1')!;
    const sheetB = store.getSheetData(second)!;
    const sweepA = vi.spyOn(sheetA, 'forEachCell');
    const sweepB = vi.spyOn(sheetB, 'forEachCell');

    encoder.noteChange('sheet-1');
    encoder.noteChange(second);
    await commitAll(id, encoder);
    const firstSheets = await sheetsOf(id);
    expect(firstSheets).toHaveLength(2);

    sweepA.mockClear();
    sweepB.mockClear();
    store.setCell(1, 1, { text: 'a2' });
    encoder.noteChange('sheet-1');
    await commitAll(id, encoder);

    expect(sweepB).not.toHaveBeenCalled(); // unchanged sheet: cache, no sweep
    expect(sweepA).toHaveBeenCalledTimes(1);
    const secondSheets = await sheetsOf(id);
    expect(secondSheets).toHaveLength(2);
    expect(secondSheets[1]).toEqual(firstSheets[1]); // reused verbatim
    expect(JSON.parse(secondSheets[0]!.data)).toEqual(sheetA.serialize());
  });

  it('writes the snapshot state during the encode and the new state next round', async () => {
    const id = 'enc-mutating';
    const store = new Store();
    fillCells(store, 20_001, (i) => String(i)); // two chunks, so the encode yields once mid-way
    const before = store.getSheetData('sheet-1')!.serialize();
    const encoder = new WorkbookEncoder(store, immediateYield);
    encoder.noteChange('sheet-1');
    let mutated = false;
    const yieldFn = vi.fn(async () => {
      if (!mutated) {
        mutated = true;
        store.setCell(0, 0, { text: 'changed' });
        encoder.noteChange('sheet-1'); // mirrors the auto-save subscriber
      }
    });

    const snapshot = encoder.snapshot();
    const strings = await encoder.encode(snapshot, yieldFn);
    expect(yieldFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(strings!.get('sheet-1')!)).toEqual(before); // snapshot state, not the mid-encode edit

    expect(await encoder.commitPut(id, snapshot, strings!)).toBe(true);
    let loaded = await loadWorkbook(id);
    expect(loaded!.sheets[0]!.data).toEqual(before);

    const next = encoder.snapshot(); // the edit re-marked the sheet dirty
    expect(next.sheets).toHaveLength(1);
    const nextStrings = await encoder.encode(next);
    expect(await encoder.commitPut(id, next, nextStrings!)).toBe(true);
    loaded = await loadWorkbook(id);
    expect(loaded!.sheets[0]!.data).toEqual(store.getSheetData('sheet-1')!.serialize());
    expect(loaded!.sheets[0]!.data.cells[0]).toEqual(['0,0', { text: 'changed' }]);
  });

  it('picks up sheets renamed and added during the encode', async () => {
    const id = 'enc-structure';
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    const snapshotState = store.getSheetData('sheet-1')!.serialize();
    const encoder = new WorkbookEncoder(store, immediateYield);
    encoder.noteChange('sheet-1');
    let structured = false;
    const yieldFn = vi.fn(async () => {
      if (!structured) {
        structured = true;
        store.renameSheet('sheet-1', 'Renamed');
        const added = store.addSheet('Extra');
        store.setCell(0, 0, { text: 'brand new' }, added);
        encoder.noteStructure(); // mirrors the auto-save subscriber
        encoder.noteChange(added);
      }
    });

    const snapshot = encoder.snapshot();
    const strings = await encoder.encode(snapshot, yieldFn);
    expect(await encoder.commitPut(id, snapshot, strings!)).toBe(true);

    const sheets = await sheetsOf(id);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toMatchObject({ id: 'sheet-1', name: 'Renamed' });
    expect(sheets[1]).toMatchObject({ name: 'Extra' });
    expect(JSON.parse(sheets[0]!.data)).toEqual(snapshotState); // snapshot content under the new name
    expect(JSON.parse(sheets[1]!.data).cells).toEqual([['0,0', { text: 'brand new' }]]);
    const loaded = await loadWorkbook(id);
    expect(loaded?.sheets.map((sheet) => sheet.name)).toEqual(['Renamed', 'Extra']);
  });

  it('drops sheets deleted during the encode from the record', async () => {
    const id = 'enc-delete';
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    const second = store.addSheet('Second');
    store.setCell(0, 0, { text: 'b' }, second);
    const encoder = new WorkbookEncoder(store, immediateYield);
    encoder.noteChange('sheet-1');
    encoder.noteChange(second);
    await commitAll(id, encoder); // seed the cache with both sheets

    let deleted = false;
    const yieldFn = vi.fn(async () => {
      if (!deleted) {
        deleted = true;
        store.deleteSheet(second);
        encoder.noteStructure(); // mirrors the auto-save subscriber
      }
    });
    store.setCell(1, 1, { text: 'a2' });
    encoder.noteChange('sheet-1');
    const snapshot = encoder.snapshot();
    const strings = await encoder.encode(snapshot, yieldFn);
    expect(await encoder.commitPut(id, snapshot, strings!)).toBe(true);

    const sheets = await sheetsOf(id);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ id: 'sheet-1' });
    expect((await loadWorkbook(id))?.sheets).toHaveLength(1);
  });

  it('a rename alone rewrites the sheet array without re-encoding any sheet', async () => {
    const id = 'enc-rename-only';
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    const second = store.addSheet('Second');
    store.setCell(0, 0, { text: 'b' }, second);
    const encoder = new WorkbookEncoder(store, immediateYield);
    const sheetA = store.getSheetData('sheet-1')!;
    const sheetB = store.getSheetData(second)!;
    const sweepA = vi.spyOn(sheetA, 'forEachCell');
    const sweepB = vi.spyOn(sheetB, 'forEachCell');
    encoder.noteChange('sheet-1');
    encoder.noteChange(second);
    await commitAll(id, encoder);

    sweepA.mockClear();
    sweepB.mockClear();
    store.renameSheet('sheet-1', 'Renamed'); // renameSheet itself sweeps for formulas; clear that
    sweepA.mockClear();
    sweepB.mockClear();
    encoder.noteStructure();
    const snapshot = encoder.snapshot();
    expect(snapshot.sheets).toHaveLength(0); // no content changed
    const strings = await encoder.encode(snapshot);
    expect(await encoder.commitPut(id, snapshot, strings!)).toBe(true);

    expect(sweepA).not.toHaveBeenCalled();
    expect(sweepB).not.toHaveBeenCalled();
    const sheets = await sheetsOf(id);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toMatchObject({ id: 'sheet-1', name: 'Renamed' });
    expect(sheets[1]).toMatchObject({ id: second, name: 'Second' });
  });

  it('a workbook replace voids the round in flight; the next round saves the new workbook', async () => {
    const id = 'enc-replaced';
    const store = new Store();
    store.setCell(0, 0, { text: 'old workbook' });
    const fresh = new Store();
    fresh.setCell(0, 0, { text: 'new workbook' });
    const freshData = fresh.serialize();
    const encoder = new WorkbookEncoder(store, immediateYield);
    encoder.noteChange('sheet-1');
    let replaced = false;
    const yieldFn = vi.fn(async () => {
      if (!replaced) {
        replaced = true;
        store.replaceAll(freshData);
        encoder.noteReplaced(); // mirrors the auto-save subscriber
      }
    });

    const snapshot = encoder.snapshot();
    const strings = await encoder.encode(snapshot, yieldFn);
    expect(strings).toBeNull(); // old result discarded, nothing written
    expect(await rawRecord(id)).toBeUndefined();

    const next = encoder.snapshot(); // replace re-marked everything dirty
    expect(next.sheets).toHaveLength(1);
    const nextStrings = await encoder.encode(next);
    expect(await encoder.commitPut(id, next, nextStrings!)).toBe(true);
    const loaded = await loadWorkbook(id);
    expect(loaded?.activeSheetId).toBe(freshData.activeSheetId);
    expect(loaded!.sheets[0]!.data).toEqual(freshData.sheets[0]!.data);
    expect(loaded!.sheets[0]!.data.cells).toEqual([['0,0', { text: 'new workbook' }]]);
  });

  it('a leaving write superseding the round writes nothing from it', async () => {
    const id = 'enc-superseded';
    const store = new Store();
    store.setCell(0, 0, { text: 'a' });
    const encoder = new WorkbookEncoder(store, immediateYield);
    encoder.noteChange('sheet-1');

    const snapshot = encoder.snapshot();
    const strings = await encoder.encode(snapshot);
    encoder.noteLeaving(); // pagehide fired while this round was encoding
    expect(await encoder.commitPut(id, snapshot, strings!)).toBe(false);
    expect(await rawRecord(id)).toBeUndefined();
  });

  it('perf smoke: one sweep per dirty sheet, ~one yield per chunk', async () => {
    const store = new Store();
    fillCells(store, 200_000, (i) => String(i));
    const sheet = store.getSheetData('sheet-1')!;
    const sweep = vi.spyOn(sheet, 'forEachCell');
    const encoder = new WorkbookEncoder(store, immediateYield);
    encoder.noteChange('sheet-1');

    const snapshot = encoder.snapshot();
    expect(sweep).toHaveBeenCalledTimes(1);
    sweep.mockClear();

    const yieldFn = vi.fn(immediateYield);
    const strings = await encoder.encode(snapshot, yieldFn);
    expect(strings).not.toBeNull();
    expect(sweep).not.toHaveBeenCalled(); // encoding never re-walks the cells
    expect(yieldFn).toHaveBeenCalledTimes(Math.ceil(200_000 / AUTOSAVE_ENCODE_CHUNK_CELLS));
  });
});
