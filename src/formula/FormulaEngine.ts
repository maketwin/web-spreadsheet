import type { Store } from '../store/Store';
import { formulaDependencies, type NamedDepArea } from '../util/cell';
import { DependencyGraph } from './dependency';
import { evaluate } from './evaluator';
import { FormulaParser } from './parser';
import { isMatrix, type AstNode, type FormulaArgument, type FormulaValue, type MatrixValue } from './types';
import { TOTAL_COLS, TOTAL_ROWS } from '../renderer/coordinate';
import type { NamedRangeDef } from '../namedrange/types';

export class FormulaEngine {
  private graph = new DependencyGraph();
  /** Cells currently being evaluated — used for circular-ref detection. */
  private readonly evalStack = new Set<string>();
  private formulas = new Map<string, string>();
  private parser = new FormulaParser();
  /**
   * Dynamic-array spill bookkeeping: anchor scopedId -> expected extent
   * (bottom-right, INCLUSIVE of the anchor, recorded even while #SPILL!).
   * A cell change landing inside an extent re-evaluates that anchor, which
   * is how clearing a blocker recovers the spill and typing over a shadow
   * collapses it.
   */
  private readonly spills = new Map<string, { readonly r2: number; readonly c2: number }>();

  constructor(private store: Store) {}

  setActiveSheetId(_sheetId: string): void {
    /* reserved for sheet-scoped recalc control */
  }

  setFormula(cellId: string, formula: string, dependsOn: string[], sheetId?: string): void {
    const sid = sheetId ?? this.store.getActiveSheetId();
    const scopedId = scopedKey(cellId, sid);
    const fromAst = formulaDependencies(formula, (name) => this.nameArea(name, sid));
    const scopedDeps = [...new Set([...dependsOn, ...fromAst])].map((d) => this.canonicalDep(scopeDep(d, sid)));
    const circular = this.graph.wouldCreateCycle(scopedId, scopedDeps);
    this.graph.setDependencies(scopedId, scopedDeps);
    this.formulas.set(scopedId, formula);
    if (circular) {
      const { r, c } = parseScopedKey(scopedId);
      const existing = this.store.getCell(r, c, sid);
      this.store.setCell(r, c, { ...existing, text: '0', value: 0 }, sid);
      // Refresh other cells in the cycle (Excel shows 0 across the ring).
      for (const id of this.graph.getAffected(scopedId)) {
        if (id === scopedId) continue;
        this.recalculate(id);
      }
      return;
    }
    this.recalculate(scopedId);
  }

  removeFormula(cellId: string, sheetId?: string): void {
    const scopedId = scopedKey(cellId, sheetId ?? this.store.getActiveSheetId());
    this.graph.clearDependencies(scopedId);
    this.formulas.delete(scopedId);
    // A deleted/moved anchor takes its spill shadows with it.
    const extent = this.spills.get(scopedId);
    if (extent !== undefined) {
      this.spills.delete(scopedId);
      this.clearSpillShadows(scopedId, extent);
    }
  }

  recalculate(scopedId: string): void {
    const formula = this.formulas.get(scopedId);
    if (formula === undefined) return;
    const ast = this.parser.parse(formula);
    if (ast === null) return;

    const { sheetId, r, c } = parseScopedKey(scopedId);
    // Excel (iteration off): cells in a circular reference show 0.
    if (this.graph.wouldCreateCycle(scopedId, this.graph.getDependencies(scopedId))) {
      const existing = this.store.getCell(r, c, sheetId);
      this.store.setCell(r, c, { ...existing, text: '0', value: 0 }, sheetId);
      return;
    }
    // Re-entrant echo of our own result write (store event -> formula sync ->
    // setFormula): do NOT clobber the value the outer frame is about to write.
    // Genuine cycles are caught above via the dependency graph, and resolveCell
    // returns 0 for cells still on the stack (Excel iteration-off).
    if (this.evalStack.has(scopedId)) return;
    this.evalStack.add(scopedId);
    try {
      const raw: FormulaArgument = evaluate(
        ast,
        (x, y, sheetName) => this.resolveCell(x, y, sheetName, sheetId),
        (name) => this.resolveNamedRange(name, sheetId),
        {
          currentCell: { r, c },
          isRowHidden: (row, sheetName) => {
            let sid = sheetId;
            if (sheetName !== undefined) {
              const id = this.sheetIdForName(sheetName);
              if (id === undefined) return false;
              sid = id;
            }
            return this.store.getRow(row, sid)?.hide === true;
          },
        },
      );
      if (isMatrix(raw)) { this.writeSpill(scopedId, sheetId, r, c, raw); return; }
      const value = scalar(raw);
      const existing = this.store.getCell(r, c, sheetId);
      this.store.setCell(r, c, { ...existing, text: String(value ?? ''), value }, sheetId);
    } catch (err) {
      console.error(`Formula error at ${scopedId}:`, err);
    } finally {
      this.evalStack.delete(scopedId);
    }
  }

