import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { InteractionToolbar, sameToolbarState, type InteractionToolbarProps } from '../../src/components/InteractionToolbar';
import { MenuBar } from '../../src/components/menu/MenuBar';
import { CommandManager } from '../../src/commands/CommandManager';
import { Store } from '../../src/store/Store';
import { Range } from '../../src/selection/Range';
import { rangeSelection, type Selection } from '../../src/selection/Selection';
import type { ViewState } from '../../src/components/keyboard';

// A selection change used to re-render the format toolbar (about two thirds
// of its cost) and the menu bar on every step of a drag. Both now render only
// when what they show changes, and read the selection when they act.
function mockMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const view: ViewState = { zoom: 100, showFormula: false, showGrid: true, frozenRows: 0, frozenCols: 0 };
const noop = (): void => undefined;
const at = (r: number, c: number): Selection => rangeSelection(Range.single(r, c).toAddress());

/** A `view` that counts how often something reads it — a render reads it, a skipped one does not. */
function countedView(): { view: ViewState; reads: () => number } {
  let reads = 0;
  const counted = new Proxy(view, { get: (target, key: keyof ViewState) => { reads += 1; return target[key]; } });
  return { view: counted, reads: () => reads };
}

function setup(cells: Array<[number, number, string]>): { store: Store; cm: CommandManager } {
  const store = new Store();
  for (const [r, c, text] of cells) store.setCell(r, c, { text });
  return { store, cm: new CommandManager(store) };
}

const isBold = (store: Store, r: number, c: number): boolean => store.getStyle(store.getCell(r, c)?.styleId ?? '')?.bold === true;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('sameToolbarState', () => {
  const live = { current: null } as RefObject<Selection | null>;
  const base: InteractionToolbarProps = {
    selected: at(0, 0), liveSelection: live, store: new Store(), cmdManager: undefined, view, setView: noop as unknown as Dispatch<SetStateAction<ViewState>>,
    selectAll: noop, painting: false, onTogglePainter: noop, onToggleProtection: noop,
  };

  it('treats a move between cells that look the same as no change', () => {
    expect(sameToolbarState(base, { ...base, selected: at(3, 4) })).toBe(true);
    expect(sameToolbarState(base, { ...base, selected: null })).toBe(true);
  });

  it('renders again when what the toolbar shows changed', () => {
    const store = new Store();
    store.setStyle('b', { bold: true });
    store.setCell(1, 1, { text: 'x', styleId: 'b' });
    const props: InteractionToolbarProps = { ...base, store, selected: at(0, 0) };
    expect(sameToolbarState(props, { ...props, selected: at(1, 1) })).toBe(false);
    expect(sameToolbarState(props, { ...props, painting: true })).toBe(false);
    expect(sameToolbarState(props, { ...props, storeVersion: 2 })).toBe(false);
  });

  it('insists on rendering again when it has no live selection to act on', () => {
    const { liveSelection: _live, ...withoutLive } = base;
    expect(sameToolbarState(withoutLive, { ...withoutLive, selected: at(3, 4) })).toBe(false);
    const own = { current: null } as RefObject<Selection | null>;
    expect(sameToolbarState({ ...base, liveSelection: own }, { ...base, liveSelection: own, selected: at(3, 4) })).toBe(true);
  });
});

describe('InteractionToolbar with a live selection', () => {
  beforeEach(mockMatchMedia);

  it('applies a button to the selection at the time of the click', () => {
    const { store, cm } = setup([[0, 0, 'a'], [1, 1, 'b']]);
    const live = createRef<Selection | null>();
    live.current = at(0, 0);
    const setView = vi.fn();
    render(<InteractionToolbar selected={live.current} liveSelection={live} store={store} cmdManager={cm} view={view} setView={setView as unknown as Dispatch<SetStateAction<ViewState>>} selectAll={noop} painting={false} onTogglePainter={noop} onToggleProtection={noop} />);
    // The selection moves without the toolbar rendering again.
    live.current = at(1, 1);
    fireEvent.click(screen.getByLabelText('Bold'));
    expect(isBold(store, 1, 1)).toBe(true);
    expect(isBold(store, 0, 0)).toBe(false);
    fireEvent.click(screen.getByLabelText('Clear contents'));
    expect(store.getCell(1, 1)?.text ?? '').toBe('');
    expect(store.getCell(0, 0)?.text).toBe('a');
  });

  it('does not render for a selection that looks the same, and does for one that does not', () => {
    const { store } = setup([[0, 0, 'a'], [1, 1, 'b']]);
    store.setStyle('b', { bold: true });
    store.setCell(2, 2, { text: 'c', styleId: 'b' });
    const live = createRef<Selection | null>();
    live.current = at(0, 0);
    const { view: counted, reads } = countedView();
    const setView = vi.fn();
    const props = { liveSelection: live, store, cmdManager: undefined, view: counted, setView: setView as unknown as Dispatch<SetStateAction<ViewState>>, selectAll: noop, painting: false, onTogglePainter: noop, onToggleProtection: noop };
    const { rerender } = render(<InteractionToolbar selected={live.current} {...props} />);
    const first = reads();
    live.current = at(1, 1);
    rerender(<InteractionToolbar selected={live.current} {...props} />);
    expect(reads()).toBe(first);
    live.current = at(2, 2);
    rerender(<InteractionToolbar selected={live.current} {...props} />);
    expect(reads()).toBeGreaterThan(first);
    expect(screen.getByLabelText('Bold').className).toContain('ant-btn-primary');
  });
});

describe('MenuBar with a live selection', () => {
  beforeEach(mockMatchMedia);

  it('runs a command on the selection at the time of the click', async () => {
    const { store, cm } = setup([[0, 0, 'a'], [1, 1, 'b']]);
    const live = createRef<Selection | null>();
    live.current = at(0, 0);
    render(<MenuBar store={store} cmdManager={cm} liveSelection={() => live.current} selectRange={noop} clearRange={noop} allRange={noop} />);
    // The selection moves without the bar rendering again.
    live.current = at(1, 1);
    fireEvent.click(screen.getByText('格式(O)'));
    fireEvent.click(await screen.findByText('斜体'));
    await waitFor(() => expect(store.getStyle(store.getCell(1, 1)?.styleId ?? '')?.italic).toBe(true));
    expect(store.getStyle(store.getCell(0, 0)?.styleId ?? '')?.italic).toBeUndefined();
  });

  it('renders again when the store changes, not when only the parent does', () => {
    const { store, cm } = setup([[0, 0, 'a']]);
    const { view: counted, reads } = countedView();
    const props = { store, cmdManager: cm, liveSelection: () => at(0, 0), selectRange: noop, clearRange: noop, allRange: noop, view: counted };
    const { rerender } = render(<MenuBar {...props} />);
    const first = reads();
    rerender(<MenuBar {...props} />);
    expect(reads()).toBe(first);
    rerender(<MenuBar {...props} storeVersion={1} />);
    expect(reads()).toBeGreaterThan(first);
  });
});
