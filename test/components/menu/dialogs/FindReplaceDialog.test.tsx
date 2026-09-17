import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FindReplaceDialog } from '../../../../src/components/menu/dialogs/FindReplaceDialog';
import { FindReplaceService } from '../../../../src/find/FindReplaceService';
import { Store } from '../../../../src/store/Store';

function mockMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function makeStore(): Store {
  const store = new Store();
  store.setCell(0, 0, { text: 'Hello World' });
  store.setCell(1, 0, { text: 'hello again' });
  return store;
}

function setup(store = makeStore()) {
  mockMatchMedia();
  const onNavigate = vi.fn();
  const onHighlight = vi.fn();
  render(<FindReplaceDialog
    open
    onCancel={() => undefined}
    store={store}
    selected={null}
    service={new FindReplaceService()}
    onNavigate={onNavigate}
    onHighlight={onHighlight}
  />);
  return { onNavigate, onHighlight };
}

/** Type into the find box and wait out the 250ms auto-rescan debounce. */
async function search(text: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('查找内容'), { target: { value: text } });
  await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0), { timeout: 3000 });
}

describe('FindReplaceDialog', () => {
  it('renders all option controls', () => {
    setup();
    expect(screen.getByLabelText('区分大小写')).toBeInTheDocument();
    expect(screen.getByLabelText('整格匹配')).toBeInTheDocument();
    expect(screen.getByLabelText('正则表达式')).toBeInTheDocument();
    expect(screen.getAllByLabelText('查找范围').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '上一个' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一个' })).toBeInTheDocument();
  });

  it('auto-rescans on input and lists matches with the current one highlighted', async () => {
    const { onHighlight } = setup();
    await search('hello');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Sheet1!A1');
    expect(rows[0]!.className).toContain('ss-find-row--current');
    expect(onHighlight).toHaveBeenCalledWith(expect.anything(), expect.any(Number));
  });

  it('navigates to a match clicked in the result list', async () => {
    const { onNavigate } = setup();
    await search('hello');
    fireEvent.click(screen.getAllByRole('listitem')[1]!);
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ r: 1, c: 0 }));
  });

  it('shows a pattern error for an invalid regex and clears it on fix', async () => {
    setup();
    fireEvent.click(screen.getByLabelText('正则表达式'));
    fireEvent.change(screen.getByLabelText('查找内容'), { target: { value: '([unclosed' } });
    await waitFor(() => expect(screen.getByText(/无效的正则表达式/)).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('查找内容'), { target: { value: 'hell(o)' } });
    await waitFor(() => expect(screen.queryByText(/无效的正则表达式/)).not.toBeInTheDocument(), { timeout: 3000 });
  });

  it('上一个/下一个 cycle through matches', async () => {
    setup();
    await search('hello');
    fireEvent.click(screen.getByRole('button', { name: '下一个' }));
    expect(screen.getAllByRole('listitem')[1]!.className).toContain('ss-find-row--current');
    fireEvent.click(screen.getByRole('button', { name: '上一个' }));
    expect(screen.getAllByRole('listitem')[0]!.className).toContain('ss-find-row--current');
  });
});
