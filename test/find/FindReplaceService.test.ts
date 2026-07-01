import { describe, it, expect } from 'vitest';
import { FindReplaceService } from '../../src/find/FindReplaceService';
import { Store } from '../../src/store/Store';

describe('FindReplaceService', () => {
  function makeStore(): Store {
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello' });
    store.setCell(0, 1, { text: 'World' });
    store.setCell(1, 0, { text: 'hello' });
    store.setCell(1, 1, { text: 'Hello World' });
    store.setCell(2, 0, { text: 'test' });
    return store;
  }

  it('finds first match', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    const result = svc.find(store, { findText: 'Hello' });
    expect(result.matches.length).toBe(3);
    expect(result.currentCell).toEqual({ r: 0, c: 0 });
  });

  it('finds next match and wraps around', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    svc.find(store, { findText: 'Hello' });
    // Case-insensitive sorted: Hello(0,0), hello(1,0), Hello World(1,1)
    const next = svc.findNext();
    expect(next.currentCell).toEqual({ r: 1, c: 0 });
    const wrap = svc.findNext();
    expect(wrap.currentCell).toEqual({ r: 1, c: 1 });
    const back = svc.findNext();
    expect(back.currentCell).toEqual({ r: 0, c: 0 });
  });

  it('replaces current match', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    svc.find(store, { findText: 'Hello' });
    const result = svc.replaceCurrent(store, { findText: 'Hello', replaceText: 'Hi' });
    expect(store.getCell(0, 0)?.text).toBe('Hi');
    expect(result.currentCell).not.toBeNull();
  });

  it('replaces all matches', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    const count = svc.replaceAll(store, { findText: 'Hello', replaceText: 'Hi' });
    expect(count).toBe(3);
    expect(store.getCell(0, 0)?.text).toBe('Hi');
    expect(store.getCell(1, 0)?.text).toBe('Hi');
  });

  it('respects case-sensitive toggle', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    const result = svc.find(store, { findText: 'Hello', caseSensitive: true });
    expect(result.matches.length).toBe(2); // (0,0) Hello, (1,1) Hello World — not (1,0) hello
  });
});
