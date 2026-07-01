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
  | { type: 'cell'; r: number; c: number; cell: Cell | undefined }
  | { type: 'row'; r: number; meta: RowMeta | undefined }
  | { type: 'col'; c: number; meta: ColMeta | undefined }
  | { type: 'style'; id: string; style: Style | undefined }
  | { type: 'merge'; range: string };

export type Unsubscribe = () => void;
