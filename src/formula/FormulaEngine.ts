import type { Store } from '../store/Store';
import { cellIdCoords, formulaText } from '../util/cell';
import { depsOfAst, type NamedDepArea } from './precedents';
import type { Cell } from '../types';
import { DependencyGraph, type RectRegistration } from './dependency';
import { dateResultOf, evaluate, type DateResult } from './evaluator';
import { FormulaParser } from './parser';
import { registry, type FunctionRegistry } from './registry';
import { isMatrix, isSparseRange, type AstNode, type FormulaArgument, type FormulaValue, type MatrixValue } from './types';
import { TOTAL_COLS, TOTAL_ROWS } from '../util/gridSize';
import { parseInternalRange } from '../util/rangeNotation';
import { formatValue } from '../format/NumberFormatter';
import type { NamedRangeDef } from '../namedrange/types';

/** Upper bound on recalculation passes per change set (a spill rewrite costs one extra pass). */
const MAX_PASSES = 100;
/**
 * Functions that read only the cell their lookup lands on: a rectangle
 * covering the formula's own cell is not a self-reference for them.
 */
const SCALAR_LOOKUP_FNS: ReadonlySet<string> = new Set(['INDEX', 'VLOOKUP', 'HLOOKUP', 'MATCH', 'XLOOKUP']);
/**
 * Formulas kept parsed at once. Relative references make every formula's
 * text its own, so a sheet can hold more formulas than this (the grid is
 * Excel-sized); when a long editing session fills the cache, it is cleared
 * wholesale and refilled on demand.
 */
const MAX_CACHED_FORMULAS = 40_000;

export interface FormulaEngineOptions {
  /**
   * Function table formulas resolve against; the shared `registry` when
   * omitted. Pass a private one — `new FunctionRegistry(registry)` — to keep
   * what plugins register on this engine from leaking into other engines.
   */
  readonly registry?: FunctionRegistry;
}

export class FormulaEngine {
  private graph = new DependencyGraph();
  /** Cells currently being evaluated — used for circular-ref detection. */
  private readonly evalStack = new Set<string>();
  private formulas = new Map<string, string>();
  /**
   * The exact per-cell precedents each registration installed (what
   * onNamedRangeChanged compares against — the graph holds rectangle-derived
   * edges on top of these, so it cannot answer "what did I register").
   */
  private readonly registeredDeps = new Map<string, string[]>();
  private parser = new FormulaParser();
  /**
   * Dynamic-array spill bookkeeping: anchor scopedId -> expected extent
   * (bottom-right, INCLUSIVE of the anchor, recorded even while #SPILL!).
   * A cell change landing inside an extent re-evaluates that anchor, which
   * is how clearing a blocker recovers the spill and typing over a shadow
   * collapses it.
   */
  private readonly spills = new Map<string, { readonly r2: number; readonly c2: number }>();
  /**
   * Scheduling state. A formula is `dirty` while its stored value may be
   * stale; evaluating it clears the flag, and only a cell whose value
   * actually changed makes its readers dirty again (Excel's recalculation
   * rule). Work queued inside `coalesce` runs as one pass at the outermost
   * exit, so a row insert recalculates as a whole instead of one cascade per
   * shifted cell.
   */
  private readonly dirty = new Set<string>();
  /** Cells on a dependency ring; Excel (iteration off) shows them as 0. */
  private readonly circular = new Set<string>();
  /**
   * Formulas whose evaluation touched a volatile function
   * (FunctionSpec.volatile, e.g. NOW / TODAY). They have no precedents, so
   * nothing else wakes them: every drain that has other work re-evaluates
   * them, Excel's volatility rule. Reported at evaluation time through the
   * context callback, so a name that turns volatile later is honored without
   * re-parsing. Cleared wherever the formula itself goes (unregister /
   * reset / onSheetDeleted / reloadFromStore).
   */
  private readonly volatileFormulas = new Set<string>();
  private queue: string[] = [];
  private readonly changedCells: { readonly sheetId: string; readonly r: number; readonly c: number }[] = [];
  /** Last value seen per cell, so an in-place rewrite (a style change) propagates nothing. */
  private readonly seen = new Map<string, string>();
  private readonly asts = new Map<string, AstNode | null>();
  /** Shadow cell -> the anchor that just wrote it; that anchor need not look again. */
  private readonly shadowOwner = new Map<string, string>();
  /** Scoped ids the engine is writing right now (lets the sync layer skip its own echo). */
  private readonly selfWrites = new Set<string>();
  private spillBatch = false;
  private depth = 0;
  private draining = false;
  private forcePull = false;
  /**
   * Cells whose value is a date serial (formula results classified by
   * `dateResultOf`, and imported date cells). Excel gives a formula the date
   * display of the first number it reads, so `=A1+31` of a date is a date.
   */
  private readonly dateCells = new Map<string, DateResult>();
  /** Kind of the first numeric cell the evaluation in progress read: null when it was not a date. */
  private firstNumberRead: DateResult | null | undefined;

  /** Function table every formula of this engine resolves against. */
  public readonly registry: FunctionRegistry;

  constructor(private store: Store, options?: FormulaEngineOptions) {
    this.registry = options?.registry ?? registry;
  }

  setActiveSheetId(_sheetId: string): void {
    /* reserved for sheet-scoped recalc control */
  }

  /** Group everything `fn` triggers into one recalculation pass. */
  coalesce(fn: () => void): void {
    this.depth += 1;
    try {
      fn();
    } finally {
      this.depth -= 1;
      if (this.depth === 0) this.drain();
    }
  }

  /** True while the engine is recalculating. */
  isRecalculating(): boolean {
    return this.depth > 0 || this.draining;
  }

