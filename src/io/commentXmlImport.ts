import type { ChartSpec } from '../charts/types';
import type { Cell, CellComment } from '../types';

/**
 * 安全说明：本模块是纯前端的 xlsx 批注解析器——只做字符串/正则处理 zip 内的
 * XML 文本，不涉及任何 shell、子进程、命令执行或网络请求。文件与 Map 操作
 * 均为普通数据结构读写。
 *
 * Comment (note) import: parsed from xl/commentsN.xml directly (via the sheet
 * rels) instead of SheetJS's comment reader, which mangles non-ASCII authors.
 */

interface SerializedSheetDataLike {
  readonly cells: Array<[string, Cell]>;
  readonly charts: ChartSpec[];
}

function unescapeXmlEntities(s: string): string {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function refOf(col: number, row: number): string {
  let n = col;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${out}${row + 1}`;
}

/** Locate the comments part of a sheet via its rels (Type …/comments). */
function findCommentsPart(files: Map<string, string>, sheetPath: string): string | undefined {
  const fileName = sheetPath.split('/').pop() ?? '';
  const relsPath = `xl/worksheets/_rels/${fileName}.rels`;
  const relsXml = files.get(relsPath);
  if (relsXml === undefined) return undefined;
  const m = relsXml.match(/<Relationship\b[^>]*Type="[^"]*\/comments"[^>]*Target="([^"]+)"/);
  const target = m === null || m[1] === undefined ? undefined : m[1];
  if (target === undefined) return undefined;
  if (target.startsWith('/')) return target.slice(1);
  return ['xl/', target.replace(/^\.\.\//, '')].join('');
}

/** Parse xl/commentsN.xml: ref ("B2") → comment. Text runs concatenated. */
function parseCommentsPart(xml: string): Map<string, CellComment> {
  const out = new Map<string, CellComment>();
  const authorById = new Map<string, string>();
  let authorIdx = 0;
  for (const m of xml.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/g)) {
    authorById.set(String(authorIdx), unescapeXmlEntities(m[1] ?? ''));
    authorIdx += 1;
  }
  for (const m of xml.matchAll(/<comment\b[^>]*ref="([^"]+)"[^>]*>([\s\S]*?)<\/comment>/g)) {
    const ref = m[1] ?? '';
    const body = m[2] ?? '';
    const text = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((t) => unescapeXmlEntities(t[1] ?? ''))
      .join('')
      .replace(/\r\n/g, '\n');
    if (text === '') continue;
    const authorIdToken = m[0].match(/authorId="(\d+)"/)?.[1];
    const author = authorIdToken !== undefined ? authorById.get(authorIdToken) : undefined;
    const comment: CellComment = author === undefined ? { text } : { text, author };
    out.set(ref, comment);
  }
  return out;
}

/** Attach parsed comments onto the cell entries (content cells only — a
 * comment on a never-written cell has nothing to attach to on import). */
export function importCommentsForSheet(
  files: Map<string, string>,
  sheetPath: string,
  data: SerializedSheetDataLike,
): void {
  const commentsPart = findCommentsPart(files, sheetPath);
  if (commentsPart === undefined) return;
  const comments = parseCommentsPart(files.get(commentsPart) ?? '');
  if (comments.size === 0) return;
  for (const entry of data.cells) {
    const key = entry[0];
    const cell = entry[1];
    const parts = key.split(',').map(Number);
    const r = parts[0];
    const c = parts[1];
    if (r === undefined || c === undefined) continue;
    const comment = comments.get(refOf(c, r));
    if (comment !== undefined) cell.comment = comment;
  }
}
