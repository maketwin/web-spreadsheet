import { cellId, formulaText } from '../util/cell';
import { TOTAL_COLS } from '../util/gridSize';
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
    // Any other sheet change (add / rename / copy / move) invalidates the
    // engine's sheet name/id caches.
    if (event.type === 'sheet') {
      if (event.action === 'delete') engine.onSheetDeleted(event.sheetId);
      else engine.onSheetsChanged();
      return;
    }
    // A named range moved: formulas resolve names when they register, so the
    // ones it touches have to register again.
    if (event.type === 'namedRanges') {
      engine.onNamedRangeChanged();
      return;
    }
    // A structural insert/delete: the store holds the FINAL state already (the
    // command body ran to completion before the batch flushed). Formulas on
    // the moved half-plane remount at their new coordinates right here, and
    // readers of the half-plane are queued and drained — no per-cell replay.
    if (event.type === 'structure') {
      if (replaced || syncing) return;
      engine.onStructureShift(event.sheetId ?? store.getActiveSheetId(), event.axis, event.kind, event.start, event.count);
      return;
    }
    // A batch of rewritten cells (a sparse clear, or the undo putting a
    // deleted band back): same handling as per-cell events, once per batch —
    // up to a point. A batch this side of the threshold is answered per key;
    // a bigger one (a cleared million-cell column) would cost one deferred
    // entry per cell, so the engine is handed the batch's bounding rectangle
    // and does work proportional to the formulas that live in or read it.
    if (event.type === 'cells') {
      if (replaced || syncing) return;
      syncing = true;
      try {
        const sheetId = event.sheetId;
        if (event.keys.length > PER_KEY_CELLS_LIMIT) {
          engine.onCellsReplaced(sheetId ?? store.getActiveSheetId(), boundsOfKeys(event.keys));
          return;
        }
        const decode = (key: number): { r: number; c: number } => {
          const r = Math.floor(key / TOTAL_COLS);
          return { r, c: key - r * TOTAL_COLS };
        };
        if (store.isFlushing()) {
          for (const key of event.keys) {
            const { r, c } = decode(key);
            deferred.set(`${sheetId ?? ''}:${cellId(r, c)}`, { r, c, sheetId });
          }
        } else {
          engine.coalesce(() => {
            for (const key of event.keys) {
              const { r, c } = decode(key);
              syncCellFormula(engine, r, c, store.getCell(r, c, sheetId), sheetId);
              engine.onCellChanged(cellId(r, c), sheetId);
            }
          });
        }
      } finally {
        syncing = false;
      }
      return;
    }
    // The engine's own result writes are not edits: echoing them would
    // re-register and re-evaluate cells it has just brought up to date.
    // While `replaced`, the batch-end reload rebuilds every registration from
    // the final state — per-cell events of the swapped-out workbook (or of the
    // same flush) would only accumulate into `deferred` to be thrown away.
    if (event.type !== 'cell' || replaced || syncing || engine.isSelfWrite(event.sheetId, event.r, event.c)) return;
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

/** Up to this many rewritten cells are answered per key; beyond it by the batch's bounding rectangle (see the `cells` handler). */
const PER_KEY_CELLS_LIMIT = 256;

/** The smallest rectangle around `keys` (`r * TOTAL_COLS + c` each). */
function boundsOfKeys(keys: readonly number[]): { r1: number; c1: number; r2: number; c2: number } {
  let r1 = Number.POSITIVE_INFINITY;
  let c1 = Number.POSITIVE_INFINITY;
  let r2 = 0;
  let c2 = 0;
  for (const key of keys) {
    const r = Math.floor(key / TOTAL_COLS);
    const c = key - r * TOTAL_COLS;
    if (r < r1) r1 = r;
    if (c < c1) c1 = c;
    if (r > r2) r2 = r;
    if (c > c2) c2 = c;
  }
  return { r1, c1, r2, c2 };
}
