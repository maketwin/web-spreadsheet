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
      border?: { top?: string; bottom?: string; left?: string; right?: string };
    }>();
  });

  it('uses a discriminated union for store events', () => {
    expectTypeOf<StoreEvent>().toMatchTypeOf<
      | { type: 'cell'; r: number; c: number; cell: Cell | undefined }
      | { type: 'row'; r: number; meta: { height?: number; hide?: boolean } | undefined }
      | { type: 'col'; c: number; meta: { width?: number; hide?: boolean } | undefined }
      | { type: 'style'; id: string; style: Style | undefined }
      | { type: 'merge'; range: string }
    >();
  });

  it('defines unsubscribe as a void callback', () => {
    expectTypeOf<Unsubscribe>().toEqualTypeOf<() => void>();
  });
});
