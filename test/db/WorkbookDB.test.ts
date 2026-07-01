import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveWorkbook, loadWorkbook, deleteWorkbook, DEFAULT_ID } from '../../src/db/WorkbookDB';
import { Store } from '../../src/store/Store';

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
    expect(loaded!.sheets[0]!.data.cells.length).toBeGreaterThan(0);
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
});
