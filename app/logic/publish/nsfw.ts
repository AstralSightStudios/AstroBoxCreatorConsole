/**
 * 敏感内容（NSFW）声明。
 *
 * 资源含血腥、恐怖等可能令人不适的内容时，创作者在发布页打开「敏感内容」：
 * - 目录行（index_v2.csv）的 tags 里加上系统标记 `<__NSFW__>`。客户端列表只读目录，
 *   靠这个标记默认模糊封面；
 * - manifest 的 `ext.nsfw.reason` 写明原因。客户端在用户进入详情页前用它提示，
 *   用户确认后才继续。
 *
 * 标记是给程序看的，不是给人看的标签：不计入「至少 3 个标签」，也不在标签列表里显示。
 * 它不是免死金牌——色情等越过内容准则 1.1 底线的内容，加了标记也不能上架。
 */

export const NSFW_TAG = "<__NSFW__>";

/** 原因按 Unicode 码点计的长度上限：要放进一个确认弹窗里。 */
export const NSFW_REASON_MAX = 120;

const isMarker = (tag: string) => tag.trim() === NSFW_TAG;
const codePoints = (value: string) => Array.from(value);

export function hasNsfwTag(tags: readonly string[]): boolean {
  return tags.some(isMarker);
}

/** 去掉系统标记，剩下的是创作者写给用户看的标签。 */
export function visibleTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => !isMarker(tag));
}

/** 打开或关闭标记。标记始终放在最后，不打乱创作者排好的标签顺序。 */
export function setNsfwTag(tags: readonly string[], enabled: boolean): string[] {
  const rest = visibleTags(tags);
  return enabled ? [...rest, NSFW_TAG] : rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseExtObject(extRaw: string): Record<string, unknown> | null {
  const trimmed = extRaw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 从表单的 ext JSON 文本里读出敏感内容原因；没写或 JSON 不合法返回空串。 */
export function readNsfwReason(extRaw: string): string {
  const ext = parseExtObject(extRaw);
  const nsfw = ext?.nsfw;
  return isRecord(nsfw) && typeof nsfw.reason === "string" ? nsfw.reason : "";
}

/**
 * 把原因写回 ext JSON 文本，其它键原样保留；传 null 删掉整个 `nsfw` 键。
 * ext 文本本身不是合法 JSON 对象时不动它（交给表单自己的 JSON 报错）。
 */
export function writeNsfwReason(extRaw: string, reason: string | null): string {
  const ext = parseExtObject(extRaw);
  if (!ext) return extRaw;
  const next = { ...ext };
  if (reason === null) {
    delete next.nsfw;
  } else {
    next.nsfw = {
      ...(isRecord(ext.nsfw) ? ext.nsfw : {}),
      reason: codePoints(reason).slice(0, NSFW_REASON_MAX).join(""),
    };
  }
  return Object.keys(next).length === 0 ? "{}" : JSON.stringify(next, null, 2);
}

export interface NsfwInspection {
  /** 目录行的 tags 里带着标记 */
  tagged: boolean;
  /** manifest 的 ext.nsfw.reason（已去首尾空白） */
  reason: string;
  /** 写法有误：发布前必须改掉，审核时判不通过 */
  problems: string[];
}

/**
 * 核对「标记」与「原因」是否成对。两者分别落在目录行和 manifest 里，任何一边单独存在
 * 客户端都没法正确处理：只有标记，用户被拦下却不知道为什么；只有原因，封面不会模糊。
 */
export function inspectNsfw(tags: readonly string[], ext: unknown): NsfwInspection {
  const tagged = hasNsfwTag(tags);
  const raw = isRecord(ext) ? ext.nsfw : undefined;
  const problems: string[] = [];
  let reason = "";

  if (raw !== undefined) {
    if (!isRecord(raw)) {
      problems.push("ext.nsfw 需要是一个对象，形如 { \"reason\": \"含血腥画面\" }");
    } else if (raw.reason !== undefined && typeof raw.reason !== "string") {
      problems.push("ext.nsfw.reason 需要是字符串");
    } else {
      reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
    }
  }

  if (tagged && !reason && problems.length === 0) {
    problems.push("已标记为敏感内容，但没有填写原因。用户进入详情页前需要知道是哪方面的内容。");
  }
  if (!tagged && raw !== undefined && problems.length === 0) {
    problems.push(
      `manifest 里写了敏感内容原因，但目录标签里没有 ${NSFW_TAG} 标记，客户端不会模糊封面。请重新打开「敏感内容」开关。`,
    );
  }
  if (codePoints(reason).length > NSFW_REASON_MAX) {
    problems.push(`敏感内容原因超过 ${NSFW_REASON_MAX} 字。`);
  }
  return { tagged, reason, problems };
}
