/** Excel-style cell border resolution and painting.
 *
 * Borders are stored per-cell (top/bottom/left/right), but painted in *logical edge*
 * space so a shared edge is drawn exactly once — never missing, never doubled.
 *
 * Logical keys:
 *   h|{rowBound}|{col}  — horizontal edge above cell (rowBound, col)
 *                        (= bottom of rowBound-1 / top of rowBound)
 *   v|{colBound}|{row}  — vertical edge left of cell (row, colBound)
 *                        (= right of colBound-1 / left of colBound)
 */

export type BorderLineStyle = 'solid' | 'dashed' | 'dotted' | 'thick' | 'none';

export interface CellBorderSides {
  readonly top?: string;
  readonly bottom?: string;
  readonly left?: string;
  readonly right?: string;
}

export interface LogicalBorderEdge {
  readonly key: string;
  readonly orient: 'h' | 'v';
  /** For h: rowBound; for v: colBound */
  readonly bound: number;
  /** For h: col index; for v: row index */
  readonly along: number;
  readonly line: BorderLineStyle;
}

export interface BorderPaintSeg {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly line: BorderLineStyle;
}

/** Excel conflict: explicit none wins, then thicker lines. */
export function borderStrength(line: string): number {
  switch (line) {
    case 'none': return 4;
    case 'thick': return 3;
    case 'solid': return 2;
    case 'dashed': return 1;
    case 'dotted': return 1;
    default: return 0;
  }
}

export function normalizeBorderLine(line: string | undefined): BorderLineStyle | undefined {
  if (line === undefined) return undefined;
  if (line === 'solid' || line === 'dashed' || line === 'dotted' || line === 'thick' || line === 'none') return line;
  return 'solid';
}

/** Put one side into the edge map with Excel conflict resolution. */
export function putBorderEdge(
  edges: Map<string, LogicalBorderEdge>,
  orient: 'h' | 'v',
  bound: number,
  along: number,
  line: string | undefined,
): void {
  const normalized = normalizeBorderLine(line);
  if (normalized === undefined) return;
  const key = `${orient}|${bound}|${along}`;
  const next: LogicalBorderEdge = { key, orient, bound, along, line: normalized };
  const prev = edges.get(key);
  if (prev === undefined || borderStrength(next.line) >= borderStrength(prev.line)) edges.set(key, next);
}

/** Collect borders from one cell into logical edge space. */
export function collectCellBorderEdges(
  edges: Map<string, LogicalBorderEdge>,
  r: number,
  c: number,
  border: CellBorderSides | undefined,
): void {
  if (border === undefined) return;
  putBorderEdge(edges, 'h', r, c, border.top);
  putBorderEdge(edges, 'h', r + 1, c, border.bottom);
  putBorderEdge(edges, 'v', c, r, border.left);
  putBorderEdge(edges, 'v', c + 1, r, border.right);
}

export function hasBorderOnEdge(edges: Map<string, LogicalBorderEdge>, orient: 'h' | 'v', bound: number, along: number): boolean {
  const edge = edges.get(`${orient}|${bound}|${along}`);
  return edge !== undefined && edge.line !== 'none';
}

export interface EdgeGeometry {
  /** Pixel origin of grid (ROW_HEADER_WIDTH / COL_HEADER_HEIGHT in viewport). */
  readonly originX: number;
  readonly originY: number;
  readonly colLeft: (c: number) => number; // viewport x of left edge of col c
  readonly rowTop: (r: number) => number; // viewport y of top edge of row r
  readonly colWidth: (c: number) => number;
  readonly rowHeight: (r: number) => number;
}

/** Convert resolved logical edges to stroke segments in viewport pixels. */
export function edgesToPaintSegs(edges: Iterable<LogicalBorderEdge>, geo: EdgeGeometry): BorderPaintSeg[] {
  const segs: BorderPaintSeg[] = [];
  for (const edge of edges) {
    if (edge.line === 'none') continue;
    if (edge.orient === 'h') {
      const y = geo.rowTop(edge.bound);
      const x1 = geo.colLeft(edge.along);
      const x2 = x1 + geo.colWidth(edge.along);
      segs.push({ x1, y1: y, x2, y2: y, line: edge.line });
    } else {
      const x = geo.colLeft(edge.bound);
      const y1 = geo.rowTop(edge.along);
      const y2 = y1 + geo.rowHeight(edge.along);
      segs.push({ x1: x, y1, x2: x, y2, line: edge.line });
    }
  }
  return segs;
}

/** Stroke paint segments like Excel Automatic borders. */
export function strokeBorderSegs(
  ctx: CanvasRenderingContext2D,
  segs: readonly BorderPaintSeg[],
  zoom: number,
  clip: { x: number; y: number; w: number; h: number },
): void {
  if (segs.length === 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  ctx.strokeStyle = '#000000';
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const seg of segs) {
    const width = Math.max(1, Math.round((seg.line === 'thick' ? 3 : 1) * zoom));
    ctx.lineWidth = width;
    if (seg.line === 'dashed') ctx.setLineDash([Math.max(2, Math.round(4 * zoom)), Math.max(1, Math.round(2 * zoom))]);
    else if (seg.line === 'dotted') ctx.setLineDash([Math.max(1, Math.round(zoom)), Math.max(1, Math.round(zoom))]);
    else ctx.setLineDash([]);
    const offset = width % 2 === 1 ? 0.5 : 0;
    ctx.beginPath();
    if (seg.y1 === seg.y2) {
      const ly = Math.round(seg.y1) + offset;
      ctx.moveTo(Math.round(seg.x1), ly);
      ctx.lineTo(Math.round(seg.x2), ly);
    } else {
      const lx = Math.round(seg.x1) + offset;
      ctx.moveTo(lx, Math.round(seg.y1));
      ctx.lineTo(lx, Math.round(seg.y2));
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}