  /** Whether installing these deps on cellId would form a circular reference. */
  wouldCreateCycle(cellId: string, dependsOn: string[], sheetId?: string): boolean {
    const scopedId = scopedKey(cellId, sheetId ?? this.store.getActiveSheetId());
    const scopedDeps = dependsOn.map((d) => scopeDep(d, sheetId ?? this.store.getActiveSheetId()));
    return this.graph.wouldCreateCycle(scopedId, scopedDeps);
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

    // Dynamic-array anchors: a change landing inside an expected spill extent
    // (blocker typed in, blocker cleared, shadow overwritten) re-evaluates the
    // anchor. recalculate's evalStack guard makes the anchor's own shadow
    // writes a no-op; the idempotent spill writer makes the post-batch echo
    // converge without writing again.
    const here = parseCellId(cellId);
    if (here !== null) {
      for (const [anchor, extent] of this.spills) {
        const { sheetId: anchorSheet, r: ar, c: ac } = parseScopedKey(anchor);
        if (anchorSheet !== sid) continue;
        if (here.r >= ar && here.r <= extent.r2 && here.c >= ac && here.c <= extent.c2) this.recalculate(anchor);
      }
    }
  }

  /** Unscoped references resolve against the formula's own sheet, not the active one. */
  private resolveCell(x: number, y: number, sheetName: string | undefined, formulaSheetId: string): FormulaValue {
    let sheetId = formulaSheetId;
    let cell = sheetName === undefined
      ? this.store.getCell(y, x, formulaSheetId)
      : undefined;
    if (sheetName !== undefined) {
      const id = this.sheetIdForName(sheetName);
      if (id === undefined) return '#REF!';
      sheetId = id;
      cell = this.store.getCell(y, x, id);
    }
    if (cell === undefined) return null;
    // If this cell has a live formula, evaluate it (Excel pulls the current chain).
    // Formula keys use "r,c" (see util/cell.cellId), not A1.
    const cellKey = `${y},${x}`;
    const scoped = scopedKey(cellKey, sheetId);
    if (this.formulas.has(scoped)) {
      if (this.evalStack.has(scoped)) return 0; // circular — Excel iteration-off
      this.recalculate(scoped);
      cell = this.store.getCell(y, x, sheetId);
      if (cell === undefined) return null;
    }
    const v = cell.value ?? cell.text;
    if (typeof v === 'string' && v.startsWith('#')) return v; // keep error literals
    // CellValue ⊆ FormulaValue; only undefined needs normalizing to null.
    return v ?? null;
  }

  private sheetIdForName(name: string): string | undefined {
    const wanted = name.toLowerCase();
    for (const { id, name: n } of this.store.getSheets()) {
      if (n.toLowerCase() === wanted) return id;
    }
    return undefined;
  }

  private sheetNameForId(sheetId: string): string | undefined {
    for (const { id, name } of this.store.getSheets()) {
      if (id === sheetId) return name;
    }
    return undefined;
  }

  /** Sheet-local name first, then any sheet that defines it (workbook fallback). */
  private lookupName(name: string, formulaSheetId: string): { readonly def: NamedRangeDef; readonly ownerId: string } | undefined {
    const local = this.store.getNamedRange(name, formulaSheetId);
    if (local !== undefined) return { def: local, ownerId: formulaSheetId };
    const wanted = name.toLowerCase();
    for (const { id } of this.store.getSheets()) {
      for (const [stored, def] of this.store.getNamedRanges(id)) {
        if (stored.toLowerCase() === wanted) return { def, ownerId: id };
      }
    }
    return undefined;
  }

  private nameArea(name: string, formulaSheetId: string): NamedDepArea | undefined {
    const found = this.lookupName(name, formulaSheetId);
    if (found === undefined) return undefined;
    const area = parseInternalRange(found.def.range);
    if (area === undefined) return undefined;
    const sheetName = this.sheetNameForId(found.def.sheetId ?? found.ownerId);
    return sheetName !== undefined ? { ...area, sheetName } : area;
  }

  /** Always qualify by the name's target sheet, not whichever sheet happens to be active. */
  private resolveNamedRange(name: string, formulaSheetId: string): AstNode | null {
    const found = this.lookupName(name, formulaSheetId);
    if (found === undefined) return null;
    const area = parseInternalRange(found.def.range);
    if (area === undefined) return null;
    const sheetName = this.sheetNameForId(found.def.sheetId ?? found.ownerId);
    return {
      type: 'range',
      x1: area.c1,
      y1: area.r1,
      x2: area.c2,
      y2: area.r2,
      ...(sheetName !== undefined ? { sheetName } : {}),
    };
  }

