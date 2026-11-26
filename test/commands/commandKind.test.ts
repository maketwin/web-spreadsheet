import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/commands/Command';
import { CompositeCommand } from '../../src/commands/rangeValues';
import { buildReplayableCommand, isReplayableKind, REPLAYABLE_KINDS } from '../../src/commands/replayRegistry';
import { ApplyTableStyleCommand } from '../../src/commands/impl/ApplyTableStyle';
import { ClearAxisStyleCommand, SetAxisStyleCommand } from '../../src/commands/impl/SetAxisStyle';
import { CreateChartCommand } from '../../src/commands/impl/CreateChart';
import { DeleteColCommand } from '../../src/commands/impl/DeleteCol';
import { DeleteRowCommand } from '../../src/commands/impl/DeleteRow';
import { FillRangeCommand } from '../../src/commands/impl/FillRange';
import { AddImageCommand, RemoveImageCommand, SetImageAnchorCommand } from '../../src/commands/impl/ImageObject';
import { ImportCellsCommand } from '../../src/commands/impl/ImportCells';
import { InsertColCommand } from '../../src/commands/impl/InsertCol';
import { InsertRowCommand } from '../../src/commands/impl/InsertRow';
import { MoveRange } from '../../src/commands/impl/MoveRange';
import { RemoveChartCommand } from '../../src/commands/impl/RemoveChart';
import { RemoveDuplicatesCommand } from '../../src/commands/impl/RemoveDuplicates';
import { SetAutoFilterCommand } from '../../src/commands/impl/SetAutoFilter';
import { SetAutoFilterCriteriaCommand } from '../../src/commands/impl/SetAutoFilterCriteria';
import { SetCellCommentCommand } from '../../src/commands/impl/SetCellComment';
import { SetCellText } from '../../src/commands/impl/SetCellText';
import { SetCellStyleCommand } from '../../src/commands/impl/SetCellStyle';
import { SetChartAnchorCommand } from '../../src/commands/impl/SetChartAnchor';
import { SetColsHiddenCommand, SetRowsHiddenCommand } from '../../src/commands/impl/SetHidden';
import { SetConditionalFormatCommand, SetSheetConditionalRulesCommand } from '../../src/commands/impl/SetConditionalFormat';
import { SetHyperlinkCommand } from '../../src/commands/impl/SetHyperlink';
import { ApplyMergeChanges, SetMerge, SetMergeAcross } from '../../src/commands/impl/SetMerge';
import { SetNumberFormatCommand } from '../../src/commands/impl/SetNumberFormat';
import { SetRangeBorderCommand } from '../../src/commands/impl/SetRangeBorder';
import { SetRangeStyleCommand } from '../../src/commands/impl/SetRangeStyle';
import { SetRangeValues } from '../../src/commands/impl/SetRangeValues';
import { SetColWidth } from '../../src/commands/impl/SetColWidth';
import { SetRowHeight } from '../../src/commands/impl/SetRowHeight';
import { SetSparklineCommand } from '../../src/commands/impl/SetSparkline';
import { SetValidationCommand } from '../../src/commands/impl/SetValidation';
import { SortRangeCommand } from '../../src/commands/impl/SortRange';
import { TextToColumnsCommand } from '../../src/commands/impl/TextToColumns';
import { AutoRowHeightsCommand } from '../../src/components/rowAutofit';
import { COMMAND_PAYLOAD_KINDS, sampleOp } from '../../src/platform/opDetail';
import type { ChartAnchor } from '../../src/charts/types';
import { Store } from '../../src/store/Store';

const ANCHOR: ChartAnchor = {
  from: { r: 0, c: 0, offX: 0, offY: 0 },
  to: { r: 8, c: 4, offX: 0, offY: 0 },
};
const BOX = { r1: 0, c1: 0, r2: 1, c2: 1 };

