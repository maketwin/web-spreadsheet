import { cellId, formulaText } from '../util/cell';
import type { Cell } from '../types';
import type { FormulaEngine } from './FormulaEngine';
import type { Store } from '../store/Store';

/**
 * Keep the formula engine in sync with cell events. While a store batch is
 * flushing (e.g. a sort moved many cells), only registrations update; the
 * dependent-recalculation cascades are deferred until the batch ends so a
 * stale pre-move registration can never overwrite a relocated cell.
 */
export function createFormulaSync(store: Store, engine: FormulaEngine): { readonly unsubscribe: () => void } {
  let syncing = false;
  /** The flushing batch replaced the whole workbook: rebuild from the final state. */
  let replaced = false;
  interface DeferredCell { readonly r: number; readonly c: number; readonly sheetId: string | undefined }
  const deferred = new Map<string, DeferredCell>();
  const unsubscribe = store.subscribe((event) => {
    if (event.type === 'workbook' && event.action === 'replace') {
      // New / open / restore: drop every registration now. The cells the new
      // workbook lacks emit no event, so patching would leave their old
      // formulas behind — an empty cell "recalculating" to a stale value.
      engine.reset();
      deferred.clear();
      replaced = true;
      return;
    }
    // Deleted sheets take their formulas/dependency edges/spill bookkeeping with
    // them — nothing else tells the engine, and stale entries leak the maps.
    if (event.type === 'sheet' && event.action === 'delete') {
      engine.onSheetDeleted(event.sheetId);
      return;
    }
    // A named range moved: formulas resolve names when they register, so the
    // ones it touches have to register again.
    if (event.type === 'style' && event.id.startsWith('nr:')) {
      engine.onNamedRangeChanged();
      return;
    }
    // The engine's own result writes are not edits: echoing them would
    // re-register and re-evaluate cells it has just brought up to date.
    if (event.type !== 'cell' || syncing || engine.isSelfWrite(event.sheetId, event.r, event.c)) return;
    syncing = true;
    try {
      const sheetId = event.sheetId;
      const id = cellId(event.r, event.c);
      if (store.isFlushing()) {
        // Mid-batch states are transient (e.g. rows half-moved by a sort):
        // defer all engine work to batch end so formulas never register
        // against stale edges (false circular refs / clobbered values).
        deferred.set(`${sheetId ?? ''}:${id}`, { r: event.r, c: event.c, sheetId });
      } else {
        engine.coalesce(() => {
          syncCellFormula(engine, event.r, event.c, event.cell, sheetId);
          engine.onCellChanged(id, sheetId);
        });
      }
    } finally {
      syncing = false;
    }
  });
  const offBatchEnd = store.onBatchEnd(() => {
    if (replaced) {
      replaced = false;
      syncing = true;
      try {
        engine.reloadFromStore();
      } finally {
        syncing = false;
      }
      return;
    }
    if (deferred.size === 0) return;
    syncing = true;
    try {
      const entries = [...deferred.values()];
      deferred.clear();
      // Read the final cell state, not the per-event snapshot.
      const current = entries.map((e) => ({ ...e, cell: store.getCell(e.r, e.c, e.sheetId) }));
      // One coalesced pass, so the moved cells recalculate as a whole.
      engine.coalesce(() => {
        // Removals before registrations: a formula that moved cells must drop its
        // old graph edges before the new position registers, or the stale edge
        // makes the new registration look circular.
        for (const e of current) {
          if (formulaText(e.cell) === undefined) engine.removeFormula(cellId(e.r, e.c), e.sheetId);
        }
        for (const e of current) {
          const formula = formulaText(e.cell);
          if (formula !== undefined) engine.setFormula(cellId(e.r, e.c), formula, [], e.sheetId);
        }
        for (const e of current) engine.onCellChanged(cellId(e.r, e.c), e.sheetId);
      });
    } finally {
      syncing = false;
    }
  });
  // Align with whatever the store already holds: a restore from storage that
  // beat the first render emitted its events before anyone listened.
  engine.reloadFromStore();
  return { unsubscribe: () => { unsubscribe(); offBatchEnd(); } };
}

function syncCellFormula(engine: FormulaEngine, r: number, c: number, cell: Cell | undefined, sheetId?: string): void { const formula = formulaText(cell); const id = cellId(r, c); if (formula === undefined) engine.removeFormula(id, sheetId); else engine.setFormula(id, formula, [], sheetId); }
