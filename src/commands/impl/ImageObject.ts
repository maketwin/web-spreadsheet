import { Command } from '../Command';
import type { Store } from '../../store/Store';
import type { ImageSpec } from '../../charts/types';

let imageCounter = 0;

export interface AddImageArgs {
  readonly spec: ImageSpec;
  readonly sheetId?: string;
}

/** Insert a floating image object (undoable — undo removes it). */
export class AddImageCommand extends Command<AddImageArgs> {
  public readonly imageId = `image-${++imageCounter}`;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    store.addImage({ ...this.args.spec, id: this.imageId }, sid);
  }

  public getUndo(): Command {
    return new RemoveImageCommand({ id: this.imageId, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

export interface RemoveImageArgs {
  readonly id: string;
  readonly sheetId?: string;
}

export class RemoveImageCommand extends Command<RemoveImageArgs> {
  private old: ImageSpec | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    this.old = store.getImages(sid).find((img) => img.id === this.args.id);
    if (this.old === undefined) return;
    store.removeImage(this.args.id, sid);
  }

  public override isNoOp(): boolean {
    return this.old === undefined;
  }

  public getUndo(): Command {
    return new AddImageCommand({ spec: this.old ?? { id: this.args.id, name: 'image', src: '', anchor: { from: { r: 0, c: 0, offX: 0, offY: 0 }, to: { r: 8, c: 4, offX: 0, offY: 0 } } }, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

export interface SetImageAnchorArgs {
  readonly id: string;
  readonly anchor: ImageSpec['anchor'];
  readonly sheetId?: string;
}

/** Commit a drag/resize gesture as one undoable anchor change. */
export class SetImageAnchorCommand extends Command<SetImageAnchorArgs> {
  private oldAnchor: ImageSpec['anchor'] | undefined;
  private oldSpec: ImageSpec | undefined;
  private execSheetId: string | undefined;

  public execute(store: Store): void {
    const sid = this.args.sheetId ?? this.execSheetId ?? store.getActiveSheetId();
    this.execSheetId = sid;
    const spec = store.getImages(sid).find((img) => img.id === this.args.id);
    if (spec === undefined) return;
    this.oldSpec = spec;
    this.oldAnchor = spec.anchor;
    if (sameAnchor(spec.anchor, this.args.anchor)) return;
    store.addImage({ ...spec, anchor: this.args.anchor }, sid);
  }

  public override isNoOp(): boolean {
    return this.oldSpec === undefined || sameAnchor(this.oldAnchor, this.args.anchor);
  }

  public getUndo(): Command {
    return new RestoreImageAnchor({ id: this.args.id, spec: this.oldSpec, ...(this.execSheetId !== undefined ? { sheetId: this.execSheetId } : {}) });
  }
}

class RestoreImageAnchor extends Command<{ id: string; spec: ImageSpec | undefined; sheetId?: string }> {
  public execute(store: Store): void {
    const sid = this.args.sheetId ?? store.getActiveSheetId();
    if (this.args.spec === undefined) return;
    store.addImage(this.args.spec, sid);
  }

  public getUndo(): Command {
    return new SetImageAnchorCommand({ id: this.args.id, anchor: this.args.spec?.anchor ?? { from: { r: 0, c: 0, offX: 0, offY: 0 }, to: { r: 8, c: 4, offX: 0, offY: 0 } }, ...(this.args.sheetId !== undefined ? { sheetId: this.args.sheetId } : {}) });
  }
}

function sameAnchor(a: ImageSpec['anchor'] | undefined, b: ImageSpec['anchor'] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.from.r === b.from.r && a.from.c === b.from.c && a.from.offX === b.from.offX && a.from.offY === b.from.offY
    && a.to.r === b.to.r && a.to.c === b.to.c && a.to.offX === b.to.offX && a.to.offY === b.to.offY;
}
