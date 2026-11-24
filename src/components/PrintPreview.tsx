import { PrinterOutlined, FilePdfOutlined } from '@ant-design/icons';
import { Button, Input, InputNumber, Modal, Radio, Select, Switch, Tooltip } from 'antd';
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { planWorkbookPrintPages, printPages, renderWorkbookPrintPagesAsync, type WorkbookPrintPage, type PrintScope } from '../print/PrintPipeline';
import { DEFAULT_PRINT_SETTINGS, PAPER_MM, type MarginPreset, type Orientation, type PaperSize, type PrintSettings, type ScaleMode } from '../print/types';
import { exportPagesToPdf } from '../io/pdfExport';
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

/** Print preview: settings on the left, paginated page thumbnails on the right.
 * Pages render progressively (one paint + PNG encode per frame, cancelable) so
 * a big workbook never blocks the dialog on the main thread. */
export const PrintPreview: FC<PrintPreviewProps> = ({ open, onCancel, store }) => {
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [scope, setScope] = useState<PrintScope>('active');
  // Repainting every page per settings change (e.g. each digit typed into the
  // scale input) stalls the dialog on large sheets — debounce.
  const [renderSettings, setRenderSettings] = useState(settings);
  useEffect(() => {
    const timer = window.setTimeout(() => setRenderSettings(settings), 150);
    return () => window.clearTimeout(timer);
  }, [settings]);
  // Cheap pagination pass: totals/scale/sheet-count are known before painting.
  const plan = useMemo(
    () => (open ? planWorkbookPrintPages(store, renderSettings, scope) : null),
    [open, store, renderSettings, scope],
  );
  // Pages painted so far (thumbnails appear one by one as rendering progresses).
  const [pages, setPages] = useState<readonly WorkbookPrintPage[]>([]);
  // Incrementing token: results from superseded renders (settings changed,
  // dialog closed) are dropped instead of clobbering the current run.
  const renderTokenRef = useRef(0);
  useEffect(() => {
    if (!open) {
      setPages([]);
      return undefined;
    }
    const token = renderTokenRef.current + 1;
    renderTokenRef.current = token;
    const controller = new AbortController();
    setPages([]);
    void renderWorkbookPrintPagesAsync(
      store,
      renderSettings,
      scope,
      (p) => {
        if (renderTokenRef.current !== token) return;
        setPages((current) => [...current, { canvas: p.canvas, dataUrl: p.dataUrl }]);
      },
      controller.signal,
    )
      .then((result) => {
        if (renderTokenRef.current !== token) return;
        setPages(result.pages);
      })
      .catch(() => {
        // Aborted (settings changed / dialog closed): the newer run owns state.
        if (renderTokenRef.current !== token) return;
        setPages([]);
      });
    return () => controller.abort();
  }, [open, store, renderSettings, scope]);
  const update = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]): void => {
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const totalPages = plan?.totalPages ?? 0;
  const renderedCount = pages.length;
  // Print/export only once every page exists (canvas + pre-encoded dataUrl).
  const ready = totalPages > 0 && renderedCount >= totalPages;
  const progressText = totalPages > 0 && renderedCount < totalPages
    ? `正在渲染第 ${renderedCount + 1} / ${totalPages} 页`
    : null;
  const workbookScope = scope === 'workbook';
  const paperMm = PAPER_MM[settings.paper];

  const handlePrint = (): void => {
    if (!ready) return;
    printPages({ canvases: pages.map((p) => p.canvas), pages }, settings);
    onCancel();
  };

  const [pdfBusy, setPdfBusy] = useState(false);
  const handleExportPdf = async (): Promise<void> => {
    if (!ready || pdfBusy) return;
    setPdfBusy(true);
    try {
      const blob = await exportPagesToPdf({ canvases: pages.map((p) => p.canvas) }, settings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = workbookScope
        ? '工作簿.pdf'
        : `${store.getSheets().find((s) => s.id === store.getActiveSheetId())?.name ?? '工作表'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setPdfBusy(false);
    }
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
      <Button key="pdf" icon={<FilePdfOutlined />} loading={pdfBusy} disabled={!ready} onClick={() => { void handleExportPdf(); }}>导出 PDF</Button>,
      <Button key="print" type="primary" icon={<PrinterOutlined />} disabled={!ready} onClick={handlePrint}>打印</Button>,
    ]}
  >
    <div style={{ display: 'flex', gap: 16, minHeight: 420 }}>
      <div style={{ width: 230, flexShrink: 0, borderRight: '1px solid var(--ss-border)', paddingRight: 16 }}>
        <div className="ss-print-setting">
          <label>范围</label>
          <Radio.Group size="small" value={scope} onChange={(e) => setScope(e.target.value as PrintScope)}>
            <Radio.Button value="active">当前工作表</Radio.Button>
            <Radio.Button value="workbook">整个工作簿</Radio.Button>
          </Radio.Group>
        </div>
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
        <div className="ss-print-setting">
          <label htmlFor="ss-print-area">打印区域</label>
          <Tooltip title={workbookScope ? '打印区域仅对当前工作表生效' : undefined}>
            <Input id="ss-print-area" size="small" disabled={workbookScope} placeholder="如 A1:F20，留空为全部" value={settings.printArea ?? ''} onChange={(e) => update('printArea', e.target.value)} />
          </Tooltip>
        </div>
        <div className="ss-print-setting">
          <label htmlFor="ss-print-header">页眉</label>
          <Input id="ss-print-header" size="small" placeholder="支持 {page} {pages} {sheet}" value={settings.headerText ?? ''} onChange={(e) => update('headerText', e.target.value)} />
        </div>
        <div className="ss-print-setting">
          <label htmlFor="ss-print-footer">页脚</label>
          <Input id="ss-print-footer" size="small" placeholder="支持 {page} {pages} {sheet}" value={settings.footerText ?? ''} onChange={(e) => update('footerText', e.target.value)} />
        </div>
        <div style={{ marginTop: 16, color: 'var(--ss-text-light)', fontSize: 12, lineHeight: '20px' }}>
          共 {totalPages} 页{workbookScope
            ? ` · ${plan?.parts.length ?? 0} 个工作表`
            : <> · 打印比例 {Math.round((plan?.parts[0]?.geometry.scale ?? 1) * 100)}%</>}<br />
          {settings.paper} {settings.orientation === 'portrait' ? `${paperMm.w}×${paperMm.h}` : `${paperMm.h}×${paperMm.w}`} mm · {workbookScope ? '全部工作簿按标签顺序' : '仅当前工作表'}
          {progressText !== null && <div aria-live="polite">{progressText}</div>}
        </div>
      </div>
      <div className="ss-print-pages" aria-label="打印页面预览">
        {pages.map((page, index) => (
          <figure key={index} className="ss-print-thumb">
            <div ref={(el) => { if (el !== null && el.firstElementChild !== page.canvas) el.replaceChildren(page.canvas); }} />
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