  /**
   * Excel dynamic-array spill: write the matrix with its anchor at (r,c).
   * Blocked targets (any non-empty cell that is not this anchor's own shadow)
   * collapse the whole spill to `#SPILL!` on the anchor; the expected extent
   * is still recorded so clearing the blocker recovers it. Fully idempotent:
   * when every target already holds the exact result, nothing is written and
   * no store event fires (this is what stops the batch-end echo loop).
   */
  private writeSpill(scopedId: string, sheetId: string, r: number, c: number, m: MatrixValue): void {
    const r2 = r + m.rows - 1;
    const c2 = c + m.cols - 1;
    const overflow = r2 >= TOTAL_ROWS || c2 >= TOTAL_COLS;
    const extent = { r2: Math.min(r2, TOTAL_ROWS - 1), c2: Math.min(c2, TOTAL_COLS - 1) };

    // Retire the previous shadows first (values may shift anywhere in the box).
    const prev = this.spills.get(scopedId);
    if (prev !== undefined) this.clearSpillShadows(scopedId, prev);
    this.spills.set(scopedId, extent);

    const blocked = overflow || this.spillBlocked(sheetId, r, c, extent, scopedId);
    if (blocked) {
      const anchor = this.store.getCell(r, c, sheetId);
      const err = '#SPILL!';
      if (anchor?.text !== err) this.store.setCell(r, c, { ...anchor, text: err, value: err }, sheetId);
      return;
    }

    // Idempotence probe: identical text/value/spillOf everywhere → skip writes.
    let identical = true;
    for (let y = r; y <= extent.r2 && identical; y += 1) {
      for (let x = c; x <= extent.c2; x += 1) {
        const idx = (y - r) * m.cols + (x - c);
        const v = m.data[idx] ?? null;
        const text = String(v ?? '');
        const value = typeof v === 'object' ? text : v;
        const cell = this.store.getCell(y, x, sheetId);
        const isAnchor = y === r && x === c;
        if (cell === undefined || cell.text !== text || cell.value !== value || cell.spillOf !== (isAnchor ? undefined : scopedId) || cell.formula !== (isAnchor ? this.formulas.get(scopedId) : undefined)) {
          identical = false;
          break;
        }
      }
    }
    if (identical) return;

    this.store.batch(() => {
      for (let y = r; y <= extent.r2; y += 1) {
        for (let x = c; x <= extent.c2; x += 1) {
          const idx = (y - r) * m.cols + (x - c);
          const v = m.data[idx] ?? null;
          const text = String(v ?? '');
          const value = typeof v === 'object' ? text : v;
          const isAnchor = y === r && x === c;
          const existing = this.store.getCell(y, x, sheetId);
          if (isAnchor) this.store.setCell(y, x, { ...existing, text, value }, sheetId);
          else this.store.setCell(y, x, { text, value, spillOf: scopedId }, sheetId);
        }
      }
    });
  }

  /** Any non-empty cell in the extent that is not this anchor's own shadow. */
  private spillBlocked(sheetId: string, r: number, c: number, extent: { r2: number; c2: number }, scopedId: string): boolean {
    for (let y = r; y <= extent.r2; y += 1) {
      for (let x = c; x <= extent.c2; x += 1) {
        if (y === r && x === c) continue;
        const cell = this.store.getCell(y, x, sheetId);
        if (cell === undefined) continue;
        if (cell.spillOf === scopedId) continue;
        if (cell.text === '' && cell.value === undefined) continue;
        return true;
      }
    }
    return false;
  }

  /** Remove this anchor's shadow cells (spillOf match) inside the extent. */
  private clearSpillShadows(scopedId: string, extent: { r2: number; c2: number }): void {
    const { sheetId, r, c } = parseScopedKey(scopedId);
    this.store.batch(() => {
      for (let y = r; y <= extent.r2; y += 1) {
        for (let x = c; x <= extent.c2; x += 1) {
          if (y === r && x === c) continue;
          if (this.store.getCell(y, x, sheetId)?.spillOf === scopedId) this.store.setCell(y, x, undefined, sheetId);
        }
      }
    });
  }

  /** Cross-sheet dep keys use the canonical sheet name so `sheet2!A1` still recalcs. */
  private canonicalDep(dep: string): string {
    const colon = dep.indexOf(':');
    if (colon < 0) return dep;
    const id = this.sheetIdForName(dep.slice(0, colon));
    if (id === undefined) return dep;
    const canonical = this.sheetNameForId(id);
    return canonical !== undefined ? `${canonical}:${dep.slice(colon + 1)}` : dep;
  }
}

function parseInternalRange(range: string): { r1: number; c1: number; r2: number; c2: number } | undefined {
  const parts = range.split(':');
  const start = parts[0]?.split(',').map(Number) ?? [];
  const end = parts[1]?.split(',').map(Number) ?? start;
  const r1 = start[0];
  const c1 = start[1];
  if (r1 === undefined || c1 === undefined || !Number.isFinite(r1) || !Number.isFinite(c1)) return undefined;
  const r2 = end[0] ?? r1;
  const c2 = end[1] ?? c1;
  if (!Number.isFinite(r2) || !Number.isFinite(c2)) return undefined;
  return { r1, c1, r2, c2 };
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
  if (isMatrix(value)) return value.data[0] ?? null;
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
