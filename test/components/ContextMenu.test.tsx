import { describe, it, expect } from 'vitest';
import { isHeaderRightClick } from '../../src/components/ContextMenu';

describe('ContextMenu', () => {
  it('detects row header right-click', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
    // localX=30<46 and localY=50>=25 → row header; row = floor((50-25)/25) = 1
    const result = isHeaderRightClick(canvas, 30, 50, 0, 0, 100);
    expect(result).not.toBeNull();
    if (result !== null && result.type === 'row') {
      expect(result.r).toBe(1);
    }
  });

  it('detects column header right-click', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
    // localY=10<25 and localX=100>=46 → col header; col = floor((100-46)/100) = 0
    const result = isHeaderRightClick(canvas, 100, 10, 0, 0, 100);
    expect(result).not.toBeNull();
    if (result !== null && result.type === 'column') {
      expect(result.c).toBe(0);
    }
  });
});
