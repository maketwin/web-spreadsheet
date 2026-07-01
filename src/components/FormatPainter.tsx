import { Button, Tooltip } from 'antd';
import { FormatPainterOutlined } from '@ant-design/icons';
import { useCallback, useState, type FC } from 'react';
import type { Store } from '../store/Store';
import type { Style } from '../types';
import type { CellAddress } from '../renderer/CanvasRenderer';

export interface FormatPainterProps {
  readonly store: Store;
  readonly activeStyle: Style | undefined;
  readonly onApplyStyle: (target: CellAddress, style: Partial<Style>) => void;
}

export const FormatPainter: FC<FormatPainterProps> = ({ store, activeStyle, onApplyStyle }) => {
  const [painting, setPainting] = useState(false);
  const [sourceStyle, setSourceStyle] = useState<Style | undefined>(undefined);

  const togglePaint = useCallback(() => {
    if (painting) {
      setPainting(false);
      setSourceStyle(undefined);
    } else {
      setSourceStyle(activeStyle);
      setPainting(true);
    }
  }, [painting, activeStyle]);

  void store;
  void sourceStyle;
  void onApplyStyle;

  return (
    <Tooltip title={painting ? '退出格式刷' : '格式刷'}>
      <Button
        size="small"
        type={painting ? 'primary' : 'default'}
        icon={<FormatPainterOutlined />}
        aria-label="Format painter"
        onClick={togglePaint}
      />
    </Tooltip>
  );
};

/** Hook to manage format painter state outside the component. */
export function useFormatPainter(): {
  readonly painting: boolean;
  readonly sourceStyle: Style | undefined;
  readonly startPaint: (style: Style | undefined) => void;
  readonly stopPaint: () => void;
  readonly applyIfPainting: (target: CellAddress, applyStyle: (style: Partial<Style>) => void) => boolean;
} {
  const [painting, setPainting] = useState(false);
  const [sourceStyle, setSourceStyle] = useState<Style | undefined>(undefined);

  const startPaint = useCallback((style: Style | undefined) => {
    setSourceStyle(style);
    setPainting(true);
  }, []);

  const stopPaint = useCallback(() => {
    setPainting(false);
    setSourceStyle(undefined);
  }, []);

  const applyIfPainting = useCallback((target: CellAddress, applyStyle: (style: Partial<Style>) => void): boolean => {
    if (!painting || sourceStyle === undefined) return false;
    void target;
    applyStyle(sourceStyle);
    setPainting(false);
    setSourceStyle(undefined);
    return true;
  }, [painting, sourceStyle]);

  return { painting, sourceStyle, startPaint, stopPaint, applyIfPainting };
}
