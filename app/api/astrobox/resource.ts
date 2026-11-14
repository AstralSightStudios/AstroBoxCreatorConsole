import { ApiError, sendApiRequest } from "./request";

export interface SubmitResourceCryptoInfoBody {
  id: string;
  deviceId: string;
  hash: string;
  key: string;
  repoOwner: string;
  repoName: string;
  commitSha: string;
}

/**
 * 服务端 /resource/submit_crypto_info 的失败原因（reason）都是英文枚举串
 * （AstroBoxServer community/resource/ownership.ts 与 service.ts），直接展示
 * 对创作者不友好。这里翻译成中文，并在括号里保留原始 reason，方便排查与反馈。
 *
 * 只覆盖正常流程下真实可达的分支。ownership.ts 里还有 invalid repo owner/name、
 * invalid commit sha、manifest is not valid json、manifest item.id does not match
 * resource id、deviceId not declared in manifest downloads 五条：它们分别由前端
 * 传入的 GitHub 仓库信息 / commit SHA / JSON.stringify 生成的 manifest / 同一份
 * downloads 数据保证，正常不会触发，因此不在这里翻译。
 *
 * 未命中映射的错误（网络异常、500、其他接口错误等）保持原样。
 */
const SUBMIT_CRYPTO_INFO_REASON_TEXT: Record<string, string> = {
  // SubmitCryptoInfo 本体（service.ts）
  "creator plus required": "需要 Creator Plus 或 Creator Pro 权益才能提交加密资源",
  "not resource owner": "你不是该资源的作者，无法提交加密密钥",
  "resource file key owned by another user":
    "该资源文件的密钥已被其他账号占用",
  // 未入库资源经 manifest 反查所有权（ownership.ts）
  "account not found":
    "未能确认 AstroBox 与 GitHub 的账号对应关系，请稍后重试",
  "ab account has no github binding":
    "当前 AstroBox 账号尚未绑定 GitHub，请先在 AstroBox 账号中心完成绑定",
  "repo owner does not match account github":
    "资源仓库的所有者与 AstroBox 账号绑定的 GitHub 账号不一致",
  "failed to verify repo": "无法访问 GitHub 验证资源仓库，请稍后重试",
  "repo not found": "未找到资源仓库（可能是私有仓库或已被删除）",
  "repo owner mismatch on github":
    "GitHub 上该仓库的所有者与 AstroBox 账号绑定的 GitHub 不一致",
  "failed to read manifest":
    "无法从 GitHub 读取仓库中的 manifest_v2.json，请稍后重试",
  "manifest not found at commit":
    "该提交中不存在 manifest_v2.json，请确认文件已正确上传",
  "manifest primary author is not bound to AB":
    "manifest 的第一作者未关联 AstroBox 账号",
  "manifest author does not match operator":
    "manifest 的第一作者与当前登录账号不一致",
};

/** 鉴权中间件在 data.error 里返回的封禁错误码。 */
const SUBMIT_CRYPTO_INFO_BAN_LABEL: Record<string, string> = {
  "user-banned": "账号已被封禁",
  "social-banned": "账号已被限制社交功能",
};

function localizeSubmitCryptoInfoError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;

  const options = {
    status: error.status,
    response: error.response,
    data: error.data,
  };

  // 封禁错误由中间件返回，message 里只有 error code，真实原因在 data.reason。
  const data = error.data as Record<string, unknown> | null | undefined;
  const errorCode = typeof data?.error === "string" ? data.error : "";
  const banLabel = SUBMIT_CRYPTO_INFO_BAN_LABEL[errorCode];
  if (banLabel) {
    const reason = typeof data?.reason === "string" ? data.reason.trim() : "";
    const text = reason ? `${banLabel}：${reason}` : banLabel;
    return new ApiError(`${text}（${errorCode}）`, options);
  }

  const rawReason = error.message.trim();
  const text = SUBMIT_CRYPTO_INFO_REASON_TEXT[rawReason];
  if (!text) return error;

  return new ApiError(`${text}（${rawReason}）`, options);
}

export async function submitResourceCryptoInfo(body: SubmitResourceCryptoInfoBody) {
  try {
    return await sendApiRequest<string>(
      "/resource/submit_crypto_info",
      "POST",
      undefined,
      body,
    );
  } catch (error) {
    throw localizeSubmitCryptoInfoError(error);
  }
}

export interface RegisterVersionResetIntentBody {
  id: string;
  commitSha: string;
  resetRatings: boolean;
  foldComments: boolean;
}

/**
 * 推送新版本时登记的可选操作：清空资源评分、折叠既往的全部评论。
 * 服务端在这个 commit 审核上线、且确实改了版本时执行；两项都不选即撤销之前登记的。
 */
export function registerVersionResetIntent(body: RegisterVersionResetIntentBody) {
  return sendApiRequest<{ pending: boolean }>(
    "/resource/version_reset/intent",
    "POST",
    undefined,
    body,
  );
}

export interface RegisterIdMigrationIntentBody {
  fromId: string;
  /** 为空或等于 fromId 即撤销 */
  toId: string;
}

/**
 * 已上架资源换 ID 时，提交 PR 前登记。PR 合入、目录里旧 ID 换成新 ID 后，
 * 服务端把旧 ID 上的下载量、评分、评论、付费配置与购买记录等搬到新 ID。
 */
export function registerIdMigrationIntent(body: RegisterIdMigrationIntentBody) {
  return sendApiRequest<{ pending: boolean }>(
    "/resource/id_migration/intent",
    "POST",
    undefined,
    body,
  );
}

export interface IdMigrationRecord {
  fromId: string;
  toId: string;
  status: "pending" | "applied" | "rejected";
  /** 被拒的原因：source_still_listed / author_mismatch / target_exists */
  reason: string | null;
  registeredAt: string;
  appliedAt: string | null;
  /** pending 登记的过期时间 */
  expiresAt: string | null;
}

/**
 * 某个资源 ID 涉及的换 ID 记录（作为旧 ID 或新 ID），最近的在前。
 * 只返回当前账号登记的、或当前账号是旧资源主作者的记录。
 */
export async function getIdMigrationStatus(id: string): Promise<IdMigrationRecord[]> {
  const result = await sendApiRequest<{ items: IdMigrationRecord[] }>(
    `/resource/id_migration/status?id=${encodeURIComponent(id)}`,
    "GET",
  );
  return result.items;
}
