import { PUBLISH_CONFIG } from "~/config/publish";
import { isTauriRuntime } from "../update/update-checker";
import {
    CATALOG_CSV_HEADER,
    CATALOG_CSV_COLUMNS,
    normalizeCatalogEntryForCsv,
    parseCatalogCsv,
    serializeCatalogEntry,
    type CatalogEntry,
} from "./catalog";

export type SubmissionMode = "create" | "edit";

/** 提交客户端信息：CC 版本与构建期注入的元信息（可缺失，历史 request.json 无此字段）。 */
export interface SubmissionClientInfo {
    version: string;
    git_commit_hash: string;
    build_time: string;
    build_user: string;
}

export interface SubmissionRequest {
    schema_version: 1;
    mode: SubmissionMode;
    original_id: string | null;
    base_entry_digest: string | null;
    base_catalog_commit: string | null;
    client: SubmissionClientInfo | null;
}

export interface SubmissionFileInfo {
    submissionPath: string;
    csvPath: string;
    requestPath: string;
}

const ZERO_WIDTH_PATTERN = /[\u200b\u200c\u200d\u2060\ufeff]/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export function normalizeSubmissionPathSegment(
    value: string,
    label: string,
): string {
    const normalized = value.trim().toLowerCase();
    if (!normalized) throw new Error(`${label} 不能为空。`);
    if (CONTROL_PATTERN.test(normalized) || ZERO_WIDTH_PATTERN.test(normalized)) {
        throw new Error(`${label} 包含不可见或控制字符。`);
    }
    if (
        normalized === "." ||
        normalized === ".." ||
        normalized.includes("/") ||
        normalized.includes("\\")
    ) {
        throw new Error(`${label} 包含非法路径片段。`);
    }
    if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
        throw new Error(`${label} 只允许小写字母、数字、点、连字符和下划线。`);
    }
    return normalized;
}

export function buildSubmissionPath(
    githubLogin: string,
    repoName: string,
): string {
    const login = normalizeSubmissionPathSegment(githubLogin, "GitHub 用户名");
    const name = normalizeSubmissionPathSegment(repoName, "仓库名");
    return `${PUBLISH_CONFIG.submissionRootPath}/${login}/${name}`;
}

export function submissionCsvPath(submissionPath: string): string {
    return `${submissionPath}/${PUBLISH_CONFIG.submissionCsvFileName}`;
}

export function submissionRequestPath(submissionPath: string): string {
    return `${submissionPath}/${PUBLISH_CONFIG.submissionRequestFileName}`;
}

export function isSubmissionFilePath(filename: string | undefined): boolean {
    if (!filename) return false;
    return filename.startsWith(`${PUBLISH_CONFIG.submissionRootPath}/`);
}

export function extractSubmissionPathFromFilePath(
    filename: string | undefined,
): string | undefined {
    if (!filename || !isSubmissionFilePath(filename)) return undefined;
    const parts = filename.split("/");
    // tmp/<login>/<repo>/<file>
    if (parts.length < 4) return undefined;
    return parts.slice(0, 3).join("/");
}

/** Return whether a PR file list contains at least one new-flow submission file. */
export function hasSubmissionFiles(
    files: ReadonlyArray<{ filename?: string }>,
): boolean {
    return files.some((file) => Boolean(extractSubmissionPathFromFilePath(file.filename)));
}

export function parseSubmissionCsv(csv: string): CatalogEntry {
    const rows = csv
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (rows.length !== 2) {
        throw new Error(
            `submission CSV 必须精确包含 1 行表头和 1 行数据，当前为 ${rows.length} 行。`,
        );
    }
    if (rows[0] !== CATALOG_CSV_HEADER) {
        throw new Error("submission CSV 表头与目录表头不一致。");
    }
    const entry = parseCatalogCsv(`${rows[0]}\n${rows[1]}`)[0];
    if (!entry) throw new Error("无法解析 submission CSV 数据行。");
    return entry;
}

