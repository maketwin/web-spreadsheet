import { describe, it, expect } from 'vitest';
import { Store } from '../../src/store/Store';
import { NamedRangeService } from '../../src/namedrange/NamedRangeService';

describe('NamedRangeService', () => {
  const svc = new NamedRangeService();

  it('adds a named range', () => {
    const store = new Store();
    svc.add(store, 'Sales', '0,0:4,1');
    const def = svc.lookup(store, 'Sales');
    expect(def).not.toBeUndefined();
    expect(def?.range).toBe('0,0:4,1');
  });

  it('removes a named range', () => {
    const store = new Store();
    svc.add(store, 'Sales', '0,0:4,1');
    svc.remove(store, 'Sales');
    expect(svc.lookup(store, 'Sales')).toBeUndefined();
  });

  it('looks up a named range', () => {
    const store = new Store();
    svc.add(store, 'Revenue', '0,2:3,5');
    const def = svc.lookup(store, 'Revenue');
    expect(def?.range).toBe('0,2:3,5');
  });

  it('resolves named range in formula', () => {
    const store = new Store();
    svc.add(store, 'Sales', '0,0:4,1');
    const resolved = svc.resolveFormula(store, '=SUM(Sales)');
    expect(resolved).toBe('=SUM(0,0:4,1)');
  });

  it('resolves to A1 notation', () => {
    const store = new Store();
    svc.add(store, 'Sales', '0,0:4,1');
    const a1 = svc.resolveToA1(store, 'Sales');
    expect(a1).toBe('A1:B5');
  });

  it('lists all named ranges', () => {
    const store = new Store();
    svc.add(store, 'Sales', '0,0:4,1');
    svc.add(store, 'Cost', '0,2:3,5');
    const list = svc.list(store);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });
});
