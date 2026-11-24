import { describe, expect, it } from 'vitest';
import { shiftSheetChartAnchors } from '../../src/charts/anchorShift';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { RemoveDuplicatesCommand } from '../../src/commands/impl/RemoveDuplicates';
import { Store } from '../../src/store/Store';

import type { ChartAnchor, ChartAnchorEdge, ImageSpec } from '../../src/charts/types';

const anchorOf = (store: Store, id: string): ChartAnchor => {
  const image = store.getImages().find((i) => i.id === id);
  expect(image).toBeDefined();
  return image!.anchor;
};

function image(id: string, from: ChartAnchorEdge, to: ChartAnchorEdge): ImageSpec {
  return { id, name: id, src: 'data:image/png;base64,x', anchor: { from, to } };
}

describe('shiftSheetChartAnchors moves images like charts', () => {
  it('insert shifts edges at/after the start, keeping offsets', () => {
    const store = new Store();
    store.addImage(image('img', { r: 1, c: 2, offX: 3, offY: 4 }, { r: 5, c: 6, offX: 5, offY: 6 }));
    shiftSheetChartAnchors(store, 'insert', 'row', 2, 3);
    expect(anchorOf(store, 'img').from).toEqual({ r: 1, c: 2, offX: 3, offY: 4 }); // above the insert: stays
    expect(anchorOf(store, 'img').to).toEqual({ r: 8, c: 6, offX: 5, offY: 6 }); // at/after: pushed down

    shiftSheetChartAnchors(store, 'insert', 'col', 0, 1);
    expect(anchorOf(store, 'img').from.c).toBe(3);
    expect(anchorOf(store, 'img').to.c).toBe(7);
  });

  it('delete slides edges back and clamps edges inside the deleted band', () => {
    const store = new Store();
    store.addImage(image('img', { r: 4, c: 0, offX: 0, offY: 0 }, { r: 6, c: 0, offX: 0, offY: 0 }));
    shiftSheetChartAnchors(store, 'delete', 'row', 5, 2); // rows 5-6 deleted
    expect(anchorOf(store, 'img').from.r).toBe(4); // before the band: stays
    expect(anchorOf(store, 'img').to.r).toBe(5); // was inside the band: clamps to the band start
  });
});

describe('structural commands move images and undo restores them', () => {
  it('InsertRow shifts the anchor; undo puts it back; redo shifts again', () => {
    const store = new Store();
    store.addImage(image('img', { r: 3, c: 5, offX: 1, offY: 2 }, { r: 6, c: 8, offX: 3, offY: 4 }));
    const original = anchorOf(store, 'img');
    const cmd = new InsertRowCommand({ r: 4 });
    cmd.execute(store);
    expect(anchorOf(store, 'img').from.r).toBe(3); // edge above the insert stays
    expect(anchorOf(store, 'img').to.r).toBe(7); // edge at/after the insert moves
    cmd.getUndo().execute(store);
    expect(anchorOf(store, 'img')).toEqual(original);
    cmd.execute(store); // redo
    expect(anchorOf(store, 'img').to.r).toBe(7);
  });

  it('DeleteCol shifts the anchor; undo puts it back', () => {
    const store = new Store();
    store.addImage(image('img', { r: 0, c: 4, offX: 0, offY: 0 }, { r: 2, c: 9, offX: 1, offY: 1 }));
    const original = anchorOf(store, 'img');
    const cmd = new DeleteColCommand({ c: 2, count: 2 });
    cmd.execute(store);
    expect(anchorOf(store, 'img').from.c).toBe(2); // cols 4..9 slide left by 2
    expect(anchorOf(store, 'img').to.c).toBe(7);
    cmd.getUndo().execute(store);
    expect(anchorOf(store, 'img')).toEqual(original);
  });

  it('images survive a row delete that removes cells around them', () => {
    const store = new Store();
    store.setCell(5, 0, { text: 'x' });
    store.addImage(image('img', { r: 6, c: 0, offX: 0, offY: 0 }, { r: 8, c: 3, offX: 0, offY: 0 }));
    const cmd = new DeleteRowCommand({ r: 5 });
    cmd.execute(store);
    expect(anchorOf(store, 'img').from.r).toBe(5);
    cmd.getUndo().execute(store);
    expect(store.getCell(5, 0)?.text).toBe('x');
    expect(anchorOf(store, 'img').from.r).toBe(6);
  });

  it('RemoveDuplicates moves an image up with the deleted duplicate row', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'dup' });
    store.setCell(2, 0, { text: 'dup' });
    store.addImage(image('img', { r: 3, c: 0, offX: 0, offY: 0 }, { r: 4, c: 2, offX: 0, offY: 0 }));
    const cmd = new RemoveDuplicatesCommand({ r1: 0, c1: 0, r2: 2, c2: 0, columns: [0], hasHeader: false });
    cmd.execute(store); // row 2 deleted
    expect(anchorOf(store, 'img').from.r).toBe(2);
    cmd.getUndo().execute(store);
    expect(anchorOf(store, 'img').from.r).toBe(3);
  });
});
