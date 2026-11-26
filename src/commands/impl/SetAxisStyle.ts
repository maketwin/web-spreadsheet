import { Command } from '../Command';
import { TOTAL_COLS, TOTAL_ROWS } from '../../util/gridSize';

import type { Store } from '../../store/Store';
import type { CellRect } from '../../store/SheetData';
import type { ColMeta, RowMeta, Style } from '../../types';

export type StyleAxis = 'row' | 'col';

/** Border edges a patch may set; an explicit `undefined` edge drops it. */
export type BorderEdgePatch = { readonly [K in keyof NonNullable<Style['border']>]?: NonNullable<Style['border']>[K] | undefined };

/** Like Partial<Style> but an explicit `undefined` value means "remove the property". */
export type StylePatch = {
  readonly [K in keyof Style]?: K extends 'border' ? BorderEdgePatch | undefined : Style[K] | undefined;
};

export interface SetAxisStyleArgs {
  readonly axis: StyleAxis;
  /** Inclusive index range on the axis. */
  readonly from: number;
  readonly to: number;
  /**
   * Style delta merged onto each index's current default. Keys whose value is
   * `undefined` delete the property (border edges included) — the same reading
   * SetRangeBorder gives its `none` line.
   */
  readonly style: StylePatch;
  /** Target sheet; defaults to the active sheet at execution time. */
  readonly sheetId?: string;
}

/** The axis span a selection addresses, or null when the selection is bounded. */
export interface AxisSelection {
  readonly axis: StyleAxis;
  readonly from: number;
  readonly to: number;
}

/**
 * Whole-axis selection detection: a selection spanning every row is a column
 * format, one spanning every column is a row format. Selecting the whole sheet
 * (both spans full) writes column defaults for all 16,384 columns — one meta
 * entry per column is accepted (Excel does the same); the 1,048,576-row axis
 * is never enumerated.
 */
export function axisSelectionOf(range: CellRect): AxisSelection | null {
  const r1 = Math.min(range.r1, range.r2);
  const c1 = Math.min(range.c1, range.c2);
  const r2 = Math.max(range.r1, range.r2);
  const c2 = Math.max(range.c1, range.c2);
  const fullRows = r1 === 0 && r2 >= TOTAL_ROWS - 1;
  const fullCols = c1 === 0 && c2 >= TOTAL_COLS - 1;
  if (fullRows && fullCols) return { axis: 'col', from: 0, to: TOTAL_COLS - 1 };
  if (fullRows) return { axis: 'col', from: c1, to: c2 };
  if (fullCols) return { axis: 'row', from: r1, to: r2 };
  return null;
}

/** Reserved style ids for axis defaults. Only the axis commands write to them. */
export function reservedAxisStyleId(axis: StyleAxis, index: number): string {
  return axis === 'col' ? `colstyle-${index}` : `rowstyle-${index}`;
}

/** True for the reserved `colstyle-*` / `rowstyle-*` ids — content interning must never hand these out to cells. */
export function isReservedAxisStyleId(styleId: string): boolean {
  return styleId.startsWith('colstyle-') || styleId.startsWith('rowstyle-');
}

/**
 * Merge an axis style delta onto `base`. Scalar keys overwrite; a `undefined`
 * value deletes the key. `border` merges edge-wise (an edge set to `undefined`
 * or `'none'` drops that edge), so a preset like "top border" keeps the other
 * edges a previous command put on the axis.
 */
