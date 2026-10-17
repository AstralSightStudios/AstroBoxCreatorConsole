/**
 * 只读详情页的关键字过滤。
 *
 * 详情页里的面板全是后台原始数据：设备 id、裸 uid、英文枚举。搜索如果只比对
 * 原始字段，就会出现「界面上明明显示着『爱发电』，搜爱发电却搜不到」的割裂。
 * 所以这里让每个面板把「原始字段 + 已经翻译好的可读文本（账号名 / 设备名 /
 * 中文标签）」一起交给过滤器，展示与搜索共用同一套文案。
 */

export interface DetailSearchContext {
  /** 当前关键字，空串表示不过滤。 */
  keyword: string;
  /** uid → 已解析的账号名；没解析出来返回空串。 */
  userName: (userId?: string | null) => string;
  /** 设备 id / 机型号 → 可读名称；解析不出来原样返回。 */
  deviceLabel: (deviceId?: string | null) => string;
}

export const EMPTY_DETAIL_SEARCH: DetailSearchContext = {
  keyword: "",
  userName: () => "",
  deviceLabel: (deviceId) => (deviceId ?? "").trim(),
};

/** 把任意字段值摊平成可搜索文本；对象走 JSON，避免 [object Object]。 */
export function safeSearchText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

export function matchKeyword(
  context: DetailSearchContext,
  item: unknown,
  ...extras: Array<string | null | undefined>
) {
  const keyword = context.keyword.trim().toLowerCase();
  if (!keyword) return true;
  const haystack = [safeSearchText(item), ...extras]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .toLowerCase();
  return haystack.includes(keyword);
}

export function filterItems<T>(
  items: readonly T[],
  context: DetailSearchContext,
  extras: (item: T) => Array<string | null | undefined>,
) {
  if (!context.keyword.trim()) return [...items];
  return items.filter((item) => matchKeyword(context, item, ...extras(item)));
}

/** 列表小标题的计数：搜索时显示「命中 x / 共 y」，否则只显示总数。 */
export function countLabel(
  visible: number,
  total: number,
  context: DetailSearchContext,
) {
  if (context.keyword.trim() && visible !== total) {
    return `命中 ${visible} / 共 ${total}`;
  }
  return String(total);
}
