import { describe, expect, it, vi } from 'vitest';
import { paintDataBar, paintIconSetIcon } from '../../src/renderer/ConditionalPainter';

function makeCtx() {
  return {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), arc: vi.fn(), fillRect: vi.fn(),
    fillStyle: '', globalAlpha: 1,
  };
}

describe('ConditionalPainter', () => {
  it('paintDataBar draws a translucent bar proportional to the ratio', () => {
    const ctx = makeCtx();
    paintDataBar(ctx as unknown as CanvasRenderingContext2D, 100, 200, 82, 20, 0.5, '#ff0000');
    expect(ctx.fillRect).toHaveBeenCalledWith(101, 201, 40, 18); // (82-2)*0.5
    expect(ctx.globalAlpha).toBe(1); // restored
    expect(ctx.fillStyle).toBe('#ff0000');
  });

  it('paintDataBar clamps negative ratios to zero width', () => {
    const ctx = makeCtx();
    paintDataBar(ctx as unknown as CanvasRenderingContext2D, 0, 0, 50, 20, -1, '#000');
    expect(ctx.fillRect).toHaveBeenCalledWith(1, 1, 0, 18);
  });

  it('paintIconSetIcon lights3 draws a circle, arrows3 draws a triangle', () => {
    const lights = makeCtx();
    paintIconSetIcon(lights as unknown as CanvasRenderingContext2D, 10, 20, 20, 'lights3', 0);
    expect(lights.arc).toHaveBeenCalledTimes(1);
    expect(lights.fill).toHaveBeenCalledTimes(1);
    const arrows = makeCtx();
    paintIconSetIcon(arrows as unknown as CanvasRenderingContext2D, 10, 20, 20, 'arrows3', 0);
    expect(arrows.arc).not.toHaveBeenCalled();
    expect(arrows.moveTo).toHaveBeenCalledTimes(1);
    expect(arrows.lineTo).toHaveBeenCalledTimes(2);
    expect(arrows.fill).toHaveBeenCalledTimes(1);
  });

  it('paintIconSetIcon draws nothing when the row is too short', () => {
    const ctx = makeCtx();
    paintIconSetIcon(ctx as unknown as CanvasRenderingContext2D, 10, 20, 8, 'arrows3', 1);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });
});
