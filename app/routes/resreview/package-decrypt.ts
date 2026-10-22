import { AdminApi } from "~/api/astrobox/admin";
import { decryptAes256Ecb } from "~/logic/publish/decryption";

export type ReviewDecryptOutcome =
  | { status: "decrypted"; bytes: Uint8Array }
  /** 服务端没登记这份密文：不是加密包体，或作者换了包体却没重新登记密钥。 */
  | { status: "noKey" }
  | { status: "failed"; reason: string };

type FetchKey = (body: {
  resourceId: string;
  encryptedFileHash: string;
}) => Promise<{ key: string }>;

function httpStatus(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * 审核时解开加密包体：按密文哈希向服务端取密钥（需要审核角色，每次都记审计），
 * 解出明文后由调用方照常跑包体内容校验。
 */
export async function decryptReviewPackage(
  ciphertext: Uint8Array,
  resourceId: string,
  encryptedFileHash: string,
  fetchKey: FetchKey = AdminApi.review.resourceFileKey,
): Promise<ReviewDecryptOutcome> {
  let key: string;
  try {
    ({ key } = await fetchKey({ resourceId, encryptedFileHash }));
  } catch (error) {
    switch (httpStatus(error)) {
      case 404:
        return { status: "noKey" };
      case 403:
        return {
          status: "failed",
          reason: "没有审核解密权限（需要 admin / moderator / pr-reviewer 角色）",
        };
      case 409:
        return { status: "failed", reason: "同一份密文登记了不同的密钥" };
      default:
        return {
          status: "failed",
          reason: `取密钥失败：${error instanceof Error ? error.message : String(error)}`,
        };
    }
  }
  try {
    return { status: "decrypted", bytes: await decryptAes256Ecb(ciphertext, key) };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
