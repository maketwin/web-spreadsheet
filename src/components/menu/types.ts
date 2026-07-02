import type { CommandManager } from '../../commands/CommandManager';
import type { RangeAddress } from '../../selection/Range';
import type { Store } from '../../store/Store';
import type { Style } from '../../types';

export interface MenuContext {
  readonly store: Store;
  readonly cmdManager?: CommandManager;
  readonly selected: RangeAddress | null;
  readonly selectRange: (range: RangeAddress) => void;
  readonly clearRange: () => void;
  readonly allRange: () => void;
  readonly closeDemo?: () => void;
}

export type DialogName =
  | 'find' | 'replace' | 'insertRow' | 'insertCol' | 'zoom' | 'numberFormat'
  | 'about' | 'shortcuts' | 'options' | 'plugins' | 'chart' | 'history' | 'printPreview'
  | 'dataValidation';

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