export function mergeAxisStyle(base: Style | undefined, delta: StylePatch): Style {
  const next: Style = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(delta) as Array<[keyof Style, Style[keyof Style]]>) {
    if (key === 'border') {
      const patch = delta.border;
      if (patch === undefined) {
        delete next.border;
        continue;
      }
      const merged: NonNullable<Style['border']> = { ...(next.border ?? {}) };
      // Only the edges the patch names are touched — absent edges keep theirs.
      for (const edge of Object.keys(patch) as Array<keyof NonNullable<Style['border']>>) {
        const edgeValue = patch[edge];
        if (edgeValue === undefined || edgeValue === 'none') delete merged[edge];
        else merged[edge] = edgeValue;
      }
      if (Object.keys(merged).length === 0) delete next.border;
      else next.border = merged;
      continue;
    }
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

/**
 * Compact undo snapshot of one axis write. Only the EXCEPTIONS are recorded:
 * the span, the indices that carried meta before it (a 500,000-row write on a
 * sheet without row metas records zero of them), and the style-table entries
 * that existed before and were replaced. `writtenIds` lists the span ids the
 * write created/replaced so undo can drop the created ones — the whole span
 * shares ONE style entry per run of equal base, so this stays tiny.
 */
export interface AxisStyleSnapshot {
  readonly from: number;
  readonly to: number;
  readonly metas: ReadonlyArray<{ readonly index: number; readonly meta: RowMeta | ColMeta }>;
  readonly styles: ReadonlyArray<{ readonly id: string; readonly style: Style }>;
  readonly writtenIds: ReadonlyArray<string>;
}

export interface AxisStyleSnapshotsArgs {
  readonly axis: StyleAxis;
  readonly snapshots: readonly AxisStyleSnapshot[];
  readonly sheetId?: string;
}

/** A maximal run of consecutive indices sharing one base styleId — one style entry for all of them. */
interface AxisRun {
  start: number;
  end: number;
  /** Base styleId the run's metas referenced before the write (undefined = no default). */
  readonly baseStyleId: string | undefined;
  /** Style id the run's defaults live under: the first index's reserved id, or a probed span id when
   * that reserved id is referenced by any meta outside this run (an earlier span's owner, or a row a
   * structural shift moved out of alignment). Writing under a referenced id would restyle those rows too. */
  id: string | undefined;
  /** Pre-op style at `id`, when one existed (undo restores it). Captured once `id` is picked, still pre-write. */
  replaced: Style | undefined;
  /** Pre-op style the run's metas pointed at (merge base, captured before any write). */
  readonly base: Style | undefined;
  /** Metas the run's indices carried before the write (undo exceptions). */
  readonly metas: Array<{ readonly index: number; readonly meta: RowMeta | ColMeta }>;
}

/**
 * Write the whole-column / whole-row default style. Consecutive indices with
 * the same base styleId share ONE style entry, and meta-less rows share one
 * meta object per run — a 500,000-row bold costs one style entry and a
 * handful of allocations, never one entry per row. A run writes under its
 * first index's reserved id ONLY while no meta outside the run references
 * that id; otherwise it probes a fresh span id (`rowstyle-<start>-1`, `-2`,
 * …), so a later write to the span's owner row (or to any single row) can
 * never leak onto the rows that still share the entry. Style objects are
 * replaced, never mutated. Cells keep their own formats — they simply keep
 * winning.
 */
export class SetAxisStyleCommand extends Command<SetAxisStyleArgs> {
  private snapshots: readonly AxisStyleSnapshot[] = [];
  private execSheetId: string | undefined;

  public override kind(): 'setAxisStyle' { return 'setAxisStyle'; }

  public override historyWeight(): number {
    return this.snapshots.reduce((n, s) => n + s.metas.length + s.styles.length, 0);
  }

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    // Ownership scan (one pass over the axis's metas — O(metadata entries)):
    // which style ids does the address space already reference, in and out of
    // the span? A run may write under an id only when NOTHING outside the run
    // references it — an outside reference (the previous span's owner row, or
    // a row a structural shift left pointing at it) would receive this run's
    // style. In-span references from the run's own members are fine: they are
    // rewritten to the chosen id; references from another in-span run are not.
    const outsideRefs = new Set<string>();
    const insideRefs = new Map<string, number>();
    const entries = this.args.axis === 'col' ? store.getColEntries(sid) : store.getRowEntries(sid);
    for (const [index, meta] of entries) {
      const id = meta.styleId;
      if (id === undefined) continue;
      if (index < this.args.from || index > this.args.to) outsideRefs.add(id);
      else insideRefs.set(id, (insideRefs.get(id) ?? 0) + 1);
    }
    // Pass 1 — read everything pre-op: run boundaries, per-run metas, and the
    // merge bases. No writes here, so every run reads the original entries.
    const runs: AxisRun[] = [];
    for (let i = this.args.from; i <= this.args.to; i += 1) {
      const meta = this.args.axis === 'col' ? store.getCol(i, sid) : store.getRow(i, sid);
      const baseStyleId = meta?.styleId;
      const last = runs[runs.length - 1];
      if (last === undefined || last.baseStyleId !== baseStyleId) {
        const run: AxisRun = {
          start: i,
          end: i,
          baseStyleId,
          id: undefined,
          replaced: undefined,
          base: baseStyleId === undefined ? undefined : store.getStyle(baseStyleId, sid),
          metas: [],
        };
        runs.push(run);
        if (meta !== undefined) run.metas.push({ index: i, meta });
      } else {
        last.end = i;
        if (meta !== undefined) last.metas.push({ index: i, meta });
      }
    }
    // Pick each run's write id now that its member count is known: the first
    // index's reserved id is safe only when (a) no meta outside the span
    // references it, (b) no meta of another in-span run references it, and
    // (c) when it IS the run's base id, every in-span reference belongs to
    // this run's members. Otherwise probe `rowstyle-<start>-1`, `-2`, … for
    // an unreferenced id. All of this stays pre-write, so `replaced` sees the
    // original entry.
    for (const run of runs) {
      const natural = reservedAxisStyleId(this.args.axis, run.start);
      const baseCount = run.baseStyleId === undefined ? 0 : (insideRefs.get(run.baseStyleId) ?? 0);
      const forbidden = (id: string): boolean =>
        outsideRefs.has(id)
        || (id !== run.baseStyleId && insideRefs.has(id))
        || (id === run.baseStyleId && baseCount !== run.metas.length);
      if (!forbidden(natural)) {
        run.id = natural;
      } else {
        for (let n = 1; run.id === undefined; n += 1) {
          const candidate = `${natural}-${n}`;
          if (!forbidden(candidate)) run.id = candidate;
        }
      }
      run.replaced = store.getStyle(run.id, sid);
    }
    // Pass 2 — write. One style entry per run; meta-less rows share one meta
    // object per run (every write path copies metas, never mutates them).
    for (const run of runs) {
      const id = run.id as string;
      store.setStyle(id, mergeAxisStyle(run.base, this.args.style), sid);
      const plainMeta = { styleId: id } as RowMeta & ColMeta;
      const exception = new Map(run.metas.map((m) => [m.index, m.meta]));
      for (let i = run.start; i <= run.end; i += 1) {
        const meta = exception.get(i);
        const next = meta === undefined ? plainMeta : { ...meta, styleId: id };
        if (this.args.axis === 'col') store.setCol(i, next as ColMeta, sid);
        else store.setRow(i, next as RowMeta, sid);
      }
    }
    this.snapshots = runs.map((run) => ({
      from: run.start,
      to: run.end,
      metas: run.metas,
      styles: run.replaced === undefined ? [] : [{ id: run.id as string, style: run.replaced }],
      writtenIds: [run.id as string],
    }));
  }

  public getUndo(): Command {
    return new RestoreAxisStyleCommand({
      axis: this.args.axis,
      snapshots: this.snapshots,
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }
}

export interface ClearAxisStyleArgs {
  readonly axis: StyleAxis;
  readonly from: number;
  readonly to: number;
  readonly sheetId?: string;
}

/**
 * Remove the axis default style from every index in the span (Excel: clearing
 * formats on a whole-column selection also drops the column format). Only
 * indices that carry meta are touched; a meta that carried nothing else is
 * removed. The style entry a meta pointed at is deleted too — unless a meta
 * OUTSIDE the span still references it (spans can share entries after a
 * structural shift moved some rows out of alignment). Undo restores metas and
 * deleted entries exactly; nothing is created, so there is nothing to clean.
 */
export class ClearAxisStyleCommand extends Command<ClearAxisStyleArgs> {
  private snapshots: readonly AxisStyleSnapshot[] = [];
  private execSheetId: string | undefined;

  public override kind(): 'clearAxisStyle' { return 'clearAxisStyle'; }

  public override historyWeight(): number {
    return this.snapshots.reduce((n, s) => n + s.metas.length + s.styles.length, 0);
  }

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const preMetas: Array<{ readonly index: number; readonly meta: RowMeta | ColMeta }> = [];
    const writes: Array<readonly [number, RowMeta | ColMeta | undefined]> = [];
    const referenced = new Set<string>();
    for (let i = this.args.from; i <= this.args.to; i += 1) {
      const meta = this.args.axis === 'col' ? store.getCol(i, sid) : store.getRow(i, sid);
      if (meta === undefined) continue;
      preMetas.push({ index: i, meta });
      const rest = { ...meta };
      delete rest.styleId;
      writes.push([i, Object.keys(rest).length > 0 ? rest : undefined]);
      if (meta.styleId !== undefined) referenced.add(meta.styleId);
    }
    // Delete referenced entries only when no meta outside the span shares them.
    const deleted: Array<{ readonly id: string; readonly style: Style }> = [];
    if (referenced.size > 0) {
      const sharedOutside = new Set<string>();
      const entries = this.args.axis === 'col' ? store.getColEntries(sid) : store.getRowEntries(sid);
      for (const [index, meta] of entries) {
        if (meta.styleId === undefined || !referenced.has(meta.styleId)) continue;
        if (index < this.args.from || index > this.args.to) sharedOutside.add(meta.styleId);
      }
      for (const id of referenced) {
        if (sharedOutside.has(id)) continue;
        const style = store.getStyle(id, sid);
        if (style !== undefined) {
          deleted.push({ id, style });
          store.setStyle(id, undefined, sid);
        }
      }
    }
    for (const [i, meta] of writes) {
      if (this.args.axis === 'col') store.setCol(i, meta as ColMeta | undefined, sid);
      else store.setRow(i, meta as RowMeta | undefined, sid);
    }
    this.snapshots = [{ from: this.args.from, to: this.args.to, metas: preMetas, styles: deleted, writtenIds: [] }];
  }

  public getUndo(): Command {
    return new RestoreAxisStyleCommand({
      axis: this.args.axis,
      snapshots: this.snapshots,
      ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}),
    });
  }
}

