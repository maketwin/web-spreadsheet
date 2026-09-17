import { Button, Checkbox, Form, Input, Modal, Select, Space, message } from 'antd';
import { useEffect, useRef, useState, useCallback, type FC } from 'react';
import { InvalidFindPatternError, type FindMatch, type FindResult, type FindReplaceService, type FindScope } from '../../../find/FindReplaceService';
import type { Store } from '../../../store/Store';
import type { CommandManager } from '../../../commands/CommandManager';
import type { RangeAddress } from '../../../selection/Range';
import { num2alpha } from '../../../util/alphabet';

export interface FindReplaceDialogProps {
  readonly open: boolean;
  readonly replaceMode?: boolean;
  readonly onCancel: () => void;
  readonly store: Store;
  readonly cmdManager?: CommandManager | undefined;
  readonly selected: RangeAddress | null;
  readonly service: FindReplaceService;
  readonly onNavigate: (match: FindMatch) => void;
  readonly onHighlight: (matches: readonly FindMatch[], current: number) => void;
}

interface FormValues {
  readonly find: string;
  readonly replace: string;
  readonly caseSensitive: boolean;
  readonly matchEntireCell: boolean;
  readonly useRegex: boolean;
  readonly scope: FindScope;
}

const MAX_LISTED = 500;