/** 全部 42 个命令类，参数给最小合法值（构造不执行，不碰 store）。 */
const ALL_COMMANDS: readonly Command[] = [
  new AddImageCommand({ spec: { id: 'img', name: 'n', src: '', anchor: ANCHOR } }),
  new ApplyMergeChanges({ add: [], remove: [] }),
  new ApplyTableStyleCommand({ ...BOX, preset: 'blue' }),
  new AutoRowHeightsCommand(BOX),
  new ClearAxisStyleCommand({ axis: 'col', from: 0, to: 1 }),
  new CompositeCommand([]),
  new CreateChartCommand({ ...BOX, type: 'bar' }),
  new DeleteColCommand({ c: 0 }),
  new DeleteRowCommand({ r: 0 }),
  new FillRangeCommand({ source: BOX, target: { r1: 2, c1: 0, r2: 3, c2: 1 } }),
  new ImportCellsCommand([]),
  new InsertColCommand({ c: 0 }),
  new InsertRowCommand({ r: 0 }),
  new MoveRange({ source: BOX, target: { r1: 2, c1: 2, r2: 3, c2: 3 } }),
  new RemoveChartCommand({ id: 'chart-1' }),
  new RemoveDuplicatesCommand({ ...BOX, columns: [0], hasHeader: false }),
  new RemoveImageCommand({ id: 'img' }),
  new SetAutoFilterCommand({ ...BOX, enabled: true }),
  new SetAutoFilterCriteriaCommand({ column: 0, mode: 'clearAll' }),
  new SetAxisStyleCommand({ axis: 'row', from: 0, to: 1, style: { bold: true } }),
  new SetCellCommentCommand({ r: 0, c: 0 }),
  new SetCellText({ r: 0, c: 0, text: '' }),
  new SetCellStyleCommand({ r: 0, c: 0, style: {} }),
  new SetChartAnchorCommand({ id: 'chart-1', anchor: ANCHOR }),
  new SetColWidth({ c: 0, width: 10 }),
  new SetColsHiddenCommand({ c1: 0, c2: 1, hidden: true }),
  new SetConditionalFormatCommand({ ...BOX, rules: [] }),
  new SetHyperlinkCommand({ r: 0, c: 0 }),
  new SetImageAnchorCommand({ id: 'img', anchor: ANCHOR }),
  new SetMerge({ range: 'A1:B2', active: true }),
  new SetMergeAcross({ range: 'A1:B2' }),
  new SetNumberFormatCommand({ ...BOX, numberFormat: '0.00' }),
  new SetRangeBorderCommand({ ...BOX, preset: 'all', line: 'solid' }),
  new SetRangeStyleCommand({ ...BOX, style: {} }),
  new SetRangeValues({ ...BOX, values: [[]] }),
  new SetRowsHiddenCommand({ r1: 0, r2: 1, hidden: true }),
  new SetSheetConditionalRulesCommand({ entries: [] }),
  new SetSparklineCommand({ ...BOX, type: 'line', targetRow: 0, targetCol: 2 }),
  new SetValidationCommand({ ...BOX, rule: { type: 'integer', min: 0, max: 9 } }),
  new SortRangeCommand({ ...BOX, sortCol: 0, direction: 'asc' }),
  new SetRowHeight({ r: 0, height: 10 }),
  new TextToColumnsCommand({ r1: 0, c1: 0, r2: 1, options: { delimiter: 'comma' } }),
];

