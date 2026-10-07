import { sendApiRequest } from "./request";

export interface SubmitResourceCryptoInfoBody {
  id: string;
  deviceId: string;
  hash: string;
  key: string;
  repoOwner: string;
  repoName: string;
  commitSha: string;
}

export function submitResourceCryptoInfo(body: SubmitResourceCryptoInfoBody) {
  return sendApiRequest<string>(
    "/resource/submit_crypto_info",
    "POST",
    undefined,
    body,
  );
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