  /** True while the engine itself is writing this cell — its sync layer must not echo it. */
  isSelfWrite(sheetId: string | undefined, r: number, c: number): boolean {
    return this.selfWrites.has(scopedKey(`${r},${c}`, sheetId ?? this.store.getActiveSheetId()));
  }

  setFormula(cellId: string, formula: string, dependsOn: string[], sheetId?: string): void {
    const sid = sheetId ?? this.store.getActiveSheetId();
    const scopedId = scopedKey(cellId, sid);
    this.coalesce(() => {
      // A re-registration of a cell that still holds our last result (style
      // change, batch-end replay of an unmoved cell) has nothing to do.
      const here = parseCellId(cellId);
      const current = here === null ? undefined : this.store.getCell(here.r, here.c, sid);
      if (!this.dirty.has(scopedId) && this.formulas.get(scopedId) === formula && this.seen.get(scopedId) === signatureOf(current)) return;
      this.register(scopedId, formula, dependsOn, sid);
    });
  }

  /**
   * A named range was defined, moved or removed. Names resolve when a
   * formula registers, so exactly the formulas whose dependency set changes
   * re-register (and recalculate); the rest are left alone.
   */
  onNamedRangeChanged(): void {
    this.coalesce(() => {
      for (const [scopedId, formula] of [...this.formulas]) {
        const { sheetId } = parseScopedKey(scopedId);
        const cells = this.depsOf(this.astOf(formula), [], sheetId).cells;
        const current = this.registeredDeps.get(scopedId);
        if (current !== undefined && cells.length === current.length && cells.every((d) => current.includes(d))) continue;
        this.register(scopedId, formula, [], sheetId);
      }
    });
  }

  removeFormula(cellId: string, sheetId?: string): void {
    const scopedId = scopedKey(cellId, sheetId ?? this.store.getActiveSheetId());
    this.coalesce(() => {
      // Most cells never had a registration (every plain-cell edit passes here).
      if (!this.formulas.has(scopedId) && !this.spills.has(scopedId)) return;
      this.unregister(scopedId);
      // Whatever read the old value must see the cell as it is now.
      this.markDependents(scopedId);
    });
  }

  /** Forget every registration — the workbook underneath was replaced wholesale. */
  reset(): void {
    this.graph.clear();
    this.formulas.clear();
    this.registeredDeps.clear();
    this.spills.clear();
    this.dirty.clear();
    this.circular.clear();
    this.evalStack.clear();
    this.dateCells.clear();
    this.volatileFormulas.clear();
    this.queue = [];
    this.changedCells.length = 0;
    this.seen.clear();
    this.shadowOwner.clear();
    this.sheetsDirty = true;
  }

  /** Sheet removed: its formulas, dependency edges and spill bookkeeping go too. */
  onSheetDeleted(sheetId: string): void {
    const prefix = `${sheetId}:`;
    this.sheetsDirty = true;
    this.graph.clearSheetRects(sheetId);
    this.coalesce(() => {
      // The sheet is gone: its shadows cannot be cleared, only forgotten.
      for (const key of [...this.spills.keys()]) {
        if (key.startsWith(prefix)) this.spills.delete(key);
      }
      for (const key of [...this.formulas.keys()]) {
        if (!key.startsWith(prefix)) continue;
        this.unregister(key);
        this.markDependents(key);
      }
    });
  }

  /** The sheet list changed (added / renamed / copied): name lookups rebuild lazily. */
  onSheetsChanged(): void {
    this.sheetsDirty = true;
  }

  /**
   * Rows or columns of `sheetId` moved wholesale (insert: the half-plane at
   * `start` moved `count` down/right; delete: the band [start, start+count)
   * was removed and the rest moved up). The store already holds the final
   * state when this runs. Registered formulas on the moving half-plane
   * re-register at their new coordinates from the store's current cells
   * (formulas inside a deleted band unregister; cells pushed off the grid
   * drop their formulas); readers of the moved half-plane — per-cell
   * dependencies into it (own-sheet `sheetId:r,c` keys and cross-sheet
   * `SheetName:r,c` keys), rectangle dependencies reaching past `start`, and
   * spill extents overlapping the band — are queued, then one pass drains.
   */
  public onStructureShift(sheetId: string, axis: 'row' | 'col', kind: 'insert' | 'delete', start: number, count: number): void {
    const limit = axis === 'row' ? TOTAL_ROWS : TOTAL_COLS;
    this.coalesce(() => {
      // Phase 1 — unregister every formula at/after `start`, INCLUDING the
      // ones inside a deleted band: a formula whose cell is gone must be off
      // the books (registration, spill extent, graph edges) or the spill
      // wake below would re-evaluate it at its old coordinates and write
      // value + shadows back over deleted rows.
      const moved: Array<{ readonly r: number; readonly c: number }> = [];
      for (const id of [...this.formulas.keys()]) {
        const { sheetId: sid, r, c } = parseScopedKey(id);
        if (sid !== sheetId) continue;
        const at = axis === 'row' ? r : c;
        if (at < start) continue;
        moved.push({ r, c });
        this.unregister(id); // also retires the formula's spill extent
      }
      // Phase 2 — re-register from the store's final state at the new coordinates.
      for (const { r, c } of moved) {
        const at = axis === 'row' ? r : c;
        const nextAt = kind === 'insert' ? at + count : at - count;
        if (nextAt < start || nextAt >= limit) continue; // pushed off the grid: the cell is gone
        const cell = axis === 'row' ? this.store.getCell(nextAt, c, sheetId) : this.store.getCell(r, nextAt, sheetId);
        const formula = formulaText(cell);
        if (formula === undefined) continue;
        const key = axis === 'row' ? `${nextAt},${c}` : `${r},${nextAt}`;
        this.register(scopedKey(key, sheetId), formula, [], sheetId);
      }
      // Phase 3 — wake readers of the moved half-plane.
      const wake = new Set<string>();
      const sheetName = this.sheetNameForId(sheetId);
      for (const id of this.formulas.keys()) {
        if (this.dirty.has(id)) continue;
        for (const dep of this.graph.dependenciesOf(id) ?? []) {
          const colon = dep.indexOf(':');
          if (colon <= 0) continue;
          const depSheet = dep.slice(0, colon);
          if (depSheet !== sheetId && (sheetName === undefined || depSheet !== sheetName)) continue;
          const coords = cellIdCoords(dep.slice(colon + 1));
          if (coords === null) continue;
          if ((axis === 'row' ? coords.r : coords.c) >= start) {
            wake.add(id);
            break;
          }
        }
      }
      for (const id of this.graph.rectDependentsFrom(sheetId, axis, start)) {
        if (!this.dirty.has(id)) wake.add(id);
      }
      for (const [anchor, extent] of this.spills) {
        const { sheetId: sid } = parseScopedKey(anchor);
        if (sid !== sheetId) continue;
        if ((axis === 'row' ? extent.r2 : extent.c2) >= start) wake.add(anchor);
      }
      for (const id of wake) {
        if (this.dirty.has(id) || !this.formulas.has(id)) continue;
        this.dirty.add(id);
        this.queue.push(id);
      }
    });
  }