/** 白名单 31 个命令的最小采样样本（逐个跑重建回路）。 */
const WHITELIST_SAMPLES: readonly { readonly kind: string; readonly make: () => Command }[] = [
  { kind: 'setCellText', make: () => new SetCellText({ r: 1, c: 2, text: 'x' }) },
  { kind: 'insertRow', make: () => new InsertRowCommand({ r: 1, count: 2 }) },
  { kind: 'deleteRow', make: () => new DeleteRowCommand({ r: 3, count: 1 }) },
  { kind: 'insertCol', make: () => new InsertColCommand({ c: 2, count: 1 }) },
  { kind: 'deleteCol', make: () => new DeleteColCommand({ c: 4, count: 1 }) },
  { kind: 'setCellStyle', make: () => new SetCellStyleCommand({ r: 1, c: 2, style: { bold: true } }) },
  { kind: 'setRangeStyle', make: () => new SetRangeStyleCommand({ ...BOX, style: { bold: true } }) },
  { kind: 'setRangeBorder', make: () => new SetRangeBorderCommand({ ...BOX, preset: 'all', line: 'solid' }) },
  { kind: 'setNumberFormat', make: () => new SetNumberFormatCommand({ ...BOX, numberFormat: '0.00' }) },
  { kind: 'setRowHeight', make: () => new SetRowHeight({ r: 5, height: 40 }) },
  { kind: 'setColWidth', make: () => new SetColWidth({ c: 3, width: 120 }) },
  { kind: 'setRowsHidden', make: () => new SetRowsHiddenCommand({ r1: 1, r2: 3, hidden: true }) },
  { kind: 'setColsHidden', make: () => new SetColsHiddenCommand({ c1: 1, c2: 2, hidden: false }) },
  { kind: 'setMerge', make: () => new SetMerge({ range: 'B2:C3', active: true }) },
  { kind: 'setMergeAcross', make: () => new SetMergeAcross({ range: 'B2:C3' }) },
  { kind: 'applyMergeChanges', make: () => new ApplyMergeChanges({ add: ['B2:C3'], remove: ['E1:F2'] }) },
  { kind: 'setValidation', make: () => new SetValidationCommand({ ...BOX, rule: { type: 'list', values: ['a', 'b'] } }) },
  { kind: 'setConditionalFormat', make: () => new SetConditionalFormatCommand({ ...BOX, rules: [] }) },
  { kind: 'setSheetConditionalRules', make: () => new SetSheetConditionalRulesCommand({ entries: [['0,0:1,1', []]] }) },
  { kind: 'setHyperlink', make: () => new SetHyperlinkCommand({ r: 1, c: 2, displayText: '链接' }) },
  { kind: 'setCellComment', make: () => new SetCellCommentCommand({ r: 1, c: 2, comment: { text: '备注' } }) },
  { kind: 'moveRange', make: () => new MoveRange({ source: BOX, target: { r1: 2, c1: 2, r2: 3, c2: 3 } }) },
  { kind: 'fillRange', make: () => new FillRangeCommand({ source: BOX, target: { r1: 2, c1: 0, r2: 3, c2: 1 }, copy: true }) },
  { kind: 'sortRange', make: () => new SortRangeCommand({ ...BOX, sortCol: 1, direction: 'desc' }) },
  { kind: 'removeDuplicates', make: () => new RemoveDuplicatesCommand({ ...BOX, columns: [0, 1], hasHeader: true }) },
  { kind: 'textToColumns', make: () => new TextToColumnsCommand({ r1: 0, c1: 1, r2: 2, options: { delimiter: 'comma' } }) },
  { kind: 'setAutoFilter', make: () => new SetAutoFilterCommand({ ...BOX, enabled: false }) },
  { kind: 'setAutoFilterCriteria', make: () => new SetAutoFilterCriteriaCommand({ column: 2, criteria: { selected: ['x'], includeBlanks: false }, mode: 'set' }) },
  { kind: 'applyTableStyle', make: () => new ApplyTableStyleCommand({ ...BOX, preset: 'green' }) },
  { kind: 'setAxisStyle', make: () => new SetAxisStyleCommand({ axis: 'col', from: 2, to: 3, style: { bold: true } }) },
  { kind: 'clearAxisStyle', make: () => new ClearAxisStyleCommand({ axis: 'row', from: 4, to: 6 }) },
];

/** 四个结构命令的 kind 必须与 structuralKind 声明一致。 */
const STRUCTURAL: readonly { readonly make: () => Command; readonly structural: string }[] = [
  { make: () => new InsertRowCommand({ r: 0 }), structural: 'insertRow' },
  { make: () => new DeleteRowCommand({ r: 0 }), structural: 'deleteRow' },
  { make: () => new InsertColCommand({ c: 0 }), structural: 'insertCol' },
  { make: () => new DeleteColCommand({ c: 0 }), structural: 'deleteCol' },
];

