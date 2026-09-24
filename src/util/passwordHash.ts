/** 工作簿密码哈希：FNV-1a 变体（同步、无环境依赖）。
 * 注意：这是客户端门槛校验，不是加密——数据保护需文件级加密。 */

export function hashPassword(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = ((h1 ^ c) * 16777619) >>> 0;
    h2 = (h2 + c * (i + 7)) >>> 0;
  }
  return `fnv1a-${h1.toString(16)}-${h2.toString(16)}`;
}
