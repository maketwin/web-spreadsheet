import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';

import type { StoreEvent } from '../../src/types';

type SheetEvent = Extract<StoreEvent, { type: 'sheet' }>;

function collect(store: Store): { readonly events: StoreEvent[]; readonly off: () => void } {
  const events: StoreEvent[] = [];
  const off = store.subscribe((event) => events.push(event));
  return { events, off };
}

describe('store events: de-disguised shapes', () => {
  it('setConditionalRule / removeConditionalRule announce conditionalRules with the range', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.setConditionalRule('0,0:1,1', [{ type: 'formula', formula: 'TRUE', style: { bold: true } }]);
    store.removeConditionalRule('0,0:1,1');
    off();

    expect(events).toEqual([
      { type: 'conditionalRules', range: '0,0:1,1', sheetId: 'sheet-1' },
      { type: 'conditionalRules', range: '0,0:1,1', sheetId: 'sheet-1' },
    ]);
  });

  it('addChart / removeChart announce charts with the chart id', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.addChart({ id: 'chart-1', type: 'bar', range: 'A1:B2' });
    store.removeChart('chart-1');
    off();

    expect(events).toEqual([
      { type: 'charts', id: 'chart-1', sheetId: 'sheet-1' },
      { type: 'charts', id: 'chart-1', sheetId: 'sheet-1' },
    ]);
  });

  it('addImage / removeImage announce images with the image id', () => {
    const store = new Store();
    const anchor = { from: { r: 0, c: 0, offX: 0, offY: 0 }, to: { r: 1, c: 1, offX: 0, offY: 0 } };
    const { events, off } = collect(store);

    store.addImage({ id: 'img-1', name: 'logo', src: 'data:image/png;base64,x', anchor });
    store.removeImage('img-1');
    off();

    expect(events).toEqual([
      { type: 'images', id: 'img-1', sheetId: 'sheet-1' },
      { type: 'images', id: 'img-1', sheetId: 'sheet-1' },
    ]);
  });

  it('addSparkline / removeSparkline announce sparklines with the sparkline id', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.addSparkline({ id: 'spark-1', type: 'line', range: '0,0:0,4', row: 1, col: 0 });
    store.removeSparkline('spark-1');
    off();

    expect(events).toEqual([
      { type: 'sparklines', id: 'spark-1', sheetId: 'sheet-1' },
      { type: 'sparklines', id: 'spark-1', sheetId: 'sheet-1' },
    ]);
  });

  it('setValidationRule / removeValidationRule announce validations with the range', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.setValidationRule('1,0:5,0', { type: 'integer', min: 0, max: 10 });
    store.removeValidationRule('1,0:5,0');
    off();

    expect(events).toEqual([
      { type: 'validations', range: '1,0:5,0', sheetId: 'sheet-1' },
      { type: 'validations', range: '1,0:5,0', sheetId: 'sheet-1' },
    ]);
  });

  it('setNamedRange / removeNamedRange announce namedRanges with the name', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.setNamedRange('Nums', { range: '0,0:1,0' });
    store.removeNamedRange('Nums');
    off();

    expect(events).toEqual([
      { type: 'namedRanges', name: 'Nums', sheetId: 'sheet-1' },
      { type: 'namedRanges', name: 'Nums', sheetId: 'sheet-1' },
    ]);
  });

  it('setRowGroups / setFreeze / setProtection announce their own types', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.setRowGroups([{ start: 0, end: 2 }]);
    store.setFreeze({ rows: 2, cols: 1 });
    store.setProtection({ protected: true, passwordHash: 'hash' });
    off();

    expect(events).toEqual([
      { type: 'rowGroups', sheetId: 'sheet-1' },
      { type: 'freeze', sheetId: 'sheet-1' },
      { type: 'protection', sheetId: 'sheet-1' },
    ]);
  });

  it('setWorkbookPasswordHash announces workbookPassword without a sheetId', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.setWorkbookPasswordHash('sha-hex');
    off();

    expect(events).toEqual([{ type: 'workbookPassword' }]);
    const only = events[0];
    expect(only).toBeDefined();
    expect('sheetId' in only!).toBe(false);
  });

  it('none of the de-disguised setters emits a style event anymore', () => {
    const store = new Store();
    const anchor = { from: { r: 0, c: 0, offX: 0, offY: 0 }, to: { r: 1, c: 1, offX: 0, offY: 0 } };
    const { events, off } = collect(store);

    store.setConditionalRule('0,0:1,1', []);
    store.addChart({ id: 'chart-2', type: 'line', range: 'A1:A9' });
    store.removeChart('chart-2');
    store.addImage({ id: 'img-2', name: 'n', src: 'data:,', anchor });
    store.removeImage('img-2');
    store.addSparkline({ id: 'spark-2', type: 'bar', range: '0,0:0,3', row: 2, col: 2 });
    store.removeSparkline('spark-2');
    store.setValidationRule('0,0:0,0', { type: 'list', values: ['a'] });
    store.removeValidationRule('0,0:0,0');
    store.setNamedRange('R', { range: '0,0:0,0' });
    store.removeNamedRange('R');
    store.setRowGroups([]);
    store.setFreeze(undefined);
    store.setProtection(undefined);
    store.setWorkbookPasswordHash(undefined);

    off();
    expect(events.some((event) => event.type === 'style')).toBe(false);
    expect(events.length).toBeGreaterThanOrEqual(15);
  });

  it('real style changes still announce style with id and style payload', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.setStyle('s1', { bold: true });
    off();

    expect(events).toEqual([{ type: 'style', id: 's1', style: { bold: true }, sheetId: 'sheet-1' }]);
  });

  it('setSheetColor announces sheet/recolor and moveSheet announces sheet/move', () => {
    const store = new Store();
    const other = store.addSheet('Two'); // addSheet switches active to the new sheet
    const { events, off } = collect(store);

    store.setSheetColor('sheet-1', '#ff0000');
    store.moveSheet('sheet-1', 1);
    off();

    const sheetEvents = events.filter((event): event is SheetEvent => event.type === 'sheet');
    expect(sheetEvents).toEqual([
      { type: 'sheet', action: 'recolor', sheetId: 'sheet-1' },
      { type: 'sheet', action: 'move', sheetId: 'sheet-1' },
    ]);
    expect(other).toBe('sheet-2');
  });
});

