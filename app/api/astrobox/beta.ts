import { ASTROBOX_SERVER_CONFIG } from "~/config/abserver";
import { ApiError, sendApiRequest } from "./request";

// 测试分发（类 TestFlight），服务端见 AstroBoxServer src/community/beta 与 docs/beta-testing.md

export type BetaRestype = "quick_app" | "watchface" | "canopus" | "res_pack";
export type BetaTier = "CreatorPlus" | "CreatorPro";

export const BETA_RESTYPE_LABELS: Record<BetaRestype, string> = {
    quick_app: "快应用",
    watchface: "表盘",
    canopus: "Canopus 模块",
    res_pack: "资源包",
};

export interface BetaProfile {
    userId: string;
    displayName: string;
    avatar: string;
}

export interface BetaBuildFile {
    fileId: string;
    devices: string[];
    fileName: string;
    size: number;
    sha256: string;
    /** 包体自己的版本与标识，发版时从包里读出 */
    packageVersion?: string;
    packageVersionCode?: number | null;
    packageId?: string | null;
}

export interface BetaBuild {
    id: string;
    programId: string;
    version: string;
    versionCode: number;
    changelog: string;
    files: BetaBuildFile[];
    status: "active" | "expired" | "deleted";
    downloads?: number;
    expiresAt: string;
    createdAt: string;
}

export interface BetaProgram {
    id: string;
    name: string;
    description: string;
    restype: BetaRestype;
    icon: string | null;
    iconFileId: string | null;
    resourceId: string | null;
    watchfaceId: string | null;
    status: "active" | "closed";
    owner: BetaProfile;
    latestBuild: BetaBuild | null;
    testerCount?: number;
    openFeedback?: number;
    unreadFeedback?: number;
    createdAt: string;
    updatedAt: string;
}

export interface BetaOverview {
    tier: BetaTier | null;
    limits: {
        testersPerProgram: number;
        storageBytes: number;
        programs: number;
        packageBytes: number;
        buildTtlDays: number;
    } | null;
    storageUsedBytes: number;
    programs: BetaProgram[];
}

export interface BetaAuthorProgram {
    program: BetaProgram;
    builds: BetaBuild[];
    /** 已发布过的最大 versionCode，新版本必须大于它 */
    topVersionCode?: number;
    testerLimit: number;
    tier: BetaTier | null;
}

export type BetaTesterStatus = "invited" | "active" | "left" | "removed" | "declined";

export interface BetaTester extends BetaProfile {
    status: BetaTesterStatus;
    source: "inbox" | "link";
    invitedAt: string | null;
    joinedAt: string | null;
    lastDownloadedVersion: string | null;
    lastDownloadedVersionCode: number | null;
    lastDownloadedAt: string | null;
    downloads: number;
    feedbackCount: number;
}

export interface BetaInviteLink {
    code: string;
    url: string;
    maxUses: number | null;
    uses: number;
    expiresAt: string | null;
    revoked: boolean;
    expired: boolean;
    createdAt: string;
}

export type BetaInviteResultStatus = "invited" | "already" | "not_found" | "limit" | "self";

export interface BetaUploadedFile {
    id: string;
    kind: "package" | "image";
    fileName: string;
    size: number;
    sha256: string;
    contentType: string;
    url: string | null;
    width: number | null;
    height: number | null;
}

export interface BetaThread {
    id: string;
    programId: string;
    tester: BetaProfile;
    buildId: string | null;
    buildVersion: string | null;
    title: string;
    status: "open" | "resolved";
    device: {
        name: string;
        model: string;
        firmware: string;
        deviceId: string;
        platform: string;
        appVersion: string;
    } | null;
    messageCount: number;
    lastMessageAt: string;
    lastMessagePreview: string;
    lastSenderRole: "author" | "tester";
    unread: boolean;
    createdAt: string;
}

export interface BetaMessage {
    id: string;
    sender: BetaProfile;
    role: "author" | "tester";
    body: string;
    attachments: BetaUploadedFile[];
    createdAt: string;
}

export interface BetaThreadDetail {
    role: "author" | "tester";
    program: { id: string; name: string; ownerId: string; status: string };
    thread: BetaThread;
    messages: BetaMessage[];
}

function post<T>(path: string, data: unknown = {}) {
    return sendApiRequest<T>(`beta/${path}`, "POST", undefined, data);
}

