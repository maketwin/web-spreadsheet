import { describe, expect, it } from 'vitest';
import { KeyboardHandler } from '../../src/keys/KeyboardHandler';

describe('KeyboardHandler', () => {
  it('moves with arrow keys', () => {
    const action = KeyboardHandler.next('ArrowDown', { r1: 0, c1: 0, r2: 0, c2: 0 });

    expect(action).toEqual({ type: 'move', range: { r1: 1, c1: 0, r2: 1, c2: 0 } });
  });

  it('Home moves to column A; End alone does nothing (Excel End mode)', () => {
    expect(KeyboardHandler.next('Home', { r1: 4, c1: 7, r2: 4, c2: 7 })?.range).toEqual({ r1: 4, c1: 0, r2: 4, c2: 0 });
    expect(KeyboardHandler.next('End', { r1: 4, c1: 7, r2: 4, c2: 7 })).toBeNull();
  });

  it('PageUp/PageDown page through the viewport; Backspace differs from Delete', () => {
    const at = { r1: 4, c1: 7, r2: 4, c2: 7 };
    expect(KeyboardHandler.next('PageUp', at)).toEqual({ type: 'page', pageDir: -1 });
    expect(KeyboardHandler.next('PageDown', at)).toEqual({ type: 'page', pageDir: 1 });
    expect(KeyboardHandler.next('Delete', at)).toEqual({ type: 'clear' });
    expect(KeyboardHandler.next('Backspace', at)).toEqual({ type: 'backspace' });
  });

  it('Ctrl+; inserts the date, Ctrl+1 opens Format Cells, Ctrl+PageUp/Down switch sheets', () => {
    const at = { r1: 4, c1: 7, r2: 4, c2: 7 };
    expect(KeyboardHandler.next(';', at, false, true, false)).toEqual({ type: 'insertDate' });
    expect(KeyboardHandler.next('1', at, false, false, true)).toEqual({ type: 'menu', command: 'formatCells' });
    expect(KeyboardHandler.next('PageUp', at, false, true, false)).toEqual({ type: 'menu', command: 'prevSheet' });
    expect(KeyboardHandler.next('PageDown', at, false, false, true)).toEqual({ type: 'menu', command: 'nextSheet' });
  });

  it('recognizes clipboard shortcuts', () => {
    expect(KeyboardHandler.next('c', { r1: 0, c1: 0, r2: 0, c2: 0 }, false, true, false)).toEqual({ type: 'copy' });
    expect(KeyboardHandler.next('v', { r1: 0, c1: 0, r2: 0, c2: 0 }, false, false, true)).toEqual({ type: 'paste' });
  });

  it('Ctrl+arrows become edge jumps resolved against the store', () => {
    const at = { r1: 2, c1: 2, r2: 2, c2: 2 };
    expect(KeyboardHandler.next('ArrowDown', at, false, true, false)).toEqual({ type: 'moveEdge', dr: 1, dc: 0 });
    expect(KeyboardHandler.next('ArrowUp', at, false, false, true)).toEqual({ type: 'moveEdge', dr: -1, dc: 0 });
    expect(KeyboardHandler.next('ArrowLeft', at, false, true, false)).toEqual({ type: 'moveEdge', dr: 0, dc: -1 });
    expect(KeyboardHandler.next('ArrowRight', at, false, false, true)).toEqual({ type: 'moveEdge', dr: 0, dc: 1 });
  });

  it('Ctrl+Home/End become jumps', () => {
    const at = { r1: 2, c1: 2, r2: 2, c2: 2 };
    expect(KeyboardHandler.next('Home', at, false, true, false)).toEqual({ type: 'jump', jump: 'home' });
    expect(KeyboardHandler.next('End', at, false, false, true)).toEqual({ type: 'jump', jump: 'usedEnd' });
  });

  it('Ctrl+D / Ctrl+R become fills; Shift+Tab moves left', () => {
    const at = { r1: 2, c1: 2, r2: 2, c2: 2 };
    expect(KeyboardHandler.next('d', at, false, true, false)).toEqual({ type: 'fill', fillDir: 'down' });
    expect(KeyboardHandler.next('r', at, false, false, true)).toEqual({ type: 'fill', fillDir: 'right' });
    expect(KeyboardHandler.next('Tab', at, true)?.range).toEqual({ r1: 2, c1: 1, r2: 2, c2: 1 });
  });

  it('Enter moves down and Shift+Enter moves up (Excel); F2 edits', () => {
    const at = { r1: 2, c1: 2, r2: 2, c2: 2 };
    expect(KeyboardHandler.next('Enter', at)).toEqual({ type: 'move', range: { r1: 3, c1: 2, r2: 3, c2: 2 } });
    expect(KeyboardHandler.next('Enter', at, true)).toEqual({ type: 'move', range: { r1: 1, c1: 2, r2: 1, c2: 2 } });
    expect(KeyboardHandler.next('F2', at)).toEqual({ type: 'edit' });
  });

  it('Ctrl+Space selects the column; Shift+Space selects the row', () => {
    const at = { r1: 2, c1: 2, r2: 2, c2: 2 };
    expect(KeyboardHandler.next(' ', at, false, true, false)).toEqual({ type: 'selectColumn' });
    expect(KeyboardHandler.next(' ', at, true, false, false)).toEqual({ type: 'selectRow' });
  });
});
