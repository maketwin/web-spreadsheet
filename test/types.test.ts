import { describe, expectTypeOf, it } from 'vitest';
import type { Cell, CellValue, StoreEvent, Style, Unsubscribe } from '../src/types';

describe('domain types', () => {
  it('accepts cell text with optional typed value and metadata', () => {
    expectTypeOf<Cell>().toMatchTypeOf<{
      text: string;
      value?: CellValue;
      formula?: string;
      styleId?: string;
      type?: 'text' | 'number' | 'date' | 'boolean';
    }>();
  });

  it('accepts all supported cell values', () => {
    expectTypeOf<string>().toMatchTypeOf<CellValue>();
    expectTypeOf<number>().toMatchTypeOf<CellValue>();
    expectTypeOf<boolean>().toMatchTypeOf<CellValue>();
    expectTypeOf<Date>().toMatchTypeOf<CellValue>();
    expectTypeOf<null>().toMatchTypeOf<CellValue>();
  });

  it('supports style alignment and borders', () => {
    expectTypeOf<Style>().toMatchTypeOf<{
      align?: 'left' | 'center' | 'right';
      valign?: 'top' | 'middle' | 'bottom';
      border?: { top?: string; bottom?: string; left?: string; right?: string };
    }>();
  });

  it('uses a discriminated union for store events', () => {
    expectTypeOf<StoreEvent>().toMatchTypeOf<
      | { type: 'cell'; r: number; c: number; cell: Cell | undefined }
      | { type: 'row'; r: number; meta: { height?: number; hide?: boolean } | undefined }
      | { type: 'col'; c: number; meta: { width?: number; hide?: boolean } | undefined }
      | { type: 'structure'; axis: 'row' | 'col'; kind: 'insert' | 'delete'; start: number; count: number }
      | { type: 'cells'; keys: readonly number[] }
      | { type: 'style'; id: string; style: Style | undefined }
      | { type: 'merge'; range: string }
      | { type: 'sheet'; action: 'activate' | 'add' | 'rename' | 'move' | 'recolor' | 'delete'; sheetId: string; name?: string }
      | { type: 'autofilter'; sheetId: string }
      | { type: 'workbook'; action: 'replace' }
      | { type: 'conditionalRules'; range: string; sheetId?: string }
      | { type: 'charts'; id: string; sheetId?: string }
      | { type: 'images'; id: string; sheetId?: string }
      | { type: 'sparklines'; id: string; sheetId?: string }
      | { type: 'validations'; range: string; sheetId?: string }
      | { type: 'namedRanges'; name: string; sheetId?: string }
      | { type: 'rowGroups'; sheetId?: string }
      | { type: 'freeze'; sheetId?: string }
      | { type: 'protection'; sheetId?: string }
      | { type: 'workbookPassword' }
    >();
  });

  it('defines unsubscribe as a void callback', () => {
    expectTypeOf<Unsubscribe>().toEqualTypeOf<() => void>();
  });
});
