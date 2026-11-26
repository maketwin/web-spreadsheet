import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { InteractionToolbar, sameToolbarState, type InteractionToolbarProps } from '../../src/components/InteractionToolbar';
import { CommandManager } from '../../src/commands/CommandManager';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { Store } from '../../src/store/Store';
import { Range } from '../../src/selection/Range';
import { columnSelection, rowSelection, rangeSelection, type Selection } from '../../src/selection/Selection';
import { TOTAL_COLS, TOTAL_ROWS } from '../../src/util/gridSize';
import type { ViewState } from '../../src/components/keyboard';

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
const live = { current: null } as RefObject<Selection | null>;

const columnSel = (c: number): Selection => columnSelection(c, TOTAL_ROWS, c);
const rowSel = (r: number): Selection => rowSelection(r, TOTAL_COLS, r);
const at = (r: number, c: number): Selection => rangeSelection(Range.single(r, c).toAddress());

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

function makeProps(store: Store, selected: Selection, storeVersion = 1): InteractionToolbarProps {
  return {
    selected, liveSelection: live, store, cmdManager: undefined, view, storeVersion,
    setView: noop as unknown as Dispatch<SetStateAction<ViewState>>,
    selectAll: noop, painting: false, onTogglePainter: noop, onToggleProtection: noop,
  };
}

describe('toolbar on axis selections', () => {
  it('shows the column default format while a whole column is selected', () => {
    mockMatchMedia();
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ r1: 0, c1: 2, r2: TOTAL_ROWS - 1, c2: 2, style: { bold: true } }));

    render(<InteractionToolbar {...makeProps(store, columnSel(2))} />);
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold.className).toContain('ant-btn-primary');
  });

  it('shows the row default format while a whole row is selected', () => {
    mockMatchMedia();
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ r1: 4, c1: 0, r2: 4, c2: TOTAL_COLS - 1, style: { italic: true } }));

    render(<InteractionToolbar {...makeProps(store, rowSel(4))} />);
    const italic = screen.getByRole('button', { name: 'Italic' });
    expect(italic.className).toContain('ant-btn-primary');
    // The active cell's own direct format is ignored on an axis selection.
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold.className).not.toContain('ant-btn-primary');
  });

  it('ignores the direct format of the active cell on a column selection (axis format wins)', () => {
    mockMatchMedia();
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ r1: 0, c1: 1, r2: TOTAL_ROWS - 1, c2: 1, style: { bold: true } }));
    store.setCell(3, 1, { text: 'plain' });
    // Even a cell with a plain-looking own style must not flip the toolbar:
    // the shown format is the column default.
    render(<InteractionToolbar {...makeProps(store, { ...columnSel(1), active: { r: 3, c: 1 } })} />);
    expect(screen.getByRole('button', { name: 'Bold' }).className).toContain('ant-btn-primary');
  });

  it('re-renders when the axis default changes (store version advances)', () => {
    const store = new Store();
    const prev = makeProps(store, columnSel(2), 1);
    expect(sameToolbarState(prev, prev)).toBe(true);
    // Two columns with the same (empty) default look identical.
    expect(sameToolbarState(prev, makeProps(store, columnSel(3), 1))).toBe(true);

    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ r1: 0, c1: 2, r2: TOTAL_ROWS - 1, c2: 2, style: { bold: true } }));
    expect(sameToolbarState(prev, makeProps(store, columnSel(2), 2))).toBe(false);
    // Once rendered at the new version, an unchanged look stays memoized.
    const after = makeProps(store, columnSel(2), 2);
    expect(sameToolbarState(after, makeProps(store, columnSel(2), 2))).toBe(true);
    // A move to another column (no default there) changes what is shown.
    expect(sameToolbarState(after, makeProps(store, columnSel(3), 2))).toBe(false);
  });

  it('keeps bounded selections reading the effective style of the active cell', () => {
    const store = new Store();
    const cm = new CommandManager(store);
    cm.execute.bind(cm)(new SetRangeStyleCommand({ r1: 0, c1: 0, r2: TOTAL_ROWS - 1, c2: 0, style: { bold: true } }));
    cm.execute.bind(cm)(new SetRangeStyleCommand({ r1: 2, c1: 0, r2: 2, c2: 0, style: { italic: true } }));
    const prev = makeProps(store, at(2, 0), 1);
    // The bounded cell carries bold+italic via its own style (effective base);
    // a move to a cell that resolves to the same look stays put.
    expect(sameToolbarState(prev, makeProps(store, at(2, 0), 1))).toBe(true);
    expect(sameToolbarState(prev, makeProps(store, at(5, 0), 1))).toBe(false); // bold-only vs bold+italic
  });
});
