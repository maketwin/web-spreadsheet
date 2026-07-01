import { describe, expect, it } from 'vitest';
import { setCommand } from '../../src/commands/Command';
import { Store } from '../../src/store/Store';

describe('Command', () => {
  it('setCommand does and undoes', () => {
    const store = new Store();
    const Cmd = setCommand<{ text: string }>(
      'SetA1',
      (s, args) => s.setCell(0, 0, { text: args.text }),
      (s) => s.setCell(0, 0, { text: '' }),
    );
    const cmd = new Cmd({ text: 'hello' });

    cmd.execute(store);

    expect(store.getCell(0, 0)?.text).toBe('hello');

    cmd.getUndo().execute(store);

    expect(store.getCell(0, 0)?.text).toBe('');
  });
});
