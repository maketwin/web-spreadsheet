import { registry } from './registry';

/** Formula AutoComplete metadata: signature shown in the parameter tooltip and
 * a short zh description in the suggestion list. */
export interface FunctionDoc {
  readonly sig: string;
  readonly desc: string;
}

const DOCS: ReadonlyArray<readonly [string, string, string]> = [
  // 数学与三角
  ['SUM', 'SUM(number1, [number2], …)', '求所有参数的和'],
  ['SUMIF', 'SUMIF(range, criteria, [sum_range])', '按单个条件求和'],
  ['SUMIFS', 'SUMIFS(sum_range, crit_range1, crit1, …)', '按多个条件求和'],
  ['SUMPRODUCT', 'SUMPRODUCT(array1, [array2], …)', '对应元素相乘后求和'],
  ['PRODUCT', 'PRODUCT(number1, …)', '所有参数乘积'],
  ['ABS', 'ABS(number)', '绝对值'],
  ['INT', 'INT(number)', '向下取整'],
  ['MOD', 'MOD(number, divisor)', '两数相除的余数'],
  ['POWER', 'POWER(number, power)', '乘幂'],
  ['SQRT', 'SQRT(number)', '算术平方根'],
  ['PI', 'PI()', '圆周率 π'],
  ['ROUND', 'ROUND(number, num_digits)', '四舍五入'],
  ['ROUNDUP', 'ROUNDUP(number, num_digits)', '向上舍入'],
  ['ROUNDDOWN', 'ROUNDDOWN(number, num_digits)', '向下舍入'],
  // 统计
  ['AVERAGE', 'AVERAGE(number1, …)', '算术平均值'],
  ['AVERAGEIF', 'AVERAGEIF(range, criteria, [avg_range])', '按条件求平均'],
  ['AVERAGEIFS', 'AVERAGEIFS(avg_range, crit_range1, crit1, …)', '按多条件求平均'],
  ['COUNT', 'COUNT(value1, …)', '统计数字个数'],
  ['COUNTA', 'COUNTA(value1, …)', '统计非空个数'],
  ['COUNTIF', 'COUNTIF(range, criteria)', '按条件计数'],
  ['COUNTIFS', 'COUNTIFS(crit_range1, crit1, …)', '按多条件计数'],
  ['MAX', 'MAX(number1, …)', '最大值'],
  ['MIN', 'MIN(number1, …)', '最小值'],
  ['MAXIFS', 'MAXIFS(max_range, crit_range1, crit1, …)', '按条件求最大'],
  ['MINIFS', 'MINIFS(min_range, crit_range1, crit1, …)', '按条件求最小'],
  ['MEDIAN', 'MEDIAN(number1, …)', '中位数'],
  ['LARGE', 'LARGE(array, k)', '第 k 大值'],
  ['SMALL', 'SMALL(array, k)', '第 k 小值'],
  ['RANK', 'RANK(number, ref, [order])', '排名'],
  ['RANK.EQ', 'RANK.EQ(number, ref, [order])', '排名（并列取最优）'],
  ['STDEV', 'STDEV(number1, …)', '样本标准差'],
  ['STDEVP', 'STDEVP(number1, …)', '总体标准差'],
  ['STDEV.S', 'STDEV.S(number1, …)', '样本标准差'],
  ['STDEV.P', 'STDEV.P(number1, …)', '总体标准差'],
  // 逻辑
  ['IF', 'IF(logical_test, value_if_true, [value_if_false])', '条件判断'],
  ['IFS', 'IFS(logical_test1, value_if_true1, …)', '多条件判断，取第一个成立的'],
  ['SWITCH', 'SWITCH(expr, value1, result1, …, [default])', '多值匹配'],
  ['AND', 'AND(logical1, …)', '全部为真返回 TRUE'],
  ['OR', 'OR(logical1, …)', '任一为真返回 TRUE'],
  ['NOT', 'NOT(logical)', '逻辑取反'],
  ['TRUE', 'TRUE()', '逻辑真'],
  ['FALSE', 'FALSE()', '逻辑假'],
  ['IFERROR', 'IFERROR(value, value_if_error)', '错误时返回备用值'],
  ['IFNA', 'IFNA(value, value_if_na)', '#N/A 时返回备用值'],
  // 文本
  ['CONCATENATE', 'CONCATENATE(text1, …)', '拼接文本'],
  ['CONCAT', 'CONCAT(text1, …)', '拼接文本'],
  ['TEXTJOIN', 'TEXTJOIN(delimiter, ignore_empty, text1, …)', '用分隔符拼接'],
  ['TEXT', 'TEXT(value, format_text)', '按格式把数值转为文本'],
  ['VALUE', 'VALUE(text)', '文本转数值'],
  ['LEFT', 'LEFT(text, [num_chars])', '左侧截取'],
  ['RIGHT', 'RIGHT(text, [num_chars])', '右侧截取'],
  ['MID', 'MID(text, start, num_chars)', '中间截取'],
  ['LEN', 'LEN(text)', '文本长度'],
  ['TRIM', 'TRIM(text)', '去掉首尾空格'],
  ['UPPER', 'UPPER(text)', '转大写'],
  ['LOWER', 'LOWER(text)', '转小写'],
  ['EXACT', 'EXACT(text1, text2)', '区分大小写比较'],
  ['FIND', 'FIND(find_text, within_text, [start])', '查找位置（区分大小写）'],
  ['SEARCH', 'SEARCH(find_text, within_text, [start])', '查找位置（不区分大小写，支持通配符）'],
  ['REPLACE', 'REPLACE(text, start, num_chars, new_text)', '替换指定位置文本'],
  ['SUBSTITUTE', 'SUBSTITUTE(text, old, new, [instance])', '替换子文本'],
  // 日期时间
  ['DATE', 'DATE(year, month, day)', '构造日期'],
  ['TIME', 'TIME(hour, minute, second)', '构造时间'],
  ['TODAY', 'TODAY()', '今天日期'],
  ['NOW', 'NOW()', '当前日期时间'],
  ['YEAR', 'YEAR(date)', '取年份'],
  ['MONTH', 'MONTH(date)', '取月份'],
  ['DAY', 'DAY(date)', '取日'],
  ['HOUR', 'HOUR(time)', '取小时'],
  ['DATEDIF', 'DATEDIF(start, end, unit)', '日期间隔（Y/M/D 等）'],
  // 查找引用
  ['VLOOKUP', 'VLOOKUP(lookup, table, col_index, [range_lookup])', '在首列查找，返回同行指定列'],
  ['HLOOKUP', 'HLOOKUP(lookup, table, row_index, [range_lookup])', '在首行查找，返回同列指定行'],
  ['XLOOKUP', 'XLOOKUP(lookup, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])', '现代查找，支持反向与通配符'],
  ['INDEX', 'INDEX(array, row_num, [col_num])', '按位置取值'],
  ['MATCH', 'MATCH(lookup, array, [match_type])', '返回匹配位置'],
  ['OFFSET', 'OFFSET(ref, rows, cols, [height], [width])', '偏移引用'],
  ['INDIRECT', 'INDIRECT(ref_text, [a1])', '把文本转为引用'],
  ['ROW', 'ROW([ref])', '行号'],
  ['COLUMN', 'COLUMN([ref])', '列号'],
  ['ROWS', 'ROWS(array)', '行数'],
  ['COLUMNS', 'COLUMNS(array)', '列数'],
  ['SUBTOTAL', 'SUBTOTAL(function_num, ref1, …)', '分类汇总（忽略隐藏行）'],
  // 动态数组
  ['FILTER', 'FILTER(array, include, [if_empty])', '按条件筛选数组'],
  ['UNIQUE', 'UNIQUE(array)', '去重'],
  ['SORT', 'SORT(array, [order])', '排序'],
  ['SEQUENCE', 'SEQUENCE(rows, [cols], [start], [step])', '生成序列数组'],
  // 信息
  ['ISBLANK', 'ISBLANK(value)', '是否为空'],
  ['ISERROR', 'ISERROR(value)', '是否为错误值'],
  ['ISNA', 'ISNA(value)', '是否为 #N/A'],
  ['ISNUMBER', 'ISNUMBER(value)', '是否为数值'],
  ['ISTEXT', 'ISTEXT(value)', '是否为文本'],
];

/** Uppercase name → signature + zh description. Includes every registry function
 * plus the special-cased ones handled directly in the evaluator. */
export const FUNCTION_CATALOG: ReadonlyMap<string, FunctionDoc> = new Map(
  DOCS.map(([name, sig, desc]) => [name.toUpperCase(), { sig, desc } as const]),
);

/** Names offered by formula AutoComplete: catalog entries that actually evaluate. */
export function autoCompleteNames(): string[] {
  const names = new Set<string>(FUNCTION_CATALOG.keys());
  return [...names].filter((name) => registry.has(name) || SPECIAL_FORM.has(name)).sort();
}

const SPECIAL_FORM = new Set([
  'IF', 'IFERROR', 'IFNA', 'IFS', 'SWITCH', 'INDIRECT', 'OFFSET',
  'ROW', 'COLUMN', 'ROWS', 'COLUMNS', 'SUBTOTAL',
  'VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH',
]);
