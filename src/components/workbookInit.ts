import type { CommandManager } from '../commands/CommandManager';
import { SetRangeValues } from '../commands/impl/SetRangeValues';
import type { FormulaEngine } from '../formula/FormulaEngine';
import type { Store } from '../store/Store';
import { formulaDependencies, formulaText, normalizeCellInput } from '../util/cell';
import type { CellInput } from './Spreadsheet';

export function loadData(store: Store, cmd: CommandManager, formula: FormulaEngine, data: readonly (readonly CellInput[])[]): void { loadValues(cmd, data); syncExistingFormulas(store, formula); }
export function loadSheets(store: Store, cmd: CommandManager, formula: FormulaEngine, sheets: readonly { readonly name: string; readonly data?: readonly (readonly CellInput[])[] }[]): void { sheets.forEach((sheet, index) => { const id = index === 0 ? store.getActiveSheetId() : store.addSheet(sheet.name); store.renameSheet(id, sheet.name); store.activateSheet(id); loadValues(cmd, sheet.data ?? []); syncExistingFormulas(store, formula); }); const first = store.getSheets()[0]; if (first !== undefined) store.activateSheet(first.id); }
function loadValues(cmd: CommandManager, data: readonly (readonly CellInput[])[]): void { const values = data.map((row) => row.map(normalizeCellInput)); const maxCols = values.reduce((max, row) => Math.max(max, row.length), 0); if (values.length === 0 || maxCols === 0) return; const run = cmd.execute.bind(cmd); run(new SetRangeValues({ r1: 0, c1: 0, r2: values.length - 1, c2: maxCols - 1, values })); }

function syncExistingFormulas(store: Store, engine: FormulaEngine): void { const sheetId = store.getActiveSheetId(); store.getCells().forEach(([id, cell]) => { const formula = formulaText(cell); if (formula !== undefined) engine.setFormula(id, formula, formulaDependencies(formula), sheetId); }); }
