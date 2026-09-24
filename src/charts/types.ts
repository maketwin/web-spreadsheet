/** Supported chart types. */
export type ChartType = 'bar' | 'line' | 'pie';

/** Excel default new-chart size: 15cm × 7.5cm ≈ 567 × 284 px at 96 dpi. */
export const CHART_DEFAULT_W = 480;
export const CHART_DEFAULT_H = 240;
/** Drag/resize floor so an object can never collapse to nothing. */
export const CHART_MIN_W = 60;
export const CHART_MIN_H = 40;

/**
 * One end of a floating object's two-cell anchor (Excel DrawingML model):
 * the cell the edge sits in plus a pixel offset inside that cell, measured
 * in unscaled content px (zoom-independent).
 */
export interface ChartAnchorEdge {
  readonly r: number;
  readonly c: number;
  readonly offX: number;
  readonly offY: number;
}

/**
 * Two-cell anchor: the chart spans from `from` to `to`. With the Excel
 * default "move and size with cells" placement, inserting/resizing rows or
 * columns stretches the object because both edges stay glued to their cells.
 */
export interface ChartAnchor {
  readonly from: ChartAnchorEdge;
  readonly to: ChartAnchorEdge;
}

/** Specification for a chart embedded in the sheet. */
export interface ChartSpec {
  readonly id: string;
  readonly type: ChartType;
  readonly range: string;
  readonly title?: string | undefined;
  readonly sheetId?: string | undefined;
  /** Floating-object geometry. Legacy panel-era specs may omit it; the UI normalizes on render. */
  readonly anchor?: ChartAnchor | undefined;
}

/** Floating image object (data-URL based; lives per sheet like charts). */
export interface ImageSpec {
  readonly id: string;
  readonly name: string;
  /** Image source as a data URL (persisted with the workbook autosave). */
  readonly src: string;
  readonly anchor: ChartAnchor;
  readonly sheetId?: string | undefined;
}
