import { describe, expect, it } from 'vitest';
import { KeyboardHandler } from '../../src/keys/KeyboardHandler';

describe('KeyboardHandler', () => {
  it('moves with arrow keys', () => {
    const action = KeyboardHandler.next('ArrowDown', { r1: 0, c1: 0, r2: 0, c2: 0 });

    expect(action).toEqual({ type: 'move', range: { r1: 1, c1: 0, r2: 1, c2: 0 } });
  });

  it('moves Home and End within row bounds', () => {
    expect(KeyboardHandler.next('Home', { r1: 4, c1: 7, r2: 4, c2: 7 })?.range).toEqual({ r1: 4, c1: 0, r2: 4, c2: 0 });
    expect(KeyboardHandler.next('End', { r1: 4, c1: 7, r2: 4, c2: 7 })?.range).toEqual({ r1: 4, c1: 25, r2: 4, c2: 25 });
  });

  it('recognizes clipboard shortcuts', () => {
    expect(KeyboardHandler.next('c', { r1: 0, c1: 0, r2: 0, c2: 0 }, false, true, false)).toEqual({ type: 'copy' });
    expect(KeyboardHandler.next('v', { r1: 0, c1: 0, r2: 0, c2: 0 }, false, false, true)).toEqual({ type: 'paste' });
  });
});
