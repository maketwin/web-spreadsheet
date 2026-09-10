import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { SetRangeBorderCommand, edgesForPreset } from '../../src/commands/impl/SetRangeBorder';

describe('edgesForPreset', () => {
  const range = { r1: 0, c1: 0, r2: 2, c2: 2 };

  it('outer only touches the perimeter', () => {
    expect(edgesForPreset('outer', 0, 0, range)).toEqual({ top: true, left: true });
    expect(edgesForPreset('outer', 1, 1, range)).toEqual({});
    expect(edgesForPreset('outer', 2, 2, range)).toEqual({ bottom: true, right: true });
  });

  it('inner only touches shared interior edges', () => {
    expect(edgesForPreset('inner', 0, 0, range)).toEqual({ bottom: true, right: true });
    expect(edgesForPreset('inner', 1, 1, range)).toEqual({ top: true, bottom: true, left: true, right: true });
    expect(edgesForPreset('inner', 0, 1, range)).toEqual({ bottom: true, left: true, right: true });
  });

  it('none clears', () => {
    expect(edgesForPreset('none', 0, 0, range)).toBeNull();
  });
});

describe('SetRangeBorderCommand', () => {
  it('applies all borders without gaps on a 2x2 block', () => {
    const store = new Store();
    new SetRangeBorderCommand({ r1: 0, c1: 0, r2: 1, c2: 1, preset: 'all', line: 'solid' }).execute(store);
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
      const styleId = store.getCell(r, c)?.styleId;
      expect(styleId).toBeDefined();
      const border = store.getStyle(styleId!)?.border;
      expect(border).toEqual({ top: 'solid', bottom: 'solid', left: 'solid', right: 'solid' });
    }
  });

  it('outer does not paint interior spokes', () => {
    const store = new Store();
    new SetRangeBorderCommand({ r1: 0, c1: 0, r2: 1, c2: 1, preset: 'outer', line: 'thick' }).execute(store);
    const a1 = store.getStyle(store.getCell(0, 0)!.styleId!)!.border;
    expect(a1).toEqual({ top: 'thick', left: 'thick' });
    // bottom/right of A1 are interior for a 2x2 outer — must not be set
    expect(a1?.bottom).toBeUndefined();
    expect(a1?.right).toBeUndefined();
    const b2 = store.getStyle(store.getCell(1, 1)!.styleId!)!.border;
    expect(b2).toEqual({ bottom: 'thick', right: 'thick' });
  });

  it('none removes borders completely', () => {
    const store = new Store();
    new SetRangeBorderCommand({ r1: 0, c1: 0, r2: 0, c2: 0, preset: 'all', line: 'solid' }).execute(store);
    new SetRangeBorderCommand({ r1: 0, c1: 0, r2: 0, c2: 0, preset: 'none', line: 'solid' }).execute(store);
    const styleId = store.getCell(0, 0)?.styleId;
    expect(store.getStyle(styleId!)?.border).toBeUndefined();
  });

  it('top merges without wiping other sides', () => {
    const store = new Store();
    new SetRangeBorderCommand({ r1: 0, c1: 0, r2: 0, c2: 0, preset: 'left', line: 'solid' }).execute(store);
    new SetRangeBorderCommand({ r1: 0, c1: 0, r2: 0, c2: 0, preset: 'top', line: 'thick' }).execute(store);
    expect(store.getStyle(store.getCell(0, 0)!.styleId!)!.border).toEqual({ left: 'solid', top: 'thick' });
  });
});
