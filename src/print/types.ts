/** Print settings and paper presets (CSS px at 96dpi; 1in = 96px, 1mm = 96/25.4px). */

export type PaperSize = 'A4' | 'Letter' | 'A3';
export type Orientation = 'portrait' | 'landscape';
export type MarginPreset = 'narrow' | 'normal' | 'wide';

/** fitWidth scales the used range so every used column lands on one page width. */
export type ScaleMode = 'fitWidth' | 'custom';

export interface PrintSettings {
  readonly paper: PaperSize;
  readonly orientation: Orientation;
  readonly margin: MarginPreset;
  readonly scaleMode: ScaleMode;
  /** Percent (50–200), used when scaleMode is 'custom'. */
  readonly scalePercent: number;
  readonly showGrid: boolean;
  /** Print area range ("A1:F20"); empty = whole used range. */
  readonly printArea?: string;
  /** Header/footer text; supports {page}, {pages} and {sheet} placeholders. Empty = none. */
  readonly headerText?: string;
  readonly footerText?: string;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: 'A4',
  orientation: 'portrait',
  margin: 'normal',
  scaleMode: 'fitWidth',
  scalePercent: 100,
  showGrid: true,
};

/** Band heights (CSS px) reserved at the top/bottom of the content area for
 * header/footer text. Zero when the respective text is empty. */
export function headerBandPx(settings: PrintSettings): number {
  return settings.headerText !== undefined && settings.headerText !== '' ? 26 : 0;
}

export function footerBandPx(settings: PrintSettings): number {
  return settings.footerText !== undefined && settings.footerText !== '' ? 26 : 0;
}

/** Expand {page}/{pages}/{sheet} placeholders in header/footer text. */
export function formatHeaderText(
  text: string,
  info: { readonly page: number; readonly pages: number; readonly sheet?: string | undefined },
): string {
  return text
    .replaceAll('{page}', String(info.page))
    .replaceAll('{pages}', String(info.pages))
    .replaceAll('{sheet}', info.sheet ?? '');
}

/** Paper dimensions in mm (portrait). */
export const PAPER_MM: Readonly<Record<PaperSize, { readonly w: number; readonly h: number }>> = {
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
  A3: { w: 297, h: 420 },
};

/** Uniform margins in mm (Excel presets: 0.25in / 0.75in / 1in). */
export const MARGIN_MM: Readonly<Record<MarginPreset, number>> = {
  narrow: 6.35,
  normal: 19.05,
  wide: 25.4,
};

const MM_TO_PX = 96 / 25.4;

/** CSS-pixel size of the full paper sheet for the given settings. */
export function paperPx(settings: PrintSettings): { readonly w: number; readonly h: number } {
  const mm = PAPER_MM[settings.paper];
  const portrait = { w: mm.w * MM_TO_PX, h: mm.h * MM_TO_PX };
  return settings.orientation === 'portrait' ? portrait : { w: portrait.h, h: portrait.w };
}

/** CSS-pixel size of the printable content area (paper minus margins). */
export function contentPx(settings: PrintSettings): { readonly w: number; readonly h: number } {
  const paper = paperPx(settings);
  const margin = MARGIN_MM[settings.margin] * MM_TO_PX;
  return { w: paper.w - margin * 2, h: paper.h - margin * 2 };
}

/** Margin in CSS px. */
export function marginPx(settings: PrintSettings): number {
  return MARGIN_MM[settings.margin] * MM_TO_PX;
}

/** Bitmap pixels per CSS px for rendered print pages (192dpi effective). */
export const PRINT_DPI_SCALE = 2;