  /**
   * The cells inside `rect` of `sheetId` were rewritten wholesale (a sparse
   * clear, or the undo putting them back) — the store already holds the final
   * state. The work is proportional to the formulas that live in or read the
   * rectangle, never to the cells it holds: a cleared million-cell column
   * must not cost one deferred entry per cell. Formulas registered inside
   * re-sync against the store (a cleared one unregisters, a restored or
   * reworded one registers again, an untouched one is queued because what it
   * reads may have changed); readers of any address inside — per-cell
   * dependencies (own-sheet and `SheetName:` keys), rectangle dependencies,
   * spill extents — are queued, then one pass drains.
   */
  public onCellsReplaced(sheetId: string, rect: { r1: number; c1: number; r2: number; c2: number }): void {
    const inside = (r: number, c: number): boolean => r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
    this.coalesce(() => {
      const wake = new Set<string>();
      for (const id of [...this.formulas.keys()]) {
        const { sheetId: sid, r, c } = parseScopedKey(id);
        if (sid !== sheetId || !inside(r, c)) continue;
        const registered = this.formulas.get(id);
        const formula = formulaText(this.store.getCell(r, c, sheetId));
        if (formula === undefined) {
          this.unregister(id); // the cell is gone, or no longer holds a formula
        } else if (formula === registered) {
          wake.add(id);
        } else {
          this.register(id, formula, [], sheetId);
        }
      }
      const sheetName = this.sheetNameForId(sheetId);
      for (const id of this.formulas.keys()) {
        if (this.dirty.has(id)) continue;
        for (const dep of this.graph.dependenciesOf(id) ?? []) {
          const colon = dep.indexOf(':');
          if (colon <= 0) continue;
          const depSheet = dep.slice(0, colon);
          if (depSheet !== sheetId && (sheetName === undefined || depSheet !== sheetName)) continue;
          const coords = cellIdCoords(dep.slice(colon + 1));
          if (coords === null) continue;
          if (inside(coords.r, coords.c)) {
            wake.add(id);
            break;
          }
        }
      }
      for (const id of this.graph.rectDependentsIn(sheetId, rect)) {
        if (!this.dirty.has(id)) wake.add(id);
      }
      // A spill spans from its anchor down/right to (r2, c2): re-evaluate the
      // anchors whose range meets the rectangle (a cleared shadow comes back,
      // a cleared anchor was unregistered above and took its extent along).
      for (const [anchor, extent] of this.spills) {
        const { sheetId: sid, r, c } = parseScopedKey(anchor);
        if (sid !== sheetId) continue;
        if (r <= rect.r2 && extent.r2 >= rect.r1 && c <= rect.c2 && extent.c2 >= rect.c1) wake.add(anchor);
      }
      for (const id of wake) {
        if (this.dirty.has(id) || !this.formulas.has(id)) continue;
        this.dirty.add(id);
        this.queue.push(id);
      }
    });
  }

  /** Rebuild every registration from the cells the store holds now, then recalculate. */
  reloadFromStore(): void {
    this.reset();
    this.coalesce(() => {
      for (const { id } of this.store.getSheets()) {
        for (const [key, cell] of this.store.getCells(id)) {
          // A plain cell marked as a date (xlsx import) lends its display to formulas reading it.
          if (cell.type === 'date' && typeof cell.value === 'number' && cell.formula === undefined) {
            this.dateCells.set(scopedKey(key, id), Number.isInteger(cell.value) ? 'date' : 'datetime');
          }
          const formula = formulaText(cell);
          if (formula === undefined) continue;
          this.setFormula(key, formula, [], id);
        }
      }
    });
  }

  /**
   * Re-evaluate one formula cell and, when its value changes, whatever reads
   * it. Precedent formulas are pulled afresh as well, so callers that change
   * cells without going through the sync layer still read current values.
   */
  recalculate(scopedId: string): void {
    this.coalesce(() => {
      if (!this.formulas.has(scopedId)) return;
      this.forcePull = true;
      this.dirty.add(scopedId);
      this.queue.push(scopedId);
    });
  }

