/** themeId / 资源 id 的长度上限，与上游协商结果一致。 */
export const RES_PACK_THEME_ID_MAX_LENGTH = 64;

export const RES_PACK_ID_PATTERN = /^[a-z0-9_-]+$/;

/**
 * 由资源名派生一个**建议**的 themeId：trim → 小写 → 非法字符替为 `-` →
 * 折叠连续 `-` → 去首尾 `-`。
 *
 * 仅用于切换资源类型时给空输入框填一个建议值，幂等且逐字节稳定。
 * **不要用它改写创作者正在输入的内容**——自动替换非法字符会打断输入法组字
 * （拼音中间的组字符会被替成 `-`），也会让 CSV id 与包内 themeId 悄悄分叉。
 * 输入过程中只提示不合规（validateResPackIdFormat），由创作者自己改。
 */
export function normalizeResPackIdInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateResPackIdFormat(id: string): string | null {
  if (!id) return "资源包 ID 不能为空";
  if (id.length > RES_PACK_THEME_ID_MAX_LENGTH) {
    return `资源包 ID 最长 ${RES_PACK_THEME_ID_MAX_LENGTH} 个字符`;
  }
  if (!RES_PACK_ID_PATTERN.test(id)) {
    return "资源包 ID 仅支持小写字母、数字、下划线和连字符";
  }
  return null;
}
