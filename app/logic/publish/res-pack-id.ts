/** themeId / 资源 id 的长度上限，与上游协商结果一致。 */
export const RES_PACK_THEME_ID_MAX_LENGTH = 64;

export const RES_PACK_ID_PATTERN = /^[a-z0-9_-]+$/;

/**
 * 幂等归一化：trim → 小写 → 非法字符替为 `-` → 折叠连续 `-` → 去首尾 `-`。
 * 不截断长度；超长由 validateResPackIdFormat 拒绝。
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