  /**
   * Recalculate every formula cell (mock-platform scenario switch, external
   * data change). The pass evaluates in dependency order, so precedents write
   * before dependents read and a long chain never recurses one frame per link.
   */
  recalculateAll(): void {
    this.coalesce(() => {
      for (const id of this.formulas.keys()) {
        if (this.dirty.has(id)) continue;
        this.dirty.add(id);
        this.queue.push(id);
      }
    });
  }

  /** Whether installing these deps on cellId would form a circular reference. */
  wouldCreateCycle(cellId: string, dependsOn: string[], sheetId?: string): boolean {
    const scopedId = scopedKey(cellId, sheetId ?? this.store.getActiveSheetId());
    const scopedDeps = dependsOn.map((d) => scopeDep(d, sheetId ?? this.store.getActiveSheetId()));
    return this.graph.wouldCreateCycle(scopedId, scopedDeps);
  }

  /** A cell took a new value: its readers are stale. */
  onCellChanged(cellId: string, sheetId?: string): void {
    const here = parseCellId(cellId);
    if (here === null) return;
    const sid = sheetId ?? this.store.getActiveSheetId();
    this.coalesce(() => this.noteChange(sid, here.r, here.c));
  }

  /** Install (or replace) one formula's registration and queue it for evaluation. */
  private register(scopedId: string, formula: string, dependsOn: readonly string[], sheetId: string): void {
    const ast = this.astOf(formula);
    const deps = this.depsOf(ast, dependsOn, sheetId);
    const here = parseScopedKey(scopedId);
    // A formula landing inside an existing rectangle dependency becomes a
    // precedent of the rectangle's owner: an exact edge added INCREMENTALLY
    // (rebuilding the owner's dependency set would drop its rectangle
    // registrations) so ring detection sees the pairing either way, plus a
    // dirty mark (the owner must read the new formula's value).
    for (const owner of this.graph.rectDependents(sheetId, here.r, here.c)) {
      if (owner === scopedId || !this.formulas.has(owner)) continue;
      const ring = this.graph.addDependency(owner, scopedId);
      this.refreshCircular(owner, ring);
      if (!this.dirty.has(owner)) {
        this.dirty.add(owner);
        this.queue.push(owner);
      }
    }
    // Formulas already living inside this formula's own rectangles are exact
    // precedents (per-cell edges) — ring detection, lifting and the queue
    // order keep working on ordinary edges alone. A rectangle covering the
    // formula's own cell is a self-edge for aggregate-style formulas (=SUM
    // over a range containing its own cell is circular, as in Excel) — but
    // not for the scalar lookups, which read only the cell they land on
    // (=INDEX(A1:C1048576, 5, 2) in C1 answers B5's value).
    const rectCells: string[] = [];
    const scalarLookup = ast !== null && ast.type === 'func' && SCALAR_LOOKUP_FNS.has(ast.name);
    for (const rect of deps.rects) {
      if (!scalarLookup && rect.sheetId === sheetId && rect.r1 <= here.r && here.r <= rect.r2 && rect.c1 <= here.c && here.c <= rect.c2) rectCells.push(scopedId);
      for (const id of this.graph.formulasInRect(rect.sheetId, rect.r1, rect.c1, rect.r2, rect.c2)) {
        if (id !== scopedId) rectCells.push(id);
      }
    }
    // The ring check belongs here, where edges change — never per evaluation.
    const createsCycle = this.graph.setDependencies(scopedId, [...deps.cells, ...rectCells]);
    this.graph.registerRects(scopedId, deps.rects);
    this.registeredDeps.set(scopedId, deps.cells);
    this.formulas.set(scopedId, formula);
    this.refreshCircular(scopedId, createsCycle);
    this.dirty.add(scopedId);
    this.queue.push(scopedId);
  }

  /**
   * The parse of a formula, by text. Formulas are parsed when they register
   * and again on every evaluation; parsing was about two fifths of a full
   * recalculation. The registry and named ranges are read at evaluation, so
   * a parsed formula never goes stale — the cache only has a size limit.
   */
  private astOf(formula: string): AstNode | null {
    let ast = this.asts.get(formula);
    if (ast === undefined) {
      if (this.asts.size >= MAX_CACHED_FORMULAS) this.asts.clear();
      ast = this.parser.parse(formula);
      this.asts.set(formula, ast);
    }
    return ast;
  }

  /**
   * The formula's precedents: caller-supplied plus parsed, as exact per-cell
   * keys and as rectangle registrations (parsed ranges above
   * RANGE_DEP_CELLS, names expanded to their area). Rectangles resolve their
   * sheet here, at registration time; a sheet that does not resolve watches
   * nothing.
   */
  private depsOf(ast: AstNode | null, dependsOn: readonly string[], sheetId: string): { cells: string[]; rects: RectRegistration[] } {
    const fromAst = ast === null ? { cells: [], rects: [] } : depsOfAst(ast, (name) => this.nameArea(name, sheetId));
    const cells = [...new Set([...dependsOn, ...fromAst.cells])].map((d) => this.canonicalDep(scopeDep(d, sheetId)));
    const rects: RectRegistration[] = [];
    for (const rect of fromAst.rects) {
      let sid = sheetId;
      if (rect.sheetName !== undefined) {
        const id = this.sheetIdForName(rect.sheetName);
        if (id === undefined) continue;
        sid = id;
      }
      rects.push({ sheetId: sid, r1: rect.r1, c1: rect.c1, r2: rect.r2, c2: rect.c2 });
    }
    return { cells, rects };
  }

