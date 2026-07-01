import type { Store } from '../store/Store';
import { DependencyGraph } from './dependency';
import { evaluate } from './evaluator';
import { FormulaParser } from './parser';
import type { FormulaValue } from './types';

export class FormulaEngine {
  private graph = new DependencyGraph();
  private formulas = new Map<string, string>();
  private parser = new FormulaParser();

  constructor(private store: Store) {}

  setFormula(cellId: string, formula: string, dependsOn: string[]): void {
    this.graph.setDependencies(cellId, dependsOn);
    this.formulas.set(cellId, formula);
    this.recalculate(cellId);
  }

  removeFormula(cellId: string): void {
    this.graph.clearDependencies(cellId);
    this.formulas.delete(cellId);
  }

  recalculate(cellId: string): void {
    const formula = this.formulas.get(cellId);
    if (!formula) return;
    const ast = this.parser.parse(formula);
    if (!ast) return;

    try {
      const value = evaluate(ast, (x, y) => this.resolveCell(x, y));
      const coords = parseCellId(cellId);
      if (!coords) return;
      const existing = this.store.getCell(coords.r, coords.c);
      this.store.setCell(coords.r, coords.c, { ...existing, text: String(value ?? ''), value });
    } catch (err) {
      console.error(`Formula error at ${cellId}:`, err);
    }
  }

  onCellChanged(cellId: string): void {
    const affected = this.graph.getAffected(cellId);
    for (const id of affected) this.recalculate(id);
  }

  private resolveCell(x: number, y: number): FormulaValue {
    const cell = this.store.getCell(y, x);
    if (!cell) return null;
    return cell.value ?? cell.text;
  }
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