describe('store batch coalescing of the new events', () => {
  it('coalesces conditionalRules per range: same range once, different ranges each', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.batch(() => {
      store.setConditionalRule('0,0:1,0', []);
      store.setConditionalRule('0,0:1,0', []);
    });
    const afterFirstBatch = events.length;
    expect(events.filter((event) => event.type === 'conditionalRules')).toHaveLength(1);

    store.batch(() => {
      store.setConditionalRule('0,0:1,0', []);
      store.setConditionalRule('2,0:3,0', []);
    });
    off();

    // The second batch delivered one surviving event per range.
    const both = events.slice(afterFirstBatch).filter((event): event is Extract<StoreEvent, { type: 'conditionalRules' }> => event.type === 'conditionalRules');
    expect(both.map((event) => event.range).sort()).toEqual(['0,0:1,0', '2,0:3,0']);
  });

  it('delivers two setFreeze events in order inside one batch (no identity, no merge)', () => {
    const store = new Store();
    const { events, off } = collect(store);

    store.batch(() => {
      store.setFreeze({ rows: 1, cols: 0 });
      store.setFreeze({ rows: 2, cols: 2 });
    });
    off();

    expect(events).toEqual([
      { type: 'freeze', sheetId: 'sheet-1' },
      { type: 'freeze', sheetId: 'sheet-1' },
    ]);
  });
});

describe('store revision with the new events', () => {
  it('advances by one for a delivered addChart event', () => {
    const store = new Store();
    const start = store.revision;

    store.addChart({ id: 'chart-9', type: 'pie', range: 'A1:B2' });

    expect(store.revision).toBe(start + 1);
  });
});
