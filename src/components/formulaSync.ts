import { useEffect } from 'react';
import { cellId, formulaDependencies, formulaText } from '../util/cell';
import type { Cell } from '../types';
import type { FormulaEngine } from '../formula/FormulaEngine';
import type { Store } from '../store/Store';

export function useFormulaSync(store: Store, formulaEngine: FormulaEngine | undefined): void { useEffect(() => { if (formulaEngine === undefined) return undefined; return createFormulaSync(store, formulaEngine).unsubscribe; }, [store, formulaEngine]); }

/**
 * Keep the formula engine in sync with cell events. While a store batch is
 * flushing (e.g. a sort moved many cells), only registrations update; the
 * dependent-recalculation cascades are deferred until the batch ends so a
 * stale pre-move registration can never overwrite a relocated cell.
 */
export function createFormulaSync(store: Store, engine: FormulaEngine): { readonly unsubscribe: () => void } {
  let syncing = false;
  interface DeferredCell { readonly r: number; readonly c: number; readonly sheetId: string | undefined }
  const deferred = new Map<string, DeferredCell>();
  const unsubscribe = store.subscribe((event) => {
    if (event.type !== 'cell' || syncing) return;
    syncing = true;
    const sheetId = event.sheetId;
    const id = cellId(event.r, event.c);
    if (store.isFlushing()) {
      // Mid-batch states are transient (e.g. rows half-moved by a sort):
      // defer all engine work to batch end so formulas never register
      // against stale edges (false circular refs / clobbered values).
      deferred.set(`${sheetId ?? ''}:${id}`, { r: event.r, c: event.c, sheetId });
    } else {
      syncCellFormula(engine, event.r, event.c, event.cell, sheetId);
      engine.onCellChanged(id, sheetId);
    }
    syncing = false;
  });
  const offBatchEnd = store.onBatchEnd(() => {
    if (deferred.size === 0) return;
    syncing = true;
    const entries = [...deferred.values()];
    deferred.clear();
    // Read the final cell state, not the per-event snapshot.
    const current = entries.map((e) => ({ ...e, cell: store.getCell(e.r, e.c, e.sheetId) }));
    // Removals before registrations: a formula that moved cells must drop its
    // old graph edges before the new position registers, or the stale edge
    // makes the new registration look circular.
    for (const e of current) {
      if (formulaText(e.cell) === undefined) engine.removeFormula(cellId(e.r, e.c), e.sheetId);
    }
    for (const e of current) {
      const formula = formulaText(e.cell);
      if (formula !== undefined) engine.setFormula(cellId(e.r, e.c), formula, formulaDependencies(formula), e.sheetId);
    }
    for (const e of current) engine.onCellChanged(cellId(e.r, e.c), e.sheetId);
    syncing = false;
  });
  return { unsubscribe: () => { unsubscribe(); offBatchEnd(); } };
}

function syncCellFormula(engine: FormulaEngine, r: number, c: number, cell: Cell | undefined, sheetId?: string): void { const formula = formulaText(cell); const id = cellId(r, c); if (formula === undefined) engine.removeFormula(id, sheetId); else engine.setFormula(id, formula, formulaDependencies(formula), sheetId); }
