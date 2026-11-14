/**
 * 审核员共用的预制回复。内容存在服务端（`/admin/review/presets`），所有审核员看到的是同一份，
 * 谁改了措辞大家一起生效。
 */
import {
  composeReviewReply,
  resolveGuidelineRefs,
  type CitationMode,
  type GuidelineIndex,
} from "./guidelines";

/** 这条回复通常怎么用：标记需要修改 / 普通评论 / 关闭 PR / 拒绝 */
export type ReviewPresetAction = "needfix" | "comment" | "close" | "refuse";

export const REVIEW_PRESET_ACTIONS: readonly ReviewPresetAction[] = [
  "needfix",
  "comment",
  "close",
  "refuse",
];

export const REVIEW_PRESET_ACTION_LABELS: Record<ReviewPresetAction, string> = {
  needfix: "需要修改",
  comment: "普通评论",
  close: "关闭",
  refuse: "拒绝",
};

export interface ReviewPreset {
  id: string;
  title: string;
  category: string;
  /** 回复正文（Markdown），不含准则原文 */
  body: string;
  /** 引用的准则（引用键） */
  rules: string[];
  action: ReviewPresetAction;
  sort: number;
  updatedBy: string;
  updatedAt: string;
}

export type ReviewPresetDraft = Pick<
  ReviewPreset,
  "title" | "category" | "body" | "rules" | "action"
>;

/** 普通评论是「请参考这一条」，其余（需要修改 / 关闭 / 拒绝）都是「不符合这一条」。 */
export function presetCitationMode(action: ReviewPresetAction): CitationMode {
  return action === "comment" ? "reference" : "violation";
}

/**
 * 把预制回复展开成可以直接发出去的文字：引用的准则按当前文档展开成引用块，后面接正文。
 * 文档里已经找不到的引用键列在 `missing`（条款被删或改了编号），由界面提示审核员。
 */
export function composePresetReply(
  preset: Pick<ReviewPreset, "body" | "rules" | "action">,
  index: GuidelineIndex,
): { text: string; missing: string[] } {
  const { entries, missing } = resolveGuidelineRefs(index, preset.rules);
  return {
    text: composeReviewReply({
      entries,
      mode: presetCitationMode(preset.action),
      body: preset.body,
    }),
    missing,
  };
}

const UNCATEGORIZED = "未分组";

export interface ReviewPresetGroup {
  category: string;
  items: ReviewPreset[];
}

/**
 * 按分组排列预制回复，可按关键词筛选（标题、分组、正文、引用的准则）。
 * 传入 `preferred` 时，这些用途的回复排在各组最前——在「关闭」「拒绝」弹窗里先看到对应的那几条。
 */
export function groupReviewPresets(
  presets: readonly ReviewPreset[],
  options: { query?: string; preferred?: readonly ReviewPresetAction[] } = {},
): ReviewPresetGroup[] {
  const terms = (options.query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const preferred = new Set(options.preferred ?? []);
  const groups = new Map<string, ReviewPreset[]>();

  const ordered = [...presets].sort(
    (a, b) => a.sort - b.sort || a.title.localeCompare(b.title, "zh-CN"),
  );
  for (const preset of ordered) {
    if (terms.length > 0) {
      const haystack = `${preset.title} ${preset.category} ${preset.body} ${preset.rules.join(
        " ",
      )}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) continue;
    }
    const category = preset.category.trim() || UNCATEGORIZED;
    const items = groups.get(category);
    if (items) items.push(preset);
    else groups.set(category, [preset]);
  }

  const result = [...groups.entries()].map(([category, items]) => ({
    category,
    items:
      preferred.size > 0
        ? [
            ...items.filter((item) => preferred.has(item.action)),
            ...items.filter((item) => !preferred.has(item.action)),
          ]
        : items,
  }));
  if (preferred.size === 0) return result;
  // 含有对应用途回复的分组整体靠前，组间原有顺序不变
  const hasPreferred = (group: ReviewPresetGroup) =>
    group.items.some((item) => preferred.has(item.action));
  return [...result.filter(hasPreferred), ...result.filter((group) => !hasPreferred(group))];
}

export function validatePresetDraft(draft: ReviewPresetDraft): string | null {
  if (!draft.title.trim()) return "请填写标题。";
  if (!draft.body.trim() && draft.rules.length === 0) {
    return "正文和引用的准则至少要有一项。";
  }
  return null;
}
