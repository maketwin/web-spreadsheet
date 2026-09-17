import { PrinterOutlined } from '@ant-design/icons';
import { Button, InputNumber, Modal, Radio, Select, Switch } from 'antd';
import { useEffect, useMemo, useState, type FC } from 'react';
import { printPages, renderPrintPages } from '../print/PrintPipeline';
import { DEFAULT_PRINT_SETTINGS, PAPER_MM, type MarginPreset, type Orientation, type PaperSize, type PrintSettings, type ScaleMode } from '../print/types';
import type { Store } from '../store/Store';

export interface PrintPreviewProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly store: Store;
}

const PAPER_OPTIONS: Array<{ readonly value: PaperSize; readonly label: string }> = [
  { value: 'A4', label: 'A4' },
  { value: 'Letter', label: 'Letter' },
  { value: 'A3', label: 'A3' },
];

const MARGIN_OPTIONS: Array<{ readonly value: MarginPreset; readonly label: string }> = [
  { value: 'narrow', label: '窄' },
  { value: 'normal', label: '常规' },
  { value: 'wide', label: '宽' },
];

/** Print preview: settings on the left, paginated page thumbnails on the right. */
export const PrintPreview: FC<PrintPreviewProps> = ({ open, onCancel, store }) => {
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  // Repainting every page synchronously per settings change (e.g. each digit
  // typed into the scale input) stalls the dialog on large sheets — debounce.
  const [renderSettings, setRenderSettings] = useState(settings);
  useEffect(() => {
    const timer = window.setTimeout(() => setRenderSettings(settings), 150);
    return () => window.clearTimeout(timer);
  }, [settings]);
  const result = useMemo(
    () => (open ? renderPrintPages(store, store.getActiveSheetId(), renderSettings) : null),
    [open, store, renderSettings],
  );
  const update = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]): void => {
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const totalPages = result?.geometry.pages.length ?? 0;
  const paperMm = PAPER_MM[settings.paper];

  const handlePrint = (): void => {
    if (result === null) return;
    printPages(result, settings);
    onCancel();
  };

  return <Modal
    title="打印预览"
    open={open}
    onCancel={onCancel}
    width={980}
    centered
    destroyOnHidden
    footer={[
      <Button key="cancel" onClick={onCancel}>取消</Button>,
      <Button key="print" type="primary" icon={<PrinterOutlined />} disabled={totalPages === 0} onClick={handlePrint}>打印</Button>,
    ]}
  >
    <div style={{ display: 'flex', gap: 16, minHeight: 420 }}>
      <div style={{ width: 230, flexShrink: 0, borderRight: '1px solid var(--ss-border)', paddingRight: 16 }}>
        <div className="ss-print-setting">
          <label htmlFor="ss-print-paper">纸张</label>
          <Select id="ss-print-paper" size="small" style={{ width: '100%' }} value={settings.paper} options={PAPER_OPTIONS} onChange={(paper) => update('paper', paper)} />
        </div>
        <div className="ss-print-setting">
          <label htmlFor="ss-print-orientation">方向</label>
          <Radio.Group id="ss-print-orientation" size="small" value={settings.orientation} onChange={(e) => update('orientation', e.target.value as Orientation)}>
            <Radio.Button value="portrait">纵向</Radio.Button>
            <Radio.Button value="landscape">横向</Radio.Button>
          </Radio.Group>
        </div>
        <div className="ss-print-setting">
          <label htmlFor="ss-print-margin">边距</label>
          <Select id="ss-print-margin" size="small" style={{ width: '100%' }} value={settings.margin} options={MARGIN_OPTIONS} onChange={(margin) => update('margin', margin)} />
        </div>
        <div className="ss-print-setting">
          <label>缩放</label>
          <Radio.Group size="small" value={settings.scaleMode} onChange={(e) => update('scaleMode', e.target.value as ScaleMode)}>
            <Radio.Button value="fitWidth">适合宽度</Radio.Button>
            <Radio.Button value="custom">自定义</Radio.Button>
          </Radio.Group>
        </div>
        {settings.scaleMode === 'custom' && (
          <div className="ss-print-setting">
            <label htmlFor="ss-print-scale">缩放比例</label>
            <InputNumber id="ss-print-scale" size="small" min={50} max={200} step={5} addonAfter="%" value={settings.scalePercent} onChange={(v) => update('scalePercent', clampPercent(v ?? 100))} />
          </div>
        )}
        <div className="ss-print-setting">
          <label htmlFor="ss-print-grid">网格线</label>
          <Switch id="ss-print-grid" size="small" checked={settings.showGrid} onChange={(showGrid) => update('showGrid', showGrid)} />
        </div>
        <div style={{ marginTop: 16, color: 'var(--ss-text-light)', fontSize: 12, lineHeight: '20px' }}>
          共 {totalPages} 页 · 打印比例 {Math.round((result?.geometry.scale ?? 1) * 100)}%<br />
          {settings.paper} {settings.orientation === 'portrait' ? `${paperMm.w}×${paperMm.h}` : `${paperMm.h}×${paperMm.w}`} mm · 仅当前工作表
        </div>
      </div>
      <div className="ss-print-pages" aria-label="打印页面预览">
        {result?.canvases.map((canvas, index) => (
          <figure key={index} className="ss-print-thumb">
            <div ref={(el) => { if (el !== null && el.firstElementChild !== canvas) el.replaceChildren(canvas); }} />
            <figcaption>第 {index + 1} 页，共 {totalPages} 页</figcaption>
          </figure>
        ))}
      </div>
    </div>
  </Modal>;
};

function clampPercent(value: number): number {
  return Math.min(200, Math.max(50, Math.round(value)));
}