/**
 * Restore the state an axis write/clear replaced: the overwritten style
 * entries, the span's metas (exceptions restored verbatim, everything else in
 * the span drops its meta), and the style entries the write created. Like the
 * other range restore commands, re-undoing it repeats the same restore (the
 * command manager never walks this chain further).
 */
class RestoreAxisStyleCommand extends Command<AxisStyleSnapshotsArgs> {
  public override historyWeight(): number {
    return this.args.snapshots.reduce((n, s) => n + s.metas.length + s.styles.length, 0);
  }

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    for (const snap of this.args.snapshots) {
      // Entries first, so a restored meta never resolves against a half-state.
      for (const { id, style } of snap.styles) store.setStyle(id, style, sid);
      const restored = new Map(snap.metas.map((m) => [m.index, m.meta]));
      for (let i = snap.from; i <= snap.to; i += 1) {
        const meta = restored.get(i);
        if (this.args.axis === 'col') store.setCol(i, meta as ColMeta | undefined, sid);
        else store.setRow(i, meta as RowMeta | undefined, sid);
      }
      // Drop entries the write created unless something restored still uses them.
      const kept = new Set(snap.styles.map((s) => s.id));
      const referenced = new Set(snap.metas.map((m) => m.meta.styleId).filter((id) => id !== undefined));
      for (const id of snap.writtenIds) {
        if (kept.has(id) || referenced.has(id)) continue;
        store.setStyle(id, undefined, sid);
      }
    }
  }

  public getUndo(): Command {
    return this;
  }
}
