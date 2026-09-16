import { describe, expect, it } from 'vitest';
import { importXlsx } from '../../src/io/XlsxImporter';
import { Store } from '../../src/store/Store';
import { createFormulaSync } from '../../src/components/Spreadsheet';
import { FormulaEngine } from '../../src/formula/FormulaEngine';
import type { Cell, Style } from '../../src/types';
import type { SerializedSheetData } from '../../src/store/SheetData';
import { buildFixtureXlsx } from './xlsxFixture';

function cellAt(data: SerializedSheetData, r: number, c: number): Cell | undefined {
  const found = data.cells.find(([key]) => key === `${r},${c}`);
  return found?.[1];
}

function styleOf(data: SerializedSheetData, cell: Cell | undefined): Style | undefined {
  if (cell?.styleId === undefined) return undefined;
  return data.styles.find(([id]) => id === cell.styleId)?.[1];
}

describe('importXlsx (full-featured fixture)', () => {
  const result = importXlsx(buildFixtureXlsx());
  const first = result.sheets[0]!;

  it('imports every sheet with its name', () => {
    expect(result.sheets.map((s) => s.name)).toEqual(['数据', 'Second']);
    expect(result.activeSheetId).toBe(result.sheets[0]!.id);
    const second = result.sheets[1]!;
    expect(cellAt(second.data, 0, 0)?.text).toBe('第二页');
  });

  it('imports text, numbers and booleans', () => {
    expect(cellAt(first.data, 0, 0)?.text).toBe('标题');
    expect(cellAt(first.data, 0, 1)).toMatchObject({ value: 1234.5, type: 'number' });
    expect(cellAt(first.data, 1, 0)).toMatchObject({ text: 'TRUE', value: true, type: 'boolean' });
  });

  it('imports error literals', () => {
    expect(cellAt(first.data, 1, 1)?.text).toBe('#DIV/0!');
    expect(cellAt(first.data, 1, 1)?.value).toBe('#DIV/0!');
  });

  it('imports formulas with their cached value', () => {
    expect(cellAt(first.data, 2, 1)).toMatchObject({ formula: '=B1*2', value: 2469 });
  });

  it('imports number formats into the cell style (custom and date)', () => {
    const custom = styleOf(first.data, cellAt(first.data, 0, 1));
    expect(custom?.numberFormat).toBe('#,##0.000');
    const dateCell = cellAt(first.data, 2, 0);
    expect(dateCell?.type).toBe('date');
    expect(dateCell?.value).toBe(45000);
    expect(styleOf(first.data, dateCell)?.numberFormat).toBe('m/d/yy');
  });

  it('imports font, fill and alignment styles', () => {
    const style = styleOf(first.data, cellAt(first.data, 0, 0));
    expect(style).toMatchObject({
      bold: true,
      fontSize: 14,
      fontFamily: 'Arial',
      color: '#FF0000',
      bgcolor: '#FFFF00',
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  });

  it('imports styled-but-empty cells (fill survives)', () => {
    const emptyStyled = cellAt(first.data, 3, 0);
    expect(emptyStyled?.text).toBe('');
    expect(styleOf(first.data, emptyStyled)?.bgcolor).toBe('#FFFF00');
    const italic = styleOf(first.data, cellAt(first.data, 3, 1));
    expect(italic).toMatchObject({ italic: true, underline: true });
  });

  it('imports merges, row heights and column widths', () => {
    expect(first.data.merges).toEqual(['A4:B4']);
    expect(first.data.rows).toContainEqual([2, { height: 30 }]);
    const col = first.data.cols.find(([c]) => c === 1);
    expect(col?.[1].width).toBeGreaterThan(100);
  });
});

describe('Store.replaceAll', () => {
  it('hot-swaps the workbook and clears nothing else', () => {
    const store = new Store();
    store.setCell(0, 0, { text: 'old' });
    store.replaceAll(importXlsx(buildFixtureXlsx()));

    expect(store.getSheets().map((s) => s.name)).toEqual(['数据', 'Second']);
    expect(store.getCell(0, 0)?.text).toBe('标题');
    expect(store.getMerges()).toEqual(['A4:B4']);
    expect(store.getCell(2, 1)?.formula).toBe('=B1*2');
    const styleId = store.getCell(0, 0)?.styleId;
    expect(styleId).toBeDefined();
    expect(store.getStyle(styleId!)?.bold).toBe(true);
    expect(store.getActiveSheetId()).toBe(store.getSheets()[0]!.id);
  });

  it('emits sheet events so UI subscribers rebuild', () => {
    const store = new Store();
    const events: string[] = [];
    store.subscribe((e) => { if (e.type === 'sheet') events.push(e.action); });
    store.replaceAll(importXlsx(buildFixtureXlsx()));
    expect(events).toContain('add');
    expect(events).toContain('activate');
  });
});

describe('replaceAll keeps formula recalculation alive', () => {
  it('imported formulas recalc when a source cell is edited afterwards', () => {
    const store = new Store();
    const engine = new FormulaEngine(store);
    const sync = createFormulaSync(store, engine);
    store.replaceAll(importXlsx(buildFixtureXlsx()));
    // Fixture B3 = B1*2 with B1 = 1234.5; without content events the engine never registers it.
    expect(Number(store.getCell(2, 1)?.text)).toBe(2469);
    store.setCell(0, 1, { text: '5' });
    expect(Number(store.getCell(2, 1)?.text)).toBe(10);
    sync.unsubscribe();
  });

  it('replays content events (row/col sizes, merges) for renderer subscribers', () => {
    const store = new Store();
    const seen: string[] = [];
    store.subscribe((e) => { seen.push(e.type); });
    store.replaceAll(importXlsx(buildFixtureXlsx()));
    for (const t of ['cell', 'row', 'col', 'style', 'merge']) {
      expect(seen).toContain(t);
    }
  });
});

describe('import style dedup and replaceAll validation', () => {
  it('identical styles share one styleId (A1 and A4 both use xf 1)', () => {
    const data = importXlsx(buildFixtureXlsx());
    const sheet = data.sheets[0]!.data;
    expect(cellAt(sheet, 0, 0)?.styleId).toBeDefined();
    expect(cellAt(sheet, 0, 0)?.styleId).toBe(cellAt(sheet, 3, 0)?.styleId);
    const styledCells = sheet.cells.filter(([, cell]) => cell.styleId !== undefined);
    expect(sheet.styles.length).toBeLessThan(styledCells.length);
  });

  it('replaceAll rejects an empty workbook', () => {
    const store = new Store();
    expect(() => store.replaceAll({ activeSheetId: 'sheet-1', sheets: [] })).toThrow();
  });
});
