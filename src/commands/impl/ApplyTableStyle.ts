import { Command } from '../Command';
import { styleIdForCell } from './styleIdentity';
import type { Store } from '../../store/Store';
import type { Cell, Style } from '../../types';

export type TableStylePreset = 'blue' | 'green' | 'orange' | 'gray';

export const TABLE_PRESETS: Readonly<Record<TableStylePreset, { readonly headerBg: string; readonly band: string }>> = {
  blue: { headerBg: '#2F5597', band: '#D9E7F5' },
  green: { headerBg: '#548235', band: '#E2EFDA' },
  orange: { headerBg: '#C55A11', band: '#FCE4D6' },
  gray: { headerBg: '#595959', band: '#F2F2F2' },
};

export interface ApplyTableStyleArgs {
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
  readonly preset: TableStylePreset;
  readonly sheetId?: string;
}

interface Snapshot {
  readonly r: number;
  readonly c: number;
  readonly cell: Cell | undefined;
  readonly style: Style | undefined;
  readonly styleId: string | undefined;
}

/** Excel "套用表格格式": header row gets a dark fill with white bold text, body
 * rows alternate the band color. One undoable command for the whole range.
 * Styles are inlined via styleIdForCell/setStyle (same semantics as
 * SetCellStyleCommand). */
export class ApplyTableStyleCommand extends Command<ApplyTableStyleArgs> {
  private snapshots: Snapshot[] = [];
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    this.snapshots = [];
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const preset = TABLE_PRESETS[this.args.preset];
    if (preset === undefined) return;
    for (let r = this.args.r1; r <= this.args.r2; r += 1) {
      for (let c = this.args.c1; c <= this.args.c2; c += 1) {
        this.snapshots.push(this.capture(store, r, c, sid));
        const style: Partial<Style> = r === this.args.r1
          ? { bgcolor: preset.headerBg, color: '#FFFFFF', bold: true }
          : ((r - this.args.r1) % 2 === 0 ? { bgcolor: preset.band } : {});
        const oldCell = store.getCell(r, c, sid);
        const oldStyle = oldCell?.styleId === undefined ? undefined : store.getStyle(oldCell.styleId, sid);
        const nextStyle = { ...oldStyle, ...style };
        const styleId = styleIdForCell(store, r, c, sid, oldCell?.styleId);
        store.setStyle(styleId, nextStyle, sid);
        store.setCell(r, c, { ...oldCell, text: oldCell?.text ?? '', styleId }, sid);
      }
    }
  }

  private capture(store: Store, r: number, c: number, target: string): Snapshot {
    const cell = store.getCell(r, c, target);
    const style = cell?.styleId === undefined ? undefined : store.getStyle(cell.styleId, target);
    return { r, c, cell, style, styleId: cell?.styleId };
  }

  public getUndo(): Command {
    return new RestoreTableStyle({ snapshots: this.snapshots, args: this.args, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

class RestoreTableStyle extends Command<{ snapshots: readonly Snapshot[]; args: ApplyTableStyleArgs; sheetId?: string }> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    for (const snap of this.args.snapshots) {
      if (snap.cell === undefined) {
        store.setCell(snap.r, snap.c, undefined, sid);
        continue;
      }
      const restored: Cell = { ...snap.cell };
      if (snap.styleId !== undefined) restored.styleId = snap.styleId;
      else delete restored.styleId;
      store.setCell(snap.r, snap.c, restored, sid);
      if (snap.styleId !== undefined && snap.style !== undefined) store.setStyle(snap.styleId, snap.style, sid);
    }
  }

  public getUndo(): Command {
    return new ApplyTableStyleCommand({ ...this.args.args, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}
