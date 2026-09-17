import { describe, it, expect } from 'vitest';
import { FindReplaceService, InvalidFindPatternError } from '../../src/find/FindReplaceService';
import { CommandManager } from '../../src/commands/CommandManager';
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
    expect(result.currentCell).toMatchObject({ r: 0, c: 0, sheetId: store.getActiveSheetId() });
  });

  it('finds next match and wraps around', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    svc.find(store, { findText: 'Hello' });
    // Case-insensitive sorted: Hello(0,0), hello(1,0), Hello World(1,1)
    const next = svc.findNext();
    expect(next.currentCell).toMatchObject({ r: 1, c: 0 });
    const wrap = svc.findNext();
    expect(wrap.currentCell).toMatchObject({ r: 1, c: 1 });
    const back = svc.findNext();
    expect(back.currentCell).toMatchObject({ r: 0, c: 0 });
  });

  it('finds previous match and wraps around', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    svc.find(store, { findText: 'Hello' }); // current = (0,0)
    const prev = svc.findPrevious();
    expect(prev.currentCell).toMatchObject({ r: 1, c: 1 }); // last match
    const prev2 = svc.findPrevious();
    expect(prev2.currentCell).toMatchObject({ r: 1, c: 0 });
  });

  it('replaces current match', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    svc.find(store, { findText: 'Hello' });
    const { result, replaced } = svc.replaceCurrent(store, { findText: 'Hello', replaceText: 'Hi' });
    expect(replaced).toBe(true);
    expect(store.getCell(0, 0)?.text).toBe('Hi');
    expect(result.currentCell).not.toBeNull();
  });

  it('reports nothing replaced when there is no current match', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    const { replaced } = svc.replaceCurrent(store, { findText: 'Hello', replaceText: 'Hi' });
    expect(replaced).toBe(false);
  });

  it('replaces all matches and counts occurrences, not cells', () => {
    const store = makeStore();
    store.setCell(3, 0, { text: 'say Hello twice: Hello' }); // 2 hits in one cell
    const svc = new FindReplaceService();
    const { replacements, cells } = svc.replaceAll(store, { findText: 'Hello', replaceText: 'Hi' });
    expect(replacements).toBe(5); // 3 single-hit cells + 1 double-hit cell
    expect(cells).toBe(4);
    expect(store.getCell(0, 0)?.text).toBe('Hi');
    expect(store.getCell(1, 0)?.text).toBe('Hi');
    expect(store.getCell(3, 0)?.text).toBe('say Hi twice: Hi');
  });

  it('respects case-sensitive toggle', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    const result = svc.find(store, { findText: 'Hello', caseSensitive: true });
    expect(result.matches.length).toBe(2); // (0,0) Hello, (1,1) Hello World — not (1,0) hello
  });

  it('matchEntireCell matches only whole-cell equality', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    // Case-insensitive whole-cell: 'Hello'(0,0) and 'hello'(1,0) — not 'Hello World'.
    const result = svc.find(store, { findText: 'Hello', matchEntireCell: true });
    expect(result.matches.length).toBe(2);
    expect(result.matches[0]).toMatchObject({ r: 0, c: 0 });
    const strict = svc.find(store, { findText: 'Hello', matchEntireCell: true, caseSensitive: true });
    expect(strict.matches.length).toBe(1);
  });

  it('regex mode matches patterns and replaces with group references', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '2024-01' });
    store.setCell(0, 1, { text: '2025-12' });
    store.setCell(0, 2, { text: 'no date here' });
    const svc = new FindReplaceService();
    const result = svc.find(store, { findText: '(\\d{4})-(\\d{2})', useRegex: true });
    expect(result.matches.length).toBe(2);
    const { replacements } = svc.replaceAll(store, { findText: '(\\d{4})-(\\d{2})', replaceText: '$1年$2月', useRegex: true });
    expect(replacements).toBe(2);
    expect(store.getCell(0, 0)?.text).toBe('2024年01月');
    expect(store.getCell(0, 2)?.text).toBe('no date here');
  });

  it('regex mode honors case sensitivity', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'abc' });
    store.setCell(0, 1, { text: 'ABC' });
    const svc = new FindReplaceService();
    expect(svc.find(store, { findText: 'A', useRegex: true }).matches.length).toBe(2);
    expect(svc.find(store, { findText: 'A', useRegex: true, caseSensitive: true }).matches.length).toBe(1);
  });

  it('throws InvalidFindPatternError for a broken regex', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    expect(() => svc.find(store, { findText: '([unclosed', useRegex: true })).toThrow(InvalidFindPatternError);
  });

  it('workbook scope searches every sheet starting from the active one', () => {
    const store = makeStore(); // sheet-1: Hello(0,0), hello(1,0), Hello World(1,1)
    const second = store.addSheet('Data'); // addSheet also activates the new sheet
    store.setCell(0, 0, { text: 'Hello from sheet2' }); // lands on Data
    const svc = new FindReplaceService();
    const result = svc.find(store, { findText: 'Hello', scope: 'workbook' });
    // Active sheet (Data) first, then the rest in workbook order.
    expect(result.matches.map((m) => m.sheetName)).toEqual(['Data', 'Sheet1', 'Sheet1', 'Sheet1']);
    expect(result.matches[0]).toMatchObject({ r: 0, c: 0, sheetId: second });
    store.activateSheet('sheet-1');
    expect(svc.find(store, { findText: 'Hello', scope: 'sheet' }).matches.every((m) => m.sheetId === 'sheet-1')).toBe(true);
  });

  it('replacing a formula rewrites the formula source', () => {
    const store = new Store();
    store.setCell(0, 0, { text: '=SUM(1,2)', formula: '=SUM(1,2)', value: 3 });
    const svc = new FindReplaceService();
    svc.find(store, { findText: 'SUM' });
    const { replaced } = svc.replaceCurrent(store, { findText: '1,2', replaceText: '10,20' });
    expect(replaced).toBe(true);
    // Formula source rewritten; the app's FormulaEngine recalculates on the cell event.
    expect(store.getCell(0, 0)?.formula).toBe('=SUM(10,20)');
  });

  it('replace all is a single undo step for a compact match block', () => {
    const store = makeStore();
    const cmd = new CommandManager(store);
    const svc = new FindReplaceService();
    svc.replaceAll(store, { findText: 'o', replaceText: '0' }, cmd);
    expect(store.getCell(0, 1)?.text).toBe('W0rld');
    cmd.undo(); // ONE undo restores every cell
    expect(store.getCell(0, 0)?.text).toBe('Hello');
    expect(store.getCell(0, 1)?.text).toBe('World');
    expect(store.getCell(1, 0)?.text).toBe('hello');
    expect(store.getCell(1, 1)?.text).toBe('Hello World');
    expect(store.getCell(2, 0)?.text).toBe('test');
  });

  it('replace all stays undoable for scattered matches (undo restores the sheet)', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'alpha' });
    store.setCell(99, 25, { text: 'alpha' }); // far apart → per-cell commands
    const cmd = new CommandManager(store);
    const svc = new FindReplaceService();
    svc.replaceAll(store, { findText: 'alpha', replaceText: 'beta' }, cmd);
    expect(store.getCell(0, 0)?.text).toBe('beta');
    expect(store.getCell(99, 25)?.text).toBe('beta');
    while (cmd.canUndo()) cmd.undo();
    expect(store.getCell(0, 0)?.text).toBe('alpha');
    expect(store.getCell(99, 25)?.text).toBe('alpha');
  });

  it('workbook replace all writes every sheet and undo restores across sheets', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'Hello' }); // sheet-1
    store.setCell(1, 2, { text: 'say Hello' }); // sheet-1
    const second = store.addSheet('Data'); // addSheet activates Data
    store.setCell(4, 4, { text: 'Hello there' }); // Data
    const cmd = new CommandManager(store);
    const svc = new FindReplaceService();
    const { replacements, cells } = svc.replaceAll(store, { findText: 'Hello', replaceText: 'Hi', scope: 'workbook' }, cmd);
    expect(replacements).toBe(3);
    expect(cells).toBe(3);
    expect(store.getCell(0, 0, 'sheet-1')?.text).toBe('Hi');
    expect(store.getCell(1, 2, 'sheet-1')?.text).toBe('say Hi');
    expect(store.getCell(4, 4, second)?.text).toBe('Hi there');
    // The service returns to the sheet the user was on.
    expect(store.getActiveSheetId()).toBe(second);
    while (cmd.canUndo()) cmd.undo();
    expect(store.getCell(0, 0, 'sheet-1')?.text).toBe('Hello');
    expect(store.getCell(1, 2, 'sheet-1')?.text).toBe('say Hello');
    expect(store.getCell(4, 4, second)?.text).toBe('Hello there');
  });

  it('setCurrentIndex jumps to a chosen match', () => {
    const store = makeStore();
    const svc = new FindReplaceService();
    svc.find(store, { findText: 'Hello' });
    svc.setCurrentIndex(2);
    expect(svc.getCurrentIndex()).toBe(2);
    expect(svc.getMatches()[2]).toMatchObject({ r: 1, c: 1 });
    svc.setCurrentIndex(99); // out of range → ignored
    expect(svc.getCurrentIndex()).toBe(2);
  });
});
