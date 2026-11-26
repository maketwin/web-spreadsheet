import { ApplyMergeChanges, SetMerge, SetMergeAcross, type ApplyMergeChangesArgs, type SetMergeAcrossArgs, type SetMergeArgs } from './impl/SetMerge';
import { ApplyTableStyleCommand, type ApplyTableStyleArgs } from './impl/ApplyTableStyle';
import { ClearAxisStyleCommand, SetAxisStyleCommand, type ClearAxisStyleArgs, type SetAxisStyleArgs } from './impl/SetAxisStyle';
import { DeleteColCommand, type DeleteColArgs } from './impl/DeleteCol';
import { DeleteRowCommand, type DeleteRowArgs } from './impl/DeleteRow';
import { FillRangeCommand, type FillRangeArgs } from './impl/FillRange';
import { InsertColCommand, type InsertColArgs } from './impl/InsertCol';
import { InsertRowCommand, type InsertRowArgs } from './impl/InsertRow';
import { MoveRange, type MoveRangeArgs } from './impl/MoveRange';
import { RemoveDuplicatesCommand, type RemoveDuplicatesArgs } from './impl/RemoveDuplicates';
import { SetAutoFilterCommand, type SetAutoFilterArgs } from './impl/SetAutoFilter';
import { SetAutoFilterCriteriaCommand, type SetAutoFilterCriteriaArgs } from './impl/SetAutoFilterCriteria';
import { SetCellCommentCommand, type SetCellCommentArgs } from './impl/SetCellComment';
import { SetCellText, type SetCellTextArgs } from './impl/SetCellText';
import { SetCellStyleCommand, type SetCellStyleArgs } from './impl/SetCellStyle';
import { SetColsHiddenCommand, SetRowsHiddenCommand, type SetColsHiddenArgs, type SetRowsHiddenArgs } from './impl/SetHidden';
import { SetConditionalFormatCommand, SetSheetConditionalRulesCommand, type SetConditionalFormatArgs, type SetSheetConditionalRulesArgs } from './impl/SetConditionalFormat';
import { SetHyperlinkCommand, type SetHyperlinkArgs } from './impl/SetHyperlink';
import { SetNumberFormatCommand, type SetNumberFormatArgs } from './impl/SetNumberFormat';
import { SetRangeBorderCommand, type SetRangeBorderArgs } from './impl/SetRangeBorder';
import { SetRangeStyleCommand, type SetRangeStyleArgs } from './impl/SetRangeStyle';
import { SetRowHeight, type SetRowHeightArgs } from './impl/SetRowHeight';
import { SetColWidth, type SetColWidthArgs } from './impl/SetColWidth';
import { SetValidationCommand, type SetValidationArgs } from './impl/SetValidation';
import { SortRangeCommand, type SortRangeArgs } from './impl/SortRange';
import { TextToColumnsCommand, type TextToColumnsArgs } from './impl/TextToColumns';
import type { Command } from './Command';

/**
 * 重放白名单：哪些命令可以只凭记录的参数（kind + args）安全重建——显式逐个
 * 列出，不按形状猜（历史事故：SetRowHeight 曾因类名含 Row 被当 deleteRow 回放）。
 *
 * 命名契约：这里的键名会进持久化格式（时间线事件、复现包都存它），一旦
 * 发布就**只能新增、不能改名或删除**——旧版本导出的时间线要永远能被识别。
 *
 * 有意不进白名单（采样时 replay 为 null，回放跳过）：
 * - createChart / removeChart / setChartAnchor / addImage / removeImage /
 *   setImageAnchor / setSparkline：引用执行时或界面侧生成的对象 id，重放时对不上；
 * - setRangeValues / importCells：整块数据，载荷过大（粘贴的值走工作簿快照）；
 * - autoRowHeights：按内容现算（通常作为 composite 的一部分出现）；
 * - composite：CompositeCommand 是一组命令的容器，没有稳定身份（kind() 为 null）。
 */
