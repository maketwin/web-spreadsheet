export type CellValue = string | number | boolean | Date | null;

export interface Cell {
  text: string;
  value?: CellValue;
  formula?: string;
  styleId?: string;
  type?: 'text' | 'number' | 'date' | 'boolean';
}

export interface RowMeta {
  height?: number;
  hide?: boolean;
}

export interface ColMeta {
  width?: number;
  hide?: boolean;
}

export interface Style {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  bgcolor?: string;
  align?: 'left' | 'center' | 'right';
  fontSize?: number;
  fontFamily?: string;
  border?: { top?: string; bottom?: string; left?: string; right?: string };
}

export type StoreEvent =
  | { type: 'cell'; r: number; c: number; cell: Cell | undefined; sheetId?: string }
  | { type: 'row'; r: number; meta: RowMeta | undefined; sheetId?: string }
  | { type: 'col'; c: number; meta: ColMeta | undefined; sheetId?: string }
  | { type: 'style'; id: string; style: Style | undefined; sheetId?: string }
  | { type: 'merge'; range: string; sheetId?: string }
  | { type: 'sheet'; action: 'activate' | 'add' | 'rename' | 'delete'; sheetId: string; name?: string };

export type Unsubscribe = () => void;
