import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createCipheriv } from "node:crypto";

// 审核时解开加密包体：按密文哈希向服务端取密钥，解出明文；取不到 / 解不开要分清原因。

class FakeApiError extends Error {
  status?: number;
  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.status = options?.status;
  }
}

type Call = { url: string; method: string; data: unknown };
const calls: Call[] = [];
let respond: () => Promise<unknown> = async () => ({});

mock.module("../../app/api/astrobox/request", () => ({
  sendApiRequest: async (url: string, method: string, _token?: string, data?: unknown) => {
    calls.push({ url, method, data });
    return respond();
  },
  ApiError: FakeApiError,
}));

const { decryptReviewPackage } = await import("../../app/routes/resreview/package-decrypt");
// 其它测试文件会把 AdminApi 换成不带 review 的替身（mock.module 跨文件生效），所以加一个查询串
// 拿一份新的 admin.ts：它依赖的 request 用的是本文件的替身。
const { AdminApi } = await import("../../app/api/astrobox/admin.ts?package-decrypt-test");
const fetchKey = (body: { resourceId: string; encryptedFileHash: string }) =>
  AdminApi.review.resourceFileKey(body);

const KEY = new Uint8Array(32).fill(5);
const HASH = "c".repeat(64);
const plain = new TextEncoder().encode("PK\u0003\u0004 manifest.json quick app body");
const cipher = createCipheriv("aes-256-ecb", KEY, null);
const ciphertext = new Uint8Array(Buffer.concat([cipher.update(plain), cipher.final()]));

describe("decryptReviewPackage", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  test("asks the review endpoint by ciphertext hash and returns the plaintext", async () => {
    respond = async () => ({ deviceId: "xmb10p", key: Buffer.from(KEY).toString("base64") });

    const outcome = await decryptReviewPackage(ciphertext, "res-1", HASH, fetchKey);

    expect(calls).toEqual([
      {
        url: "/admin/review/resource-file-key",
        method: "POST",
        data: { resourceId: "res-1", encryptedFileHash: HASH },
      },
    ]);
    expect(outcome.status).toBe("decrypted");
    if (outcome.status === "decrypted") {
      expect(new TextDecoder().decode(outcome.bytes)).toBe(new TextDecoder().decode(plain));
    }
  });

  test("an unregistered ciphertext is not an error", async () => {
    respond = async () => {
      throw new FakeApiError("file_key_not_found", { status: 404 });
    };
    expect(await decryptReviewPackage(ciphertext, "res-1", HASH, fetchKey)).toEqual({ status: "noKey" });
  });

  test("missing review role, ambiguous keys and wrong keys each say why", async () => {
    respond = async () => {
      throw new FakeApiError("管理员权限不足", { status: 403 });
    };
    const forbidden = await decryptReviewPackage(ciphertext, "res-1", HASH, fetchKey);
    expect(forbidden).toEqual({
      status: "failed",
      reason: "没有审核解密权限（需要 admin / moderator / pr-reviewer 角色）",
    });

    respond = async () => {
      throw new FakeApiError("ambiguous_file_key", { status: 409 });
    };
    expect(await decryptReviewPackage(ciphertext, "res-1", HASH, fetchKey)).toEqual({
      status: "failed",
      reason: "同一份密文登记了不同的密钥",
    });

    respond = async () => ({ deviceId: "xmb10p", key: Buffer.alloc(32, 6).toString("base64") });
    expect(await decryptReviewPackage(ciphertext, "res-1", HASH, fetchKey)).toEqual({
      status: "failed",
      reason: "密钥与包体不匹配",
    });
  });
});
