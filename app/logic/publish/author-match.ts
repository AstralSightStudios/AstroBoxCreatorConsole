/**
 * 作者字段的绑定规则，发布表单与 PR 审核共用同一套口径。
 *
 * manifest / 表单里的 author[].name 约定填 AstroBox「用户名」（username，账号的唯一
 * 句柄），不是展示用的 displayName，也不是 AstroBox 的 userId；唯一能把署名和真实
 * 账号挂上的是 author[].bindABAccount 这个开关——它声明「这个署名对应一个真实的
 * AstroBox 账号」。
 *
 * 因此硬性要求只有一条：作者字段里至少有一条 author 开着 bindABAccount。
 * 一个都没有的话，资源就归属不到任何人：资源主页、Creator Pro 权益、
 * 2 免费 : 1 付费比例、加密与付费门槛、审核通知的收件人全部无从谈起。
 *
 * 明确不包含「署名是否真的对应某个账号」的反查——查这个只有 AstroBox 管理员做得到，
 * 创作者侧一律不查（详见 resreview/owner-pro.ts 的审核端反查：按用户名精确取账号）。
 *
 * 本文件只放纯函数：不发请求、不读全局状态，方便单测覆盖口径本身。
 */

/** 与 manifest / 表单同构的作者条目，容忍缺字段的历史数据。 */
export interface ManifestAuthorLike {
    name?: string;
    bindABAccount?: boolean;
}

/**
 * 名称归一化：去首尾空白 + 转小写。
 *
 * 仅用于去重与提示文案；判定「是否绑定」只看 bindABAccount，不看名称。
 */
export function normalizeAuthorName(name: unknown): string {
    return typeof name === "string" ? name.trim().toLowerCase() : "";
}

/** 取出作者列表并过滤掉脏条目（非对象、名称为空）。 */
export function normalizeAuthorList(raw: unknown): ManifestAuthorLike[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(
        (item): item is ManifestAuthorLike =>
            Boolean(item) &&
            typeof item === "object" &&
            normalizeAuthorName((item as ManifestAuthorLike).name) !== "",
    );
}

function collectNames(
    authors: ManifestAuthorLike[] | undefined,
    bound: boolean,
): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const author of normalizeAuthorList(authors)) {
        if (Boolean(author.bindABAccount) !== bound) continue;
        const name = author.name!.trim();
        // 同一署名可能重复出现（改过名又填回来），去重后只报一次。
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}

/** 声明关联 AstroBox 账号且名称非空的署名。 */
export function collectBoundAuthorNames(
    authors: ManifestAuthorLike[] | undefined,
): string[] {
    return collectNames(authors, true);
}

/** 未声明关联 AstroBox 账号的署名，仅用于提示文案。 */
export function collectUnboundAuthorNames(
    authors: ManifestAuthorLike[] | undefined,
): string[] {
    return collectNames(authors, false);
}

/**
 * 作者字段里是否至少有一条声明关联 AstroBox 账号。
 *
 * 名称为空的条目不算：buildManifest 会把空名作者直接过滤掉，写进 manifest 的
 * 只是一条没有署名的绑定声明，等于什么都没关联。
 */
export function hasBoundAuthor(
    authors: ManifestAuthorLike[] | undefined,
): boolean {
    return collectBoundAuthorNames(authors).length > 0;
}

/**
 * 从创作者搜索结果取一个可直接写进作者字段的署名。
 *
 * 作者字段约定填 AstroBox「用户名」（username，账号的唯一句柄），不是展示用的
 * displayName——审核端只能拿用户名反查真实账号，displayName 会重名、也查不准。
 * 因此这里始终取 username；为空时返回空串，由调用方忽略这次选择。
 */
export function authorNameFromSearchResult(result: {
    username?: string;
}): string {
    return (result.username ?? "").trim();
}

/**
 * 保证第一个作者永远处于绑定状态。
 *
 * 第一个作者代表创作者自己，AuthorsSection 里它的「关联账号」开关是禁用的
 * （关不掉），所以一旦回填进来的值是 false 就会卡死：开关显示关着、点不动，
 * 提醒创作者也修不了，只能删掉整个资源重来。两条会破坏该不变量的路径都要过这里：
 *
 *   - 从 manifest / 草稿 / 壁纸会话回填：历史 manifest 没有 bindABAccount 字段，
 *     Boolean(undefined) 得到 false；
 *   - 删除第一个作者后，原本的第二个作者升到第一位，而它的 bindABAccount 可以是 false。
 */
export function withBoundFirstAuthor<
    T extends { name: string; bindABAccount: boolean },
>(authors: T[]): T[] {
    if (authors.length === 0 || authors[0].bindABAccount) return authors;
    return authors.map((author, index) =>
        index === 0 ? { ...author, bindABAccount: true } : author,
    );
}

/**
 * 一个作者都没绑定时的提醒文案。
 *
 * 发布侧只提醒不阻拦：绑定与否是创作者的自由，但资源会归属不到任何账号，
 * Creator Pro 权益与付费比例都会失效，PR 审核也会因此被退回。
 */
export function unboundAuthorNotice(
    authors: ManifestAuthorLike[] | undefined,
): string | null {
    if (hasBoundAuthor(authors)) return null;
    const unbound = collectUnboundAuthorNames(authors);
    return unbound.length > 0
        ? `作者「${unbound.join("」「")}」都没有关联 AstroBox 账号。资源将归属不到任何账号：Creator Pro 权益与免费 / 付费比例都会失效，PR 审核也会因此被退回。建议让第一个作者保持关联你的 AstroBox 账号。`
        : "当前没有关联 AstroBox 账号的作者。资源将归属不到任何账号：Creator Pro 权益与免费 / 付费比例都会失效，PR 审核也会因此被退回。建议让第一个作者保持关联你的 AstroBox 账号。";
}