/** 服务端下发的文件地址是相对路径（/beta/file/...），拼上当前 API 域名。 */
export function resolveBetaUrl(path: string | null | undefined) {
    if (!path) return "";
    if (/^https?:\/\//.test(path)) return path;
    return new URL(path, ASTROBOX_SERVER_CONFIG.serverUrl).toString();
}

export const BetaApi = {
    overview: () => post<BetaOverview>("author/overview"),
    createProgram: (input: {
        name: string;
        description?: string;
        restype: BetaRestype;
        resourceId?: string | null;
        watchfaceId?: string | null;
    }) => post<BetaProgram>("author/program/create", input),
    getProgram: (programId: string) => post<BetaAuthorProgram>("author/program/get", { programId }),
    updateProgram: (
        programId: string,
        input: Partial<{
            name: string;
            description: string;
            resourceId: string | null;
            watchfaceId: string | null;
            status: "active" | "closed";
            iconFileId: string | null;
        }>,
    ) => post<BetaProgram>("author/program/update", { programId, ...input }),
    deleteProgram: (programId: string) => post<{ ok: true }>("author/program/delete", { programId }),
    createBuild: (input: {
        programId: string;
        version: string;
        versionCode: number;
        changelog?: string;
        files: Array<{
            fileId: string;
            devices: string[];
            packageVersion?: string;
            packageVersionCode?: number | null;
            packageId?: string | null;
        }>;
        notify?: boolean;
    }) => post<BetaBuild>("author/build/create", input),
    updateBuild: (buildId: string, input: { version?: string; changelog?: string }) =>
        post<BetaBuild>("author/build/update", { buildId, ...input }),
    deleteBuild: (buildId: string) => post<{ ok: true }>("author/build/delete", { buildId }),
    listTesters: (programId: string) =>
        post<{ limit: number; used: number; testers: BetaTester[] }>("author/testers/list", { programId }),
    inviteTesters: (programId: string, userIds: string[], note?: string) =>
        post<{ results: Array<{ userId: string; status: BetaInviteResultStatus }> }>(
            "author/testers/invite",
            { programId, userIds, note },
        ),
    removeTester: (programId: string, userId: string) =>
        post<{ ok: true }>("author/testers/remove", { programId, userId }),
    listLinks: (programId: string) => post<{ links: BetaInviteLink[] }>("author/links/list", { programId }),
    createLink: (programId: string, options: { maxUses?: number; expiresInDays?: number }) =>
        post<BetaInviteLink>("author/links/create", { programId, ...options }),
    revokeLink: (programId: string, code: string) =>
        post<{ ok: true }>("author/links/revoke", { programId, code }),
    listThreads: (programId: string, options: { status?: "open" | "resolved"; page?: number; pageSize?: number } = {}) =>
        post<{ role: string; total: number; page: number; pageSize: number; threads: BetaThread[] }>(
            "feedback/list",
            { programId, ...options },
        ),
    getThread: (threadId: string) => post<BetaThreadDetail>("feedback/thread", { threadId }),
    reply: (threadId: string, body: string, attachments: string[]) =>
        post<BetaMessage>("feedback/reply", { threadId, body, attachments }),
    setThreadStatus: (threadId: string, status: "open" | "resolved") =>
        post<{ status: string }>("feedback/status", { threadId, status }),
};

async function sha256Hex(file: Blob) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const CHUNK_RETRIES = 3;

/**
 * 分片上传到自家服务器：init → 逐片 PUT（每片 ≤ 服务端给的 chunkSize）→ complete 校验 sha256。
 * 某一片失败会按服务端回报的已收字节对齐后重试，弱网下不用从头再来。
 */
export async function uploadBetaFile(
    programId: string,
    kind: "package" | "image",
    file: File,
    onProgress?: (fraction: number) => void,
): Promise<BetaUploadedFile> {
    const sha256 = await sha256Hex(file);
    const init = await post<{ uploadId: string; chunkSize: number }>("upload/init", {
        programId,
        kind,
        fileName: file.name,
        size: file.size,
    });
    let offset = 0;
    let failures = 0;
    onProgress?.(0);
    while (offset < file.size) {
        const end = Math.min(file.size, offset + init.chunkSize);
        const chunk = file.slice(offset, end, "application/octet-stream");
        try {
            const result = await sendApiRequest<{ receivedBytes: number }>(
                `beta/upload/chunk/${init.uploadId}?offset=${offset}`,
                "PUT",
                undefined,
                chunk,
            );
            offset = result.receivedBytes;
            failures = 0;
            onProgress?.(offset / file.size);
        } catch (error) {
            const received =
                error instanceof ApiError && error.status === 409
                    ? Number((error.data as { receivedBytes?: number } | undefined)?.receivedBytes)
                    : Number.NaN;
            if (Number.isFinite(received)) {
                offset = received;
                continue;
            }
            failures += 1;
            if (failures > CHUNK_RETRIES) throw error;
            await new Promise((resolve) => setTimeout(resolve, 800 * failures));
        }
    }
    onProgress?.(1);
    return post<BetaUploadedFile>("upload/complete", { uploadId: init.uploadId, sha256 });
}

export function formatBytes(bytes: number | null | undefined) {
    const value = Number(bytes ?? 0);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    return `${size.toFixed(size >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** 邀请输入框：逗号、空白、换行分隔的一串用户 ID。 */
export function parseUserIdList(input: string) {
    return Array.from(
        new Set(
            input
                .split(/[\s,，;；]+/)
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    );
}