describe('Command.kind 稳定身份', () => {
  it('42 个命令类里除 CompositeCommand 外 kind() 都非 null 且两两不同', () => {
    expect(ALL_COMMANDS).toHaveLength(42);
    const kinds = ALL_COMMANDS.map((cmd) => cmd.kind());
    const named = kinds.filter((k) => k !== null);
    expect(named).toHaveLength(41);
    expect(new Set(named).size).toBe(41);
    for (const cmd of ALL_COMMANDS) {
      if (cmd instanceof CompositeCommand) expect(cmd.kind()).toBeNull();
      else expect(cmd.kind()).not.toBeNull();
    }
  });

  it('四个结构命令的 kind 与 structuralKind 声明一致', () => {
    for (const { make, structural } of STRUCTURAL) {
      const cmd = make();
      expect(cmd.kind()).toBe(structural);
      expect(cmd.structuralKind()).toBe(structural);
    }
  });

  it('白名单之外的身份也稳定（不参与重建但可作为标识）', () => {
    expect(REPLAYABLE_KINDS).toHaveLength(31);
    for (const kind of REPLAYABLE_KINDS) expect(isReplayableKind(kind)).toBe(true);
    expect(isReplayableKind('createChart')).toBe(false);
    expect(isReplayableKind('addImage')).toBe(false);
    expect(isReplayableKind('setRangeValues')).toBe(false);
    expect(isReplayableKind('autoRowHeights')).toBe(false);
    expect(isReplayableKind('importCells')).toBe(false);
    expect(isReplayableKind(null)).toBe(false);
    expect(isReplayableKind('madeUpCommand')).toBe(false);
  });

  it('平台侧分派表与白名单同步（去掉 5 个旧形状种类后逐名相等）', () => {
    const legacy = new Set(['setCellText', 'insertRow', 'deleteRow', 'insertCol', 'deleteCol']);
    expect([...COMMAND_PAYLOAD_KINDS].sort()).toEqual(REPLAYABLE_KINDS.filter((k) => !legacy.has(k)).sort());
  });
});

describe('白名单重建回路', () => {
  const store = new Store();

  /** 旧形状载荷（insertRow 等五种）对应的重建参数——形状即参数，逐形状提取。 */
  function legacyPayloadArgs(payload: { readonly kind: string } & Record<string, unknown>): Record<string, unknown> {
    const sheetId = payload.sheetId;
    const sheet = typeof sheetId === 'string' ? { sheetId } : {};
    if (payload.kind === 'insertRow' || payload.kind === 'deleteRow') return { r: payload.r, count: payload.count, ...sheet };
    if (payload.kind === 'insertCol' || payload.kind === 'deleteCol') return { c: payload.c, count: payload.count, ...sheet };
    if (payload.kind === 'setCell') return { r: payload.r, c: payload.c, text: payload.text, ...sheet };
    throw new Error(`未知载荷形状 ${payload.kind}`);
  }

  it('每个白名单命令：采样 → buildReplayableCommand → 同身份、同参数', () => {
    expect(WHITELIST_SAMPLES).toHaveLength(31);
    for (const { kind, make } of WHITELIST_SAMPLES) {
      if (!isReplayableKind(kind)) throw new Error(`${kind} 应在白名单里`);
      const cmd = make();
      const payload = sampleOp(cmd, store)?.replay ?? null;
      expect(payload, `sampleOp(${kind}) 应有载荷`).not.toBeNull();
      if (payload === null) throw new Error(`unreachable for ${kind}`);
      // command 形状：参数就是拷贝；旧形状（setCellText 与四个结构命令）：按形状提取参数
      const rebuilt = payload.kind === 'command'
        ? (isReplayableKind(payload.command) ? buildReplayableCommand(payload.command, payload.args) : null)
        : buildReplayableCommand(kind, legacyPayloadArgs(payload));
      expect(rebuilt, `rebuilt(${kind}) 应可重建`).not.toBeNull();
      if (rebuilt === null) throw new Error(`unreachable for ${kind}`);
      expect(rebuilt.kind(), `rebuilt(${kind}) 身份应一致`).toBe(cmd.kind());
      expect(rebuilt.args, `rebuilt(${kind}) 参数应深度相等`).toEqual(cmd.args);
    }
  });
});