  /**
   * Ring membership is decided at registration — the only place edges
   * change — so recalculation never has to walk the graph per evaluation.
   * A new ring runs through `scopedId`; otherwise only a member that
   * registers again, or leaves, can have opened one — which re-checks the ring.
   */
  private refreshCircular(scopedId: string, createsCycle: boolean): void {
    if (createsCycle) {
      for (const id of [scopedId, ...this.graph.getAffected(scopedId)]) {
        if (this.isOnRing(id)) this.circular.add(id);
      }
      return;
    }
    if (this.circular.has(scopedId)) this.recheckRing();
  }

  private isOnRing(id: string): boolean {
    return this.graph.wouldCreateCycle(id, this.graph.getDependencies(id));
  }

  /** Drop the members a change to the ring may have freed. */
  private recheckRing(): void {
    for (const id of [...this.circular]) {
      if (!this.formulas.has(id) || !this.isOnRing(id)) this.circular.delete(id);
    }
  }

  private unregister(scopedId: string): void {
    this.graph.clearDependencies(scopedId);
    this.registeredDeps.delete(scopedId);
    this.formulas.delete(scopedId);
    this.dirty.delete(scopedId);
    this.dateCells.delete(scopedId);
    this.volatileFormulas.delete(scopedId);
    if (this.circular.delete(scopedId)) this.recheckRing();
    // A deleted/moved anchor takes its spill shadows with it.
    this.retireSpill(scopedId);
  }

  /** Cells reading `node` (a scoped id, or a sheet-name-qualified key) are stale. */
  private markDependents(node: string): void {
    for (const id of this.graph.directDependents(node)) {
      if (this.dirty.has(id) || !this.formulas.has(id)) continue;
      this.dirty.add(id);
      this.queue.push(id);
    }
  }

  /** A cell holds a new value: its readers are stale and anchors spilling over it look again. */
  private propagate(sheetId: string, r: number, c: number): void {
    const key = `${sheetId}:${r},${c}`;
    this.seen.set(key, signatureOf(this.store.getCell(r, c, sheetId)));
    this.changedCells.push({ sheetId, r, c });
    this.markDependents(key);
    // Cross-sheet readers are keyed by sheet name.
    const sheetName = this.sheetNameForId(sheetId);
    if (sheetName !== undefined) this.markDependents(`${sheetName}:${r},${c}`);
    // Readers of a rectangle over this cell (ranges too large for per-cell edges).
    for (const owner of this.graph.rectDependents(sheetId, r, c)) {
      if (this.dirty.has(owner) || !this.formulas.has(owner)) continue;
      this.dirty.add(owner);
      this.queue.push(owner);
    }
  }

  private noteChange(sheetId: string, r: number, c: number): void {
    const scopedId = scopedKey(`${r},${c}`, sheetId);
    // Rewritten in place (a style change, a cell moved onto itself): readers
    // already see the value they were last computed from.
    if (this.seen.get(scopedId) === signatureOf(this.store.getCell(r, c, sheetId))) return;
    this.propagate(sheetId, r, c);
  }

  /** A change landed inside a spill extent: that anchor evaluates again (its spill state depends on occupancy). */
  private markSpillAnchors(cell: { readonly sheetId: string; readonly r: number; readonly c: number }): void {
    if (this.spills.size === 0) return;
    // A shadow the engine just rewrote is its own anchor's doing.
    const owner = this.shadowOwner.get(scopedKey(`${cell.r},${cell.c}`, cell.sheetId));
    for (const [anchor, extent] of this.spills) {
      if (anchor === owner) continue;
      const { sheetId, r, c } = parseScopedKey(anchor);
      if (sheetId !== cell.sheetId) continue;
      if (cell.r < r || cell.r > extent.r2 || cell.c < c || cell.c > extent.c2) continue;
      if (this.dirty.has(anchor) || !this.formulas.has(anchor)) continue;
      this.dirty.add(anchor);
      this.queue.push(anchor);
    }
  }