const BUILDERS = {
  setCellText: (args: SetCellTextArgs) => new SetCellText(args),
  insertRow: (args: InsertRowArgs) => new InsertRowCommand(args),
  deleteRow: (args: DeleteRowArgs) => new DeleteRowCommand(args),
  insertCol: (args: InsertColArgs) => new InsertColCommand(args),
  deleteCol: (args: DeleteColArgs) => new DeleteColCommand(args),
  setCellStyle: (args: SetCellStyleArgs) => new SetCellStyleCommand(args),
  setRangeStyle: (args: SetRangeStyleArgs) => new SetRangeStyleCommand(args),
  setRangeBorder: (args: SetRangeBorderArgs) => new SetRangeBorderCommand(args),
  setNumberFormat: (args: SetNumberFormatArgs) => new SetNumberFormatCommand(args),
  setRowHeight: (args: SetRowHeightArgs) => new SetRowHeight(args),
  setColWidth: (args: SetColWidthArgs) => new SetColWidth(args),
  setRowsHidden: (args: SetRowsHiddenArgs) => new SetRowsHiddenCommand(args),
  setColsHidden: (args: SetColsHiddenArgs) => new SetColsHiddenCommand(args),
  setMerge: (args: SetMergeArgs) => new SetMerge(args),
  setMergeAcross: (args: SetMergeAcrossArgs) => new SetMergeAcross(args),
  applyMergeChanges: (args: ApplyMergeChangesArgs) => new ApplyMergeChanges(args),
  setValidation: (args: SetValidationArgs) => new SetValidationCommand(args),
  setConditionalFormat: (args: SetConditionalFormatArgs) => new SetConditionalFormatCommand(args),
  setSheetConditionalRules: (args: SetSheetConditionalRulesArgs) => new SetSheetConditionalRulesCommand(args),
  setHyperlink: (args: SetHyperlinkArgs) => new SetHyperlinkCommand(args),
  setCellComment: (args: SetCellCommentArgs) => new SetCellCommentCommand(args),
  moveRange: (args: MoveRangeArgs) => new MoveRange(args),
  fillRange: (args: FillRangeArgs) => new FillRangeCommand(args),
  sortRange: (args: SortRangeArgs) => new SortRangeCommand(args),
  removeDuplicates: (args: RemoveDuplicatesArgs) => new RemoveDuplicatesCommand(args),
  textToColumns: (args: TextToColumnsArgs) => new TextToColumnsCommand(args),
  setAutoFilter: (args: SetAutoFilterArgs) => new SetAutoFilterCommand(args),
  setAutoFilterCriteria: (args: SetAutoFilterCriteriaArgs) => new SetAutoFilterCriteriaCommand(args),
  applyTableStyle: (args: ApplyTableStyleArgs) => new ApplyTableStyleCommand(args),
  setAxisStyle: (args: SetAxisStyleArgs) => new SetAxisStyleCommand(args),
  clearAxisStyle: (args: ClearAxisStyleArgs) => new ClearAxisStyleCommand(args),
} as const;

/** 白名单里的稳定命令名（持久化格式的一部分：只能新增，不能改名）。 */
export type ReplayableCommandKind = keyof typeof BUILDERS;

/** 白名单键名列表（测试同步守卫、平台侧投影用）。 */
export const REPLAYABLE_KINDS: readonly ReplayableCommandKind[] = Object.keys(BUILDERS) as readonly ReplayableCommandKind[];

export function isReplayableKind(kind: string | null): kind is ReplayableCommandKind {
  return kind !== null && kind in BUILDERS;
}

/**
 * 从记录的载荷重建命令。args 来自时间线/复现包（可能被外部改过、或是旧版本
 * 数据），命令体自己负责校验——与用户输入走同一条 execute 路径。
 */
export function buildReplayableCommand(kind: ReplayableCommandKind, args: unknown): Command {
  const build = BUILDERS[kind] as (args: unknown) => Command;
  return build(args);
}
