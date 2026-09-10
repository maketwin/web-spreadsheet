import { describe, expect, it } from 'vitest';
import {
  collectCellBorderEdges,
  edgesToPaintSegs,
  hasBorderOnEdge,
  putBorderEdge,
  type LogicalBorderEdge,
} from '../../src/renderer/BorderPainter';

describe('BorderPainter', () => {
  it('dedupes a shared edge from two neighbors to one logical key', () => {
    const edges = new Map<string, LogicalBorderEdge>();
    collectCellBorderEdges(edges, 0, 0, { right: 'solid' });
    collectCellBorderEdges(edges, 0, 1, { left: 'thick' });
    expect(edges.size).toBe(1);
    expect(edges.get('v|1|0')?.line).toBe('thick');
  });

  it('explicit none wins over solid on the same edge', () => {
    const edges = new Map<string, LogicalBorderEdge>();
    putBorderEdge(edges, 'h', 1, 0, 'solid');
    putBorderEdge(edges, 'h', 1, 0, 'none');
    expect(hasBorderOnEdge(edges, 'h', 1, 0)).toBe(false);
    expect(edges.get('h|1|0')?.line).toBe('none');
  });

  it('all-borders on 2x2 yields 12 unique edges (no extras)', () => {
    const edges = new Map<string, LogicalBorderEdge>();
    for (const r of [0, 1]) for (const c of [0, 1]) {
      collectCellBorderEdges(edges, r, c, { top: 'solid', bottom: 'solid', left: 'solid', right: 'solid' });
    }
    // 2x2 cells: 3 horizontal lines * 2 cols + 3 vertical lines * 2 rows = 12
    expect([...edges.values()].filter((e) => e.line !== 'none')).toHaveLength(12);
  });

  it('maps logical edges to pixel segments without duplication', () => {
    const edges = new Map<string, LogicalBorderEdge>();
    collectCellBorderEdges(edges, 0, 0, { top: 'solid', left: 'solid' });
    const segs = edgesToPaintSegs(edges.values(), {
      originX: 46,
      originY: 20,
      colLeft: (c) => 46 + c * 64,
      rowTop: (r) => 20 + r * 20,
      colWidth: () => 64,
      rowHeight: () => 20,
    });
    expect(segs).toHaveLength(2);
    expect(segs).toContainEqual({ x1: 46, y1: 20, x2: 110, y2: 20, line: 'solid' });
    expect(segs).toContainEqual({ x1: 46, y1: 20, x2: 46, y2: 40, line: 'solid' });
  });
});
