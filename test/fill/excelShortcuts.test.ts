import { describe, expect, it } from 'vitest';
import { doubleClickFillTarget } from '../../src/fill/dblclickFill';
import { fillShortcut } from '../../src/fill/fillShortcut';
import { Store } from '../../src/store/Store';

describe('doubleClickFillTarget (Excel double-click fill handle)', () => {
  it('fills down as far as the adjacent column has content', () => {
    const store = new Store();
    // Left neighbor (col A) has data down to row 5; selection B2:B3.
    for (let r = 1; r <= 5; r += 1) store.setCell(r, 0, { text: `L${r}` });
    store.setCell(1, 1, { text: 'B2' });
    store.setCell(2, 1, { text: 'B3' });
    expect(doubleClickFillTarget(store, { r1: 1, c1: 1, r2: 2, c2: 1 }, 1000))
      .toEqual({ r1: 1, c1: 1, r2: 5, c2: 1 });
  });

  it('either neighbor column bounds the fill (right neighbor longer)', () => {
    const store = new Store();
    store.setCell(1, 0, { text: 'L' });
    store.setCell(1, 1, { text: 'B' });
    for (let r = 1; r <= 4; r += 1) store.setCell(r, 2, { text: `R${r}` });
    expect(doubleClickFillTarget(store, { r1: 1, c1: 1, r2: 1, c2: 1 }, 1000))
      .toEqual({ r1: 1, c1: 1, r2: 4, c2: 1 });
  });

  it('no adjacent data below → no fill', () => {
    const store = new Store();
    store.setCell(1, 1, { text: 'B' });
    expect(doubleClickFillTarget(store, { r1: 1, c1: 1, r2: 1, c2: 1 }, 1000)).toBeUndefined();
  });
});

describe('fillShortcut (Excel Ctrl+D / Ctrl+R)', () => {
  it('Ctrl+D copies the selection\'s top row down', () => {
    const store = new Store();
    store.setCell(1, 1, { text: 'top' });
    const cmd = fillShortcut({ r1: 1, c1: 1, r2: 3, c2: 1 }, 'down');
    expect(cmd).toBeDefined();
    cmd?.execute(store);
    expect(store.getCell(2, 1)).toMatchObject({ text: 'top' });
    expect(store.getCell(3, 1)).toMatchObject({ text: 'top' });
  });

  it('Ctrl+D on a single cell copies the cell above', () => {
    const store = new Store();
    store.setCell(1, 1, { text: 'above' });
    fillShortcut({ r1: 2, c1: 1, r2: 2, c2: 1 }, 'down')?.execute(store);
    expect(store.getCell(2, 1)).toMatchObject({ text: 'above' });
  });

  it('Ctrl+D on row 1 is a no-op', () => {
    expect(fillShortcut({ r1: 0, c1: 1, r2: 0, c2: 1 }, 'down')).toBeUndefined();
  });

  it('Ctrl+R copies the selection\'s left column right', () => {
    const store = new Store();
    store.setCell(1, 1, { text: 'left' });
    fillShortcut({ r1: 1, c1: 1, r2: 1, c2: 3 }, 'right')?.execute(store);
    expect(store.getCell(1, 2)).toMatchObject({ text: 'left' });
    expect(store.getCell(1, 3)).toMatchObject({ text: 'left' });
  });

  it('copy semantics: a lone number does not increment', () => {
    const store = new Store();
    store.setCell(1, 1, { text: '7' });
    fillShortcut({ r1: 1, c1: 1, r2: 3, c2: 1 }, 'down')?.execute(store);
    expect(store.getCell(2, 1)).toMatchObject({ text: '7' });
    expect(store.getCell(3, 1)).toMatchObject({ text: '7' });
  });
});