export const FindReplaceDialog: FC<FindReplaceDialogProps> = ({ open, replaceMode = false, onCancel, store, cmdManager, selected, service, onNavigate, onHighlight }) => {
  const [form] = Form.useForm<FormValues>();
  const [result, setResult] = useState<FindResult | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
  const resultRef = useRef<FindResult | null>(null);
  resultRef.current = result;

  const findText = Form.useWatch('find', form) ?? '';
  const replaceText = Form.useWatch('replace', form) ?? '';
  const caseSensitive = Form.useWatch('caseSensitive', form) === true;
  const matchEntireCell = Form.useWatch('matchEntireCell', form) === true;
  const useRegex = Form.useWatch('useRegex', form) === true;
  const scope = (Form.useWatch('scope', form) ?? 'sheet') as FindScope;

  const publish = useCallback((next: FindResult): void => {
    setResult(next);
    onHighlight(next.matches, next.current);
    if (next.currentCell !== null) onNavigate(next.currentCell);
  }, [onHighlight, onNavigate]);

  const rescan = useCallback((): void => {
    if (!open) return;
    if (findText.length === 0) {
      setResult(null);
      setPatternError(null);
      onHighlight([], -1);
      return;
    }
    try {
      const cursor = selected !== null ? { r: selected.r1, c: selected.c1 } : null;
      // Keep the current match selected when it survives the option change.
      const previous = resultRef.current?.currentCell ?? null;
      let next = service.find(store, { findText, replaceText, caseSensitive, matchEntireCell, useRegex, scope }, previous ?? cursor);
      if (previous !== null) {
        const kept = next.matches.findIndex((m) => m.sheetId === previous.sheetId && m.r === previous.r && m.c === previous.c);
        if (kept >= 0) {
          service.setCurrentIndex(kept);
          next = { ...next, current: kept, currentCell: next.matches[kept] ?? null };
        }
      }
      setPatternError(null);
      setResult(next);
      onHighlight(next.matches, next.current);
    } catch (err) {
      if (err instanceof InvalidFindPatternError) {
        setPatternError(err.message);
        setResult(null);
        onHighlight([], -1);
        return;
      }
      throw err;
    }
  }, [open, findText, replaceText, caseSensitive, matchEntireCell, useRegex, scope, selected, service, store, onHighlight]);

  // Option or query change → re-scan (debounced), like Excel's live find.
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => rescan(), 250);
    return () => window.clearTimeout(timer);
  }, [open, findText, caseSensitive, matchEntireCell, useRegex, scope, rescan]);

  // Closing the dialog must clear canvas highlights.
  useEffect(() => {
    if (!open) onHighlight([], -1);
  }, [open, onHighlight]);

  const doNext = useCallback((): void => publish(service.findNext()), [publish, service]);
  const doPrev = useCallback((): void => publish(service.findPrevious()), [publish, service]);

  const jumpTo = useCallback((index: number): void => {
    service.setCurrentIndex(index);
    const match = service.getMatches()[index];
    if (match === undefined) return;
    publish({ matches: service.getMatches(), current: index, currentCell: match });
  }, [publish, service]);

  const doFindKey = useCallback((): void => {
    if (result !== null && result.matches.length > 0) doNext();
    else rescan();
  }, [result, doNext, rescan]);

  const doReplace = useCallback((): void => {
    if (findText.length === 0) return;
    const { result: next, replaced } = service.replaceCurrent(store, { findText, replaceText, caseSensitive, matchEntireCell, useRegex, scope }, cmdManager);
    publish(next);
    if (replaced !== true) message.info('当前没有可替换的匹配项');
  }, [findText, replaceText, caseSensitive, matchEntireCell, useRegex, scope, store, cmdManager, service, publish]);

  const doReplaceAll = useCallback((): void => {
    if (findText.length === 0) return;
    const { replacements, cells } = service.replaceAll(store, { findText, replaceText, caseSensitive, matchEntireCell, useRegex, scope }, cmdManager);
    message.success(`已替换 ${replacements} 处（${cells} 个单元格）`);
    rescan();
  }, [findText, replaceText, caseSensitive, matchEntireCell, useRegex, scope, store, cmdManager, service, rescan]);

  const close = useCallback((): void => {
    onHighlight([], -1);
    onCancel();
  }, [onHighlight, onCancel]);

  const hasMatches = result !== null && result.matches.length > 0;
  const countLabel = hasMatches ? `${result!.current + 1} / ${result!.matches.length}` : result === null ? '' : '无匹配项';
  const listed = result !== null ? result.matches.slice(0, MAX_LISTED) : [];

  return <Modal title={replaceMode ? '查找和替换' : '查找'} open={open} onCancel={close} footer={null} width={480}>
    <Form form={form} layout="vertical" initialValues={{ find: '', replace: '', caseSensitive: false, matchEntireCell: false, useRegex: false, scope: 'sheet' }}>
      <Form.Item
        name="find"
        label="查找内容"
        {...(patternError !== null ? { validateStatus: 'error' as const, help: patternError } : {})}
        style={{ marginBottom: 8 }}
      >
        <Input autoFocus onPressEnter={doFindKey} placeholder={useRegex ? '正则表达式，如 \\d{4}-(\\d{2})' : undefined} allowClear />
      </Form.Item>
      {replaceMode && (
        <Form.Item name="replace" label="替换为" style={{ marginBottom: 8 }}>
          <Input onPressEnter={doReplace} placeholder={useRegex ? '支持分组引用，如 $1' : undefined} />
        </Form.Item>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center', marginBottom: 8 }}>
        <Form.Item name="caseSensitive" valuePropName="checked" noStyle><Checkbox>区分大小写</Checkbox></Form.Item>
        <Form.Item name="matchEntireCell" valuePropName="checked" noStyle><Checkbox>整格匹配</Checkbox></Form.Item>
        <Form.Item name="useRegex" valuePropName="checked" noStyle><Checkbox>正则表达式</Checkbox></Form.Item>
        <Form.Item name="scope" noStyle>
          <Select size="small" style={{ width: 96 }} aria-label="查找范围" options={[{ value: 'sheet', label: '工作表' }, { value: 'workbook', label: '工作簿' }]} />
        </Form.Item>
      </div>
    </Form>
    <Space wrap style={{ marginBottom: result !== null && result.matches.length > 0 ? 8 : 0 }}>
      <Button size="small" onClick={doPrev} disabled={!hasMatches}>上一个</Button>
      <Button size="small" onClick={doNext} disabled={!hasMatches}>下一个</Button>
      {replaceMode && <>
        <Button size="small" onClick={doReplace} disabled={!hasMatches}>替换</Button>
        <Button size="small" onClick={doReplaceAll} disabled={findText.length === 0 || patternError !== null}>全部替换</Button>
      </>}
      {countLabel.length > 0 && <span style={{ fontSize: 12, color: 'var(--ss-text-light)' }}>{countLabel}</span>}
    </Space>
    {listed.length > 0 && (
      <div className="ss-find-list" role="list" aria-label="查找结果">
        {listed.map((match, index) => (
          <button
            key={`${match.sheetId}:${match.r},${match.c}`}
            type="button"
            role="listitem"
            className={index === result!.current ? 'ss-find-row ss-find-row--current' : 'ss-find-row'}
            onClick={() => jumpTo(index)}
          >
            <span className="ss-find-addr">{match.sheetName}!{num2alpha(match.c)}{match.r + 1}</span>
            <span className="ss-find-text" title={match.text}>{match.text}</span>
          </button>
        ))}
        {result!.matches.length > MAX_LISTED && (
          <div className="ss-find-more">共 {result!.matches.length} 处匹配，仅列出前 {MAX_LISTED} 条</div>
        )}
      </div>
    )}
  </Modal>;
};
