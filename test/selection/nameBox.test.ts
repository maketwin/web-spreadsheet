import { describe, expect, it } from 'vitest';
import { NamedRangeService } from '../../src/namedrange/NamedRangeService';
import { parseNameBoxInput } from '../../src/selection/nameBox';
import { Store } from '../../src/store/Store';

describe('parseNameBoxInput', () => {
  it('parses a single cell reference (case-insensitive)', () => {
    const store = new Store();
    expect(parseNameBoxInput(store, 'B3')).toEqual({ sheetId: null, range: { r1: 2, c1: 1, r2: 2, c2: 1 } });
    expect(parseNameBoxInput(store, ' b2 ')).toEqual({ sheetId: null, range: { r1: 1, c1: 1, r2: 1, c2: 1 } });
  });

  it('parses a range and normalizes reversed endpoints', () => {
    const store = new Store();
    expect(parseNameBoxInput(store, 'B2:D5')).toEqual({ sheetId: null, range: { r1: 1, c1: 1, r2: 4, c2: 3 } });
    expect(parseNameBoxInput(store, 'D5:B2')).toEqual({ sheetId: null, range: { r1: 1, c1: 1, r2: 4, c2: 3 } });
  });

  it('jumps across sheets with Sheet!A1', () => {
    const store = new Store();
    const second = store.addSheet('Data');
    const target = parseNameBoxInput(store, 'Data!A1');
    expect(target?.sheetId).toBe(second);
    expect(target?.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  });

  it('resolves defined names on the active sheet', () => {
    const store = new Store();
    new NamedRangeService().add(store, 'Sales', '1,0:4,2');
    expect(parseNameBoxInput(store, 'Sales')).toEqual({ sheetId: null, range: { r1: 1, c1: 0, r2: 4, c2: 2 } });
  });

  it('clamps out-of-grid references to the grid bounds', () => {
    const store = new Store();
    const target = parseNameBoxInput(store, 'ZZ1000000');
    expect(target?.range).toEqual({ r1: 999, c1: 25, r2: 999, c2: 25 });
  });

  it('parses whole-column references like Excel (A, C:A)', () => {
    const store = new Store();
    expect(parseNameBoxInput(store, 'B')).toEqual({ sheetId: null, range: { r1: 0, c1: 1, r2: 999, c2: 1 } });
    expect(parseNameBoxInput(store, 'C:A')).toEqual({ sheetId: null, range: { r1: 0, c1: 0, r2: 999, c2: 2 } });
  });

  it('parses whole-row references like Excel (3, 5:3)', () => {
    const store = new Store();
    expect(parseNameBoxInput(store, '3')).toEqual({ sheetId: null, range: { r1: 2, c1: 0, r2: 2, c2: 25 } });
    expect(parseNameBoxInput(store, '5:3')).toEqual({ sheetId: null, range: { r1: 2, c1: 0, r2: 4, c2: 25 } });
  });

  it('supports Sheet!-prefixed column/row refs', () => {
    const store = new Store();
    const second = store.addSheet('Data');
    const target = parseNameBoxInput(store, 'Data!B:D');
    expect(target?.sheetId).toBe(second);
    expect(target?.range).toEqual({ r1: 0, c1: 1, r2: 999, c2: 3 });
  });

  it('returns null for garbage, empty input and unknown sheets', () => {
    const store = new Store();
    expect(parseNameBoxInput(store, '')).toBeNull();
    expect(parseNameBoxInput(store, 'hello world')).toBeNull();
    expect(parseNameBoxInput(store, 'Nope!A1')).toBeNull();
    expect(parseNameBoxInput(store, 'A0')).toBeNull();
  });
});