export function buildSubmissionCsv(entry: CatalogEntry): string {
    const normalized = normalizeCatalogEntryForCsv(entry);
    const row = serializeCatalogEntry(normalized);
    return `${CATALOG_CSV_HEADER}\n${row}`;
}

export function parseSubmissionRequestJson(raw: string): SubmissionRequest {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("request.json 不是合法 JSON。");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new Error("request.json 必须是对象。");
    }
    const value = parsed as Record<string, unknown>;
    if (value.schema_version !== 1) {
        throw new Error("request.json schema_version 必须为 1。");
    }
    if (value.mode !== "create" && value.mode !== "edit") {
        throw new Error("request.json mode 必须为 create 或 edit。");
    }
    const originalId =
        value.original_id === null ? null : String(value.original_id ?? "").trim() || null;
    const digest =
        value.base_entry_digest === null
            ? null
            : String(value.base_entry_digest ?? "").trim() || null;
    const commit =
        value.base_catalog_commit === null
            ? null
            : String(value.base_catalog_commit ?? "").trim() || null;
    if (value.mode === "edit" && (!originalId || !digest || !commit)) {
        throw new Error(
            "edit 请求必须提供 original_id、base_entry_digest、base_catalog_commit。",
        );
    }
    return {
        schema_version: 1,
        mode: value.mode,
        original_id: originalId,
        base_entry_digest: digest,
        base_catalog_commit: commit,
        client: parseSubmissionClientInfo(value.client),
    };
}

export function buildSubmissionRequest(request: SubmissionRequest): string {
    return `${JSON.stringify(request, null, 2)}\n`;
}

/** 宽松解析 client 字段：历史/脏数据降级为 "unknown" 而不抛错，避免影响冲突检测。 */
function parseSubmissionClientInfo(value: unknown): SubmissionClientInfo | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const read = (key: string): string => {
        const raw = record[key];
        const text = typeof raw === "string" ? raw.trim() : "";
        return text || "unknown";
    };
    return {
        version: read("version"),
        git_commit_hash: read("git_commit_hash"),
        build_time: read("build_time"),
        build_user: read("build_user"),
    };
}

/**
 * 采集当前客户端信息（CC 版本 + build.rs 注入的构建元信息）。
 * 非 Tauri 运行时（纯浏览器 dev）拿不到，返回 null。
 */
export async function buildClientInfo(): Promise<SubmissionClientInfo | null> {
    if (!isTauriRuntime()) return null;
    const [{ invoke }, { getVersion }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/app"),
    ]);
    const [version, info] = await Promise.all([
        getVersion(),
        invoke<{
            version: string;
            git_commit_hash: string;
            build_time: string;
            build_user: string;
        }>("app_build_info"),
    ]);
    return {
        version: version || info.version || "unknown",
        git_commit_hash: info.git_commit_hash || "unknown",
        build_time: info.build_time || "unknown",
        build_user: info.build_user || "unknown",
    };
}

export async function canonicalCatalogEntryDigest(
    entry: CatalogEntry,
): Promise<string> {
    const normalized = normalizeCatalogEntryForCsv(entry);
    const row = CATALOG_CSV_COLUMNS.map((column) => normalized[column]).join(",");
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("当前环境不支持 SHA-256，无法生成目录行摘要。");
    const bytes = new TextEncoder().encode(row);
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export async function buildCreateSubmissionRequest(
    baseCatalogCommit?: string | null,
): Promise<SubmissionRequest> {
    return {
        schema_version: 1,
        mode: "create",
        original_id: null,
        base_entry_digest: null,
        base_catalog_commit: baseCatalogCommit ?? null,
        client: await buildClientInfo(),
    };
}

export async function buildEditSubmissionRequest(params: {
    originalId: string;
    baseEntryDigest: string;
    baseCatalogCommit: string;
}): Promise<SubmissionRequest> {
    return {
        schema_version: 1,
        mode: "edit",
        original_id: params.originalId,
        base_entry_digest: params.baseEntryDigest,
        base_catalog_commit: params.baseCatalogCommit,
        client: await buildClientInfo(),
    };
}
