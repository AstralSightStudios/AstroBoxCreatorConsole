import { beforeEach, describe, expect, mock, test } from "bun:test";

class FakeApiError extends Error {
    status?: number;
    data?: unknown;
    constructor(message: string, options?: { status?: number; data?: unknown }) {
        super(message);
        this.status = options?.status;
        this.data = options?.data;
    }
}

type Call = { url: string; method: string; data: unknown };
const calls: Call[] = [];
let chunkResponder: (offset: number, size: number) => Promise<unknown> = async () => ({});

const sendApiRequest = mock(async (url: string, method: string, _token?: string, data?: unknown) => {
    calls.push({ url, method, data });
    if (url === "beta/upload/init") return { uploadId: "u".repeat(32), chunkSize: 4 };
    if (url.startsWith("beta/upload/chunk/")) {
        const offset = Number(new URL(url, "https://x.test").searchParams.get("offset"));
        return chunkResponder(offset, (data as Blob).size);
    }
    if (url === "beta/upload/complete") return { id: "file-1", sha256: (data as { sha256: string }).sha256 };
    throw new Error(`unexpected ${url}`);
});

mock.module("../../app/api/astrobox/request", () => ({ sendApiRequest, ApiError: FakeApiError }));
mock.module("../../app/config/abserver", () => ({
    ASTROBOX_SERVER_CONFIG: { serverUrl: "https://api.example.test" },
}));

const { parseUserIdList, resolveBetaUrl, uploadBetaFile } = await import("../../app/api/astrobox/beta");
const { isCreatorInboxMessage } = await import("../../app/logic/inbox/types");

beforeEach(() => {
    calls.length = 0;
});

describe("测试分发分片上传", () => {
    test("按服务端分片大小逐片上传并带 sha256 收尾", async () => {
        let received = 0;
        chunkResponder = async (offset, size) => {
            received = offset + size;
            return { receivedBytes: received };
        };
        const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])], "app.rpk");
        const progress: number[] = [];
        const result = await uploadBetaFile("p1", "package", file, (fraction) => progress.push(fraction));

        const chunks = calls.filter((call) => call.method === "PUT");
        expect(chunks.map((call) => new URL(call.url, "https://x.test").searchParams.get("offset"))).toEqual([
            "0",
            "4",
            "8",
        ]);
        expect(chunks.map((call) => (call.data as Blob).size)).toEqual([4, 4, 2]);
        expect(progress.at(-1)).toBe(1);
        // complete 带上整文件的 sha256，服务端据此校验
        expect(result.sha256).toBe("c848e1013f9f04a9d63fa43ce7fd4af035152c7c669a4a404b67107cee5f2e4e");
    });

    test("分片顺序冲突时按服务端已收字节续传", async () => {
        let first = true;
        chunkResponder = async (offset, size) => {
            if (offset === 4 && first) {
                first = false;
                // 上一片其实已经写进去了，只是响应丢了：服务端告诉我们已收 8 字节
                throw new FakeApiError("分片顺序不对", { status: 409, data: { receivedBytes: 8 } });
            }
            return { receivedBytes: offset + size };
        };
        const file = new File([new Uint8Array(10)], "app.rpk");
        await uploadBetaFile("p1", "package", file);
        const offsets = calls
            .filter((call) => call.method === "PUT")
            .map((call) => new URL(call.url, "https://x.test").searchParams.get("offset"));
        expect(offsets).toEqual(["0", "4", "8"]);
    });

    test("网络错误重试有上限", async () => {
        chunkResponder = async () => {
            throw new Error("network down");
        };
        const file = new File([new Uint8Array(3)], "a.png");
        await expect(uploadBetaFile("p1", "image", file)).rejects.toThrow("network down");
        expect(calls.filter((call) => call.method === "PUT").length).toBe(4);
    }, 15_000);
});

describe("测试分发工具函数", () => {
    test("邀请输入按逗号、空白、中文标点拆分并去重", () => {
        expect(parseUserIdList(" a1, b2，c3\nd4；a1  ")).toEqual(["a1", "b2", "c3", "d4"]);
        expect(parseUserIdList("   ")).toEqual([]);
    });

    test("服务端下发的相对路径拼上 API 域名", () => {
        expect(resolveBetaUrl("/beta/file/abc?exp=1&sig=2")).toBe("https://api.example.test/beta/file/abc?exp=1&sig=2");
        expect(resolveBetaUrl("https://cdn.test/x.png")).toBe("https://cdn.test/x.png");
        expect(resolveBetaUrl(null)).toBe("");
    });

    test("信箱只收作者身份的测试反馈", () => {
        const base = { id: "1", userId: "u", title: "", body: "", senderType: "system" as const, senderId: null, createdAt: "", readAt: null };
        expect(isCreatorInboxMessage({ ...base, kind: "cc-notice", metadata: {} })).toBe(true);
        expect(
            isCreatorInboxMessage({
                ...base,
                kind: "beta-feedback",
                metadata: { action: "beta-feedback", programId: "p", threadId: "t", role: "author" },
            }),
        ).toBe(true);
        expect(
            isCreatorInboxMessage({
                ...base,
                kind: "beta-feedback",
                metadata: { action: "beta-feedback", programId: "p", threadId: "t", role: "tester" },
            }),
        ).toBe(false);
        expect(isCreatorInboxMessage({ ...base, kind: "beta-invite", metadata: {} })).toBe(false);
    });
});
