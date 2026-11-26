import { formatValue } from './NumberFormatter';
import type { Cell, Style } from '../types';

/**
 * The value a cell shows on screen: number-formatted text when a
 * non-general numberFormat applies, otherwise the raw text. Excel's filter
 * UI operates on this display value, not the underlying input.
 */
export function displayTextOf(cell: Cell | undefined, style: Style | undefined): string {
  if (cell === undefined) return '';
  const nf = style?.numberFormat;
  if (nf !== undefined && nf !== 'general') {
    const result = formatValue(cell.value, nf);
    if (result.formatted) return result.text;
  }
  return cell.text;
}