  /** Dependency order for the pending queue: precedents evaluate before the cells that pull them. */
  private orderQueue(): void {
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const id of new Set(this.queue)) {
      indegree.set(id, 0);
      dependents.set(id, []);
    }
    for (const id of indegree.keys()) {
      for (const dep of this.graph.dependenciesOf(id) ?? []) {
        if (dep === id || !indegree.has(dep)) continue;
        indegree.set(id, (indegree.get(id) ?? 0) + 1);
        dependents.get(dep)?.push(id);
      }
    }
    const ready = this.queue.filter((id) => indegree.get(id) === 0);
    const ordered: string[] = [];
    const done = new Set<string>();
    while (ready.length > 0) {
      const id = ready.shift();
      if (id === undefined || done.has(id)) continue;
      done.add(id);
      ordered.push(id);
      for (const next of dependents.get(id) ?? []) {
        const left = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, left);
        if (left === 0) ready.push(next);
      }
    }
    // Rings cannot be ordered (they show 0); they evaluate after the rest.
    for (const id of this.queue) {
      if (done.has(id)) continue;
      done.add(id);
      ordered.push(id);
    }
    this.queue = ordered;
  }

  /**
   * The recalculation pass. Each pass inspects the cell changes collected so
   * far (spill anchors), then works off the dirty queue; evaluating a cell can
   * queue more (readers of a changed value, anchors over a rewritten shadow),
   * hence the outer loop.
   */
  private drain(): void {
    if (this.draining) return; // a nested engine call merges into the running pass
    this.draining = true;
    try {
      for (let pass = 0; this.changedCells.length > 0 || this.queue.length > 0; pass += 1) {
        const changed = this.changedCells.splice(0);
        for (const cell of changed) this.markSpillAnchors(cell);
        if (pass === 0) {
          // The loop condition above means this drain has other work: the
          // volatile formulas re-evaluate too (they have no precedents, so
          // nothing else queues them). A drain with nothing to do never
          // enters the loop, so a no-op rewrite stirs nothing.
          for (const id of this.volatileFormulas) {
            if (this.dirty.has(id) || !this.formulas.has(id)) continue;
            this.dirty.add(id);
            this.queue.push(id);
          }
          this.orderQueue();
        }
        for (let i = 0; i < this.queue.length; i += 1) {
          const id = this.queue[i];
          if (id === undefined || !this.dirty.has(id)) continue;
          this.evaluateNow(id);
        }
        this.queue = [];
        if (pass >= MAX_PASSES) {
          console.error('FormulaEngine: recalculation did not converge');
          break;
        }
      }
    } finally {
      this.draining = false;
      this.forcePull = false;
      this.shadowOwner.clear();
      this.queue = [];
      this.changedCells.length = 0;
    }
  }

  private evaluateNow(scopedId: string): void {
    const formula = this.formulas.get(scopedId);
    if (formula === undefined) {
      this.dirty.delete(scopedId);
      return;
    }
    const { sheetId, r, c } = parseScopedKey(scopedId);
    // Re-entrant pull (a ring the static graph cannot see): the outer frame owns the write.
    if (this.evalStack.has(scopedId)) return;
    try {
      if (this.circular.has(scopedId)) {
        // Excel (iteration off): cells on a ring show 0.
        this.putCell(sheetId, r, c, { ...this.store.getCell(r, c, sheetId), text: '0', value: 0 });
        return;
      }
      const ast = this.astOf(formula);
      if (ast === null) return;
      this.evalStack.add(scopedId);
      try {
        // What this evaluation reads first; a precedent pulled in meanwhile keeps its own.
        const outerRead = this.firstNumberRead;
        this.firstNumberRead = undefined;
        let firstRead: DateResult | null | undefined;
        let raw: FormulaArgument;
        try {
          raw = evaluate(
            ast,
            (x, y, sheetName) => this.resolveCell(x, y, sheetName, sheetId),
            (name) => this.resolveNamedRange(name, sheetId),
            {
              currentCell: { r, c },
              sheetId,
              registry: this.registry,
              onVolatileCall: () => { this.volatileFormulas.add(scopedId); },
              isRowHidden: (row, sheetName) => {
                let sid = sheetId;
                if (sheetName !== undefined) {
                  const id = this.sheetIdForName(sheetName);
                  if (id === undefined) return false;
                  sid = id;
                }
                return this.store.getRow(row, sid)?.hide === true;
              },
              forEachStoredCell: (rect, sheetName, fn) => {
                let sid = sheetId;
                if (sheetName !== undefined) {
                  const id = this.sheetIdForName(sheetName);
                  if (id === undefined) return; // a sheet that does not resolve holds nothing
                  sid = id;
                }
                const carrier = this.walkCarrier;
                this.store.forEachCellInRect({ r1: rect.y1, c1: rect.x1, r2: rect.y2, c2: rect.x2 }, (r, c, cell) => {
                  // The walk already fetched this cell; resolveCell picks it up
                  // one-shot instead of hitting the store again. The carrier is
                  // mutated in place — one allocation per evaluation, not per cell.
                  carrier.sid = sid;
                  carrier.x = c;
                  carrier.y = r;
                  carrier.cell = cell;
                  fn(c, r);
                }, sid);
                this.walkCarrier.cell = undefined;
              },
            },
          );
        } finally {
          firstRead = this.firstNumberRead;
          this.firstNumberRead = outerRead;
        }
        if (isMatrix(raw)) {
          this.writeSpill(scopedId, sheetId, r, c, raw);
          this.dateCells.delete(scopedId);
        } else {
          // Scalar result: an anchor that used to spill no longer does — retire
          // its shadows BEFORE writing the value (orphan shadows would persist as
          // real-looking data and block future spills).
          this.retireSpill(scopedId);
          const value = scalar(raw);
          // Excel shows a number as a date when the formula's own result is one,
          // or when the first number it reads is a date cell (=A1+31).
          const kind = typeof value === 'number' ? (dateResultOf(ast) ?? firstRead ?? undefined) : undefined;
          if (kind === undefined) this.dateCells.delete(scopedId);
          else this.dateCells.set(scopedId, kind);
          this.putCell(sheetId, r, c, { ...this.store.getCell(r, c, sheetId), text: resultText(kind, value), value });
        }
      } finally {
        this.evalStack.delete(scopedId);
      }
    } catch (err) {
      console.error(`Formula error at ${scopedId}:`, err);
    } finally {
      this.dirty.delete(scopedId);
    }
  }

  /** Unscoped references resolve against the formula's own sheet, not the active one. */
  private resolveCell(x: number, y: number, sheetName: string | undefined, formulaSheetId: string): FormulaValue {
    let sheetId = formulaSheetId;
    if (sheetName !== undefined) {
      const id = this.sheetIdForName(sheetName);
      if (id === undefined) return '#REF!';
      sheetId = id;
    }
    const carrier = this.walkCarrier;
    let cell: Cell | undefined;
    if (carrier.cell !== undefined && carrier.x === x && carrier.y === y && carrier.sid === sheetId) {
      cell = carrier.cell;
      carrier.cell = undefined;
    } else {
      cell = this.store.getCell(y, x, sheetId);
    }
    if (cell === undefined) return null;
    // Only formula cells take part in the engine's dirty/pull machinery —
    // plain values answer straight from the store, without touching the maps
    // or building keys. A cell carrying a value was never a formula (writing
    // a formula drops the value), so the common read skips the text check.
    // Formula keys use "r,c" (see util/cell.cellId), not A1.
    if (cell.formula !== undefined || (cell.value === undefined && cell.text.startsWith('='))) {
      const scoped = `${sheetId}:${y},${x}`;
      if (this.formulas.has(scoped)) {
        if (this.evalStack.has(scoped)) return 0; // circular — Excel iteration-off
        if (this.forcePull || this.dirty.has(scoped)) {
          this.evaluateNow(scoped);
          cell = this.store.getCell(y, x, sheetId);
          if (cell === undefined) return null;
        }
      }
    }
    // CellValue ⊆ FormulaValue; a NaN number is host garbage with no Excel
    // meaning — the text is what the cell shows (typed FALSE, labels …).
    const raw = cell.value;
    const v = raw === undefined || (typeof raw === 'number' && Number.isNaN(raw)) ? cell.text : raw;
    if (typeof v === 'string' && v.startsWith('#')) return v; // keep error literals
    if (this.firstNumberRead === undefined && typeof v === 'number') {
      // Once per evaluation: the date display of the first number it reads.
      const read = this.dateCells.get(`${sheetId}:${y},${x}`);
      this.firstNumberRead = read === undefined ? null : read;
    }
    // CellValue ⊆ FormulaValue; only undefined needs normalizing to null.
    return v ?? null;
  }

  /**
   * The cell the running stored-cell walk just delivered, consumed by the
   * next resolve of the same address — one store lookup saved per walked
   * cell. One carrier object per engine, mutated in place by the walk.
   */
  private walkCarrier = { sid: '', x: -1, y: -1, cell: undefined as Cell | undefined };

  /**
   * Sheet name/id lookups, cached between changes: every resolved reference
   * and every cell change used to rebuild and scan the sheet list. The caches
   * drop on any sheet event (add / rename / delete / copy — see
   * onSheetsChanged) and on reset.
   */
  private sheetsDirty = true;
  private readonly sheetIdsByName = new Map<string, string>();
  private readonly sheetNamesById = new Map<string, string>();

  private ensureSheetIndex(): void {
    if (!this.sheetsDirty) return;
    this.sheetsDirty = false;
    this.sheetIdsByName.clear();
    this.sheetNamesById.clear();
    for (const { id, name } of this.store.getSheets()) {
      this.sheetIdsByName.set(name.toLowerCase(), id);
      this.sheetNamesById.set(id, name);
    }
  }

  private sheetIdForName(name: string): string | undefined {
    this.ensureSheetIndex();
    return this.sheetIdsByName.get(name.toLowerCase());
  }

  private sheetNameForId(sheetId: string): string | undefined {
    this.ensureSheetIndex();
    return this.sheetNamesById.get(sheetId);
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
    if (area === null) return undefined;
    const sheetName = this.sheetNameForId(found.def.sheetId ?? found.ownerId);
    return sheetName !== undefined ? { ...area, sheetName } : area;
  }

  /** Always qualify by the name's target sheet, not whichever sheet happens to be active. */
  private resolveNamedRange(name: string, formulaSheetId: string): AstNode | null {
    const found = this.lookupName(name, formulaSheetId);
    if (found === undefined) return null;
    const area = parseInternalRange(found.def.range);
    if (area === null) return null;
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
   * no store event fires.
   */
  private writeSpill(scopedId: string, sheetId: string, r: number, c: number, m: MatrixValue): void {
    const r2 = r + m.rows - 1;
    const c2 = c + m.cols - 1;
    const overflow = r2 >= TOTAL_ROWS || c2 >= TOTAL_COLS;
    const extent = { r2: Math.min(r2, TOTAL_ROWS - 1), c2: Math.min(c2, TOTAL_COLS - 1) };

    // Idempotence gate FIRST, before any clearing: a re-evaluation must find
    // the spill already correct and leave without writing — clearing our own
    // shadows here would make the write below mandatory forever. Only a
    // same-extent, fully-matching spill may take the no-op exit (a shrunken
    // or moved one still needs its retract pass below).
    const prev = this.spills.get(scopedId);
    if (prev !== undefined && prev.r2 === extent.r2 && prev.c2 === extent.c2 && this.spillMatches(sheetId, r, c, extent, scopedId, m)) return;

    // Retire the previous shadows first (values may shift anywhere in the box).
    if (prev !== undefined) this.clearSpillShadows(scopedId, prev);
    this.spills.set(scopedId, extent);

    const blocked = overflow || this.spillBlocked(sheetId, r, c, extent, scopedId);
    if (blocked) {
      this.putCell(sheetId, r, c, { ...this.store.getCell(r, c, sheetId), text: '#SPILL!', value: '#SPILL!' });
      return;
    }

    if (this.spillMatches(sheetId, r, c, extent, scopedId, m)) return;

    // All targets change together: one batch keeps subscribers from seeing a
    // half-written spill.
    this.spillBatch = true;
    try {
      this.store.batch(() => {
        for (let y = r; y <= extent.r2; y += 1) {
          for (let x = c; x <= extent.c2; x += 1) {
            const idx = (y - r) * m.cols + (x - c);
            const v = m.data[idx] ?? null;
            const text = String(v ?? '');
            const value = spillValue(v, text);
            const isAnchor = y === r && x === c;
            const existing = this.store.getCell(y, x, sheetId);
            if (isAnchor) {
              // Its own shadows landing in the next pass must not wake it again.
              this.shadowOwner.set(scopedId, scopedId);
              this.putCell(sheetId, y, x, { ...existing, text, value });
            } else {
              // Preserve the target's own formatting (Excel keeps styles under a
              // spill), but never its content-bound fields — those belong to the
              // previous occupant, and a stale richText/hyperlink would misrender.
              const shadow: Cell = { text, value, spillOf: scopedId };
              if (existing?.styleId !== undefined) shadow.styleId = existing.styleId;
              if (existing?.type !== undefined) shadow.type = existing.type;
              this.putCell(sheetId, y, x, shadow);
            }
          }
        }
      });
    } finally {
      this.spillBatch = false;
      this.selfWrites.clear();
    }
  }

  /**
   * Write one result cell. Nothing happens — no store event, no cascade —
   * when the cell already holds exactly this text/value/spillOf, so a
   * recalculated-but-unchanged value never wakes its readers.
   */
  private putCell(sheetId: string, r: number, c: number, next: Cell | undefined): void {
    const key = scopedKey(`${r},${c}`, sheetId);
    this.seen.set(key, signatureOf(next));
    if (sameCell(this.store.getCell(r, c, sheetId), next)) return;
    this.selfWrites.add(key);
    try {
      this.store.setCell(r, c, next, sheetId);
    } finally {
      // Inside a spill batch the flush is deferred: stay marked until it is delivered.
      if (!this.spillBatch) this.selfWrites.delete(key);
    }
    if (next?.spillOf !== undefined) this.shadowOwner.set(key, next.spillOf);
    this.propagate(sheetId, r, c);
  }

  /** True when every cell of the extent already holds this exact spill
   * (text/value/spillOf/anchor formula). Dates compare by time — fresh
   * evaluations construct equal-but-distinct Date objects, and a
   * reference-only compare would rewrite (and echo) forever. */
  private spillMatches(sheetId: string, r: number, c: number, extent: { readonly r2: number; readonly c2: number }, scopedId: string, m: MatrixValue): boolean {
    for (let y = r; y <= extent.r2; y += 1) {
      for (let x = c; x <= extent.c2; x += 1) {
        const idx = (y - r) * m.cols + (x - c);
        const v = m.data[idx] ?? null;
        const text = String(v ?? '');
        const value = spillValue(v, text);
        const cell = this.store.getCell(y, x, sheetId);
        const isAnchor = y === r && x === c;
        if (cell === undefined || cell.text !== text || !sameValue(cell.value, value) || cell.spillOf !== (isAnchor ? undefined : scopedId) || cell.formula !== (isAnchor ? this.formulas.get(scopedId) : undefined)) {
          return false;
        }
      }
    }
    return true;
  }

  /** Retire a spill this anchor no longer has (removed, moved or turned scalar). */
  private retireSpill(scopedId: string): void {
    const prev = this.spills.get(scopedId);
    if (prev === undefined) return;
    this.spills.delete(scopedId);
    this.clearSpillShadows(scopedId, prev);
  }

  /** Any non-empty cell in the extent that is not this anchor's own shadow. */
  private spillBlocked(sheetId: string, r: number, c: number, extent: { readonly r2: number; readonly c2: number }, scopedId: string): boolean {
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
  private clearSpillShadows(scopedId: string, extent: { readonly r2: number; readonly c2: number }): void {
    const { sheetId, r, c } = parseScopedKey(scopedId);
    this.spillBatch = true;
    try {
      this.store.batch(() => {
        for (let y = r; y <= extent.r2; y += 1) {
          for (let x = c; x <= extent.c2; x += 1) {
            if (y === r && x === c) continue;
            if (this.store.getCell(y, x, sheetId)?.spillOf === scopedId) this.putCell(sheetId, y, x, undefined);
          }
        }
      });
    } finally {
      this.spillBatch = false;
      this.selfWrites.clear();
    }
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
  if (isSparseRange(value)) return '#VALUE!'; // a range too large to materialise is not one value
  if (isFormulaList(value)) return value[0] ?? null;
  if (isMatrix(value)) return value.data[0] ?? null;
  return value;
}

/** Spill cell value: Dates keep their type (formatting depends on it); any other object degrades to its text. */
function spillValue(v: FormulaValue | null, text: string): FormulaValue {
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v !== null) return text;
  return v ?? null;
}

function isFormulaList(value: FormulaArgument): value is readonly FormulaValue[] {
  return Array.isArray(value);
}

/**
 * Text a formula cell shows. Excel displays a result that is a date —
 * TODAY(), DATE(…), a number of days added to either, or a calculation whose
 * first reference is a date cell — as a date, not as its serial number; the
 * cell keeps the number as its value, so arithmetic on it works. A cell that
 * carries its own number format is shown by that instead.
 */
function resultText(kind: DateResult | undefined, value: FormulaValue): string {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && kind !== undefined) {
    if (kind === 'date') return formatValue(value, 'date').text;
    return `${formatValue(Math.floor(value), 'date').text} ${formatValue(value, 'time').text}`;
  }
  return String(value ?? '');
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());
}

/** Same visible content (text, value, spill ownership) — formatting is not the engine's business. */
function sameCell(a: Cell | undefined, b: Cell | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.text === b.text && sameValue(a.value, b.value) && a.spillOf === b.spillOf;
}

/** Compact fingerprint of a cell's content, to tell a real change from an in-place rewrite. */
function signatureOf(cell: Cell | undefined): string {
  if (cell === undefined) return '';
  const v: unknown = cell.value;
  const value = v instanceof Date
    ? `D${v.getTime()}`
    : typeof v === 'object' && v !== null ? `O${JSON.stringify(v)}` : `${typeof v}:${String(v)}`;
  return `${cell.text}\u0000${value}\u0000${cell.spillOf ?? ''}`;
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
