import type { CommandManager } from '../../commands/CommandManager';
import type { RangeAddress } from '../../selection/Range';
import type { Store } from '../../store/Store';
import type { Style } from '../../types';

export interface MenuContext {
  readonly store: Store;
  readonly cmdManager?: CommandManager;
  readonly selected: RangeAddress | null;
  /** Active cell for Excel Freeze Panes (rows above / cols left). */
  readonly activeCell?: { readonly r: number; readonly c: number } | null;
  readonly selectRange: (range: RangeAddress) => void;
  readonly clearRange: () => void;
  readonly allRange: () => void;
  readonly closeDemo?: () => void;
  /**
   * While a cell editor is open with a text selection, run-level style keys
   * (bold/italic/underline/fontSize/fontFamily/color) apply to the selected
   * characters instead of the whole cells. Returns true when handled.
   */
  readonly applyRunStyleToEditor?: (style: Partial<Style>) => boolean;
}

export type DialogName =
  | 'find' | 'replace' | 'insertRow' | 'insertCol' | 'zoom' | 'numberFormat'
  | 'about' | 'shortcuts' | 'options' | 'plugins' | 'chart' | 'history' | 'printPreview'
  | 'dataValidation' | 'sparkline' | 'protectSheet' | 'unprotectSheet' | 'cfFormula'
  | 'removeDuplicates' | 'textToColumns' | 'hyperlink';

export interface ViewState {
  readonly zoom: number;
  readonly showFormula: boolean;
  readonly showGrid: boolean;
  readonly frozenRows: number;
  readonly frozenCols: number;
  readonly setZoom: (zoom: number) => void;
  readonly setShowFormula: (value: boolean) => void;
  readonly setShowGrid: (value: boolean) => void;
  readonly setFreeze: (rows: number, cols: number) => void;
}

export interface MenuActions {
  readonly run: (key: string) => void;
  readonly openDialog: (name: DialogName) => void;
  readonly applyStyle: (style: Partial<Style>) => void;
}
