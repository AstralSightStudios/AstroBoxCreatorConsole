/**
 * 仓库下拉的筛选与排序口径。
 *
 * 发布时会给资源仓库打上 `astrobox-resource`（以及资源类型）topic；
 * 与 owner/仓库名无关，比名称前缀更可靠。旧仓库没有 topic 时仍按
 * `astrobox-resource-` 前缀兜底。
 */

export interface RepoOptionSummary {
  name: string;
  description?: string;
  updatedAt?: string;
  topics?: string[];
}

/** 搜索词同时匹配仓库名、描述与 topic。 */
export function matchesRepoOption(
  repo: RepoOptionSummary,
  keyword: string,
): boolean {
  const query = keyword.trim().toLowerCase();
  if (!query) return true;
  return (
    repo.name.toLowerCase().includes(query) ||
    (repo.description ?? "").toLowerCase().includes(query) ||
    (repo.topics ?? []).some((topic) => topic.toLowerCase().includes(query))
  );
}

/** 是否为 AstroBox 资源仓库：优先看 topic，旧仓库回退到名称前缀。 */
export function isAstroBoxResourceRepo(repo: RepoOptionSummary): boolean {
  return (
    (repo.topics ?? []).includes("astrobox-resource") ||
    repo.name.startsWith("astrobox-resource-")
  );
}
