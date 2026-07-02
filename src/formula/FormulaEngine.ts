import type { Store } from '../store/Store';
import { DependencyGraph } from './dependency';
import { evaluate, type NamedRangeResolver } from './evaluator';
import { FormulaParser } from './parser';
import type { AstNode, FormulaArgument, FormulaValue } from './types';

export class FormulaEngine {
  private graph = new DependencyGraph();
  private formulas = new Map<string, string>();
  private parser = new FormulaParser();

  constructor(private store: Store) {}

  setActiveSheetId(_sheetId: string): void {
    /* reserved for sheet-scoped recalc control */
  }

  setFormula(cellId: string, formula: string, dependsOn: string[], sheetId?: string): void {
    const scopedId = scopedKey(cellId, sheetId ?? this.store.getActiveSheetId());
    const scopedDeps = dependsOn.map((d) => scopeDep(d, sheetId ?? this.store.getActiveSheetId()));
    this.graph.setDependencies(scopedId, scopedDeps);
    this.formulas.set(scopedId, formula);
    this.recalculate(scopedId);
  }

  removeFormula(cellId: string, sheetId?: string): void {
    const scopedId = scopedKey(cellId, sheetId ?? this.store.getActiveSheetId());
    this.graph.clearDependencies(scopedId);
    this.formulas.delete(scopedId);
  }

  recalculate(scopedId: string): void {
    const formula = this.formulas.get(scopedId);
    if (formula === undefined) return;
    const ast = this.parser.parse(formula);
    if (ast === null) return;

    const { sheetId, r, c } = parseScopedKey(scopedId);
    try {
      const value = scalar(evaluate(ast, (x, y, sheetName) => this.resolveCell(x, y, sheetName), this.nameResolver));
      const existing = this.store.getCell(r, c, sheetId);
      this.store.setCell(r, c, { ...existing, text: String(value ?? ''), value }, sheetId);
    } catch (err) {
      console.error(`Formula error at ${scopedId}:`, err);
    }
  }

  onCellChanged(cellId: string, sheetId?: string): void {
    const sid = sheetId ?? this.store.getActiveSheetId();
    const scopedId = scopedKey(cellId, sid);
    const affected = this.graph.getAffected(scopedId);

    // Also look up cross-sheet deps keyed by sheet name
    const sheetName = this.sheetNameForId(sid);
    if (sheetName !== undefined) {
      const crossKey = `${sheetName}:${cellId}`;
      for (const id of this.graph.getAffected(crossKey)) {
        if (!affected.includes(id)) affected.push(id);
      }
    }

    for (const id of affected) this.recalculate(id);
  }

  private resolveCell(x: number, y: number, sheetName?: string): FormulaValue {
    const cell = sheetName === undefined
      ? this.store.getCell(y, x)
      : this.store.getCellBySheetName(sheetName, y, x);
    if (cell === undefined) return null;
    return cell.value ?? cell.text;
  }

  private sheetNameForId(sheetId: string): string | undefined {
    for (const { id, name } of this.store.getSheets()) {
      if (id === sheetId) return name;
    }
    return undefined;
  }

  private readonly nameResolver: NamedRangeResolver = (name: string): AstNode | null => {
    const def = this.store.getNamedRange(name);
    if (def === undefined) return null;
    const parts = def.range.split(':');
    const start = parts[0]?.split(',').map(Number) ?? [];
    const end = parts[1]?.split(',').map(Number) ?? start;
    return {
      type: 'range',
      x1: start[1] ?? 0,
      y1: start[0] ?? 0,
      x2: end[1] ?? 0,
      y2: end[0] ?? 0,
    };
  };
}

function scopedKey(cellId: string, sheetId: string): string {
  return `${sheetId}:${cellId}`;
}

function scopeDep(dep: string, sheetId: string): string {
  // Cross-sheet deps already have a ":" prefix (e.g. "Sheet2:0,0")
  if (dep.includes(':')) return dep;
  return `${sheetId}:${dep}`;
}

function parseScopedKey(scopedId: string): { sheetId: string; r: number; c: number } {
  const colonIndex = scopedId.indexOf(':');
  if (colonIndex < 0) return { sheetId: 'sheet-1', r: 0, c: 0 };
  const sheetId = scopedId.slice(0, colonIndex);
  const coords = parseCellId(scopedId.slice(colonIndex + 1));
  return { sheetId, r: coords?.r ?? 0, c: coords?.c ?? 0 };
}

function scalar(value: FormulaArgument): FormulaValue {
  if (isFormulaList(value)) return value[0] ?? null;
  return value;
}

function isFormulaList(value: FormulaArgument): value is readonly FormulaValue[] {
  return Array.isArray(value);
}

function parseCellId(cellId: string): { r: number; c: number } | null {
  const parts = cellId.split(',');
  if (parts.length !== 2) return null;
  const row = parts[0];
  const col = parts[1];
  if (row === undefined || col === undefined) return null;
  const r = Number(row);
  const c = Number(col);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  return { r, c };
}
