import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/Store';
import { SetCellCommentCommand } from '../../src/commands/impl/SetCellComment';
import { exportXlsxBuffer } from '../../src/io/XlsxExporter';
import { importXlsx } from '../../src/io/XlsxImporter';

function storeWithComment(): Store {
  const store = new Store();
  store.setCell(0, 0, { text: '产品', value: '产品' });
  store.setCell(1, 1, { text: '42', value: 42 });
  const cmd = new SetCellCommentCommand({ r: 1, c: 1, comment: { text: '核对一下这个数', author: '审计' } });
  cmd.execute.bind(cmd)(store);
  return store;
}

describe('SetCellComment command', () => {
  it('sets the comment and undoes back to the original cell', () => {
    const store = new Store();
    store.setCell(1, 1, { text: '42', value: 42 });
    const cmd = new SetCellCommentCommand({ r: 1, c: 1, comment: { text: 'note' } });
    cmd.execute.bind(cmd)(store);
    expect(store.getCell(1, 1)?.comment?.text).toBe('note');
    expect(store.getCell(1, 1)?.value).toBe(42);
    const undo = cmd.getUndo();
    undo.execute.bind(undo)(store);
    expect(store.getCell(1, 1)?.comment).toBeUndefined();
    expect(store.getCell(1, 1)?.value).toBe(42);
  });

  it('removing a comment on an empty cell keeps an empty cell', () => {
    const store = storeWithComment();
    const cmd = new SetCellCommentCommand({ r: 1, c: 1 });
    cmd.execute.bind(cmd)(store);
    expect(store.getCell(1, 1)?.comment).toBeUndefined();
  });
});

describe('xlsx comment round-trip', () => {
  it('exports comments1.xml+vml and re-imports text/author', () => {
    const store = storeWithComment();
    const buf = exportXlsxBuffer(store);
    const restored = importXlsx(buf);
    const cell = restored.sheets[0]?.data.cells.find(([key]) => key === '1,1');
    expect(cell).toBeDefined();
    expect(cell?.[1].comment?.text).toBe('核对一下这个数');
    expect(cell?.[1].comment?.author).toBe('审计');
  });

  it('no comments → zip untouched', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'plain', value: 'plain' });
    const buf = exportXlsxBuffer(store);
    const restored = importXlsx(buf);
    const cell = restored.sheets[0]?.data.cells.find(([key]) => key === '0,0');
    expect(cell?.[1].comment).toBeUndefined();
  });
});
