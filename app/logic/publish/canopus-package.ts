/**
 * 原生 Canopus 模块包（`.canopus`）读取。
 *
 * 包是未压缩的 POSIX tar（路径排序、mtime 为 0，无签名），`manifest.json` 记录模块身份、
 * ABI 和每个产物绑定的固件 target。商店条目里的 `canopus` 元数据直接取自这里，
 * 不让创作者手填：AstroBox 在安装前用它对比手环上报的固件，手环侧的回执校验是最后一道防线。
 *
 * portable 产物放在 `artifacts/abi-<major>-thumbv8m/`，只依赖 Supervisor 服务，对所有
 * 能传递服务表的固件有效，所以不列 target；其余产物绑定 `artifacts/<target_id>/`，
 * 必须逐个列出。
 */

import { validateCanopusIdFormat } from "./canopus-id";

export interface ManifestCanopusMeta {
    /** 模块 ABI 主版本。 */
    abi: number;
    /** 目标固件 id；portable 模块不写。 */
    targets?: string[];
    /** 需要的最低 Supervisor 框架修订号。 */
    minFramework?: number;
}

export interface CanopusPackageInfo {
    moduleId: string;
    version: string;
    versionCode: number;
    canopus: ManifestCanopusMeta;
}

const TAR_BLOCK = 512;
const PORTABLE_ARTIFACT = /^artifacts\/abi-(\d+)-thumbv8m\/module\.elf$/;
const TARGET_ID = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_U32 = 0xffffffff;

function field(bytes: Uint8Array, offset: number, length: number): string {
    const slice = bytes.subarray(offset, offset + length);
    const end = slice.indexOf(0);
    return new TextDecoder().decode(end < 0 ? slice : slice.subarray(0, end));
}

/** ustar 魔数在 257..262；`.canopus` 与其他包体（zip、表盘 bin）靠它区分。 */
export function isTarArchive(bytes: Uint8Array): boolean {
    return bytes.length >= TAR_BLOCK && field(bytes, 257, 5) === "ustar";
}

function readManifestEntry(bytes: Uint8Array): Uint8Array {
    let offset = 0;
    while (offset + TAR_BLOCK <= bytes.length) {
        const header = bytes.subarray(offset, offset + TAR_BLOCK);
        if (header.every((b) => b === 0)) break;
        const prefix = field(header, 345, 155);
        const name = prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100);
        const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
        if (!Number.isFinite(size) || size < 0) {
            throw new Error("tar 条目大小无效");
        }
        const start = offset + TAR_BLOCK;
        if (start + size > bytes.length) {
            throw new Error("tar 已被截断");
        }
        if (name === "manifest.json") {
            return bytes.subarray(start, start + size);
        }
        offset = start + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    }
    throw new Error("包内没有 manifest.json");
}

interface TarEntry {
    name: string;
    bytes: Uint8Array;
    mode: number;
    mtime: number;
}

/** 读出 tar 的全部普通文件条目，供改写时原样保留未修改的条目。 */
export function readCanopusTarEntries(bytes: Uint8Array): TarEntry[] {
    if (!isTarArchive(bytes)) throw new Error("不是有效的 .canopus 包：缺少 tar 头");
    const entries: TarEntry[] = [];
    const names = new Set<string>();
    let offset = 0;
    while (offset + TAR_BLOCK <= bytes.length) {
        const header = bytes.subarray(offset, offset + TAR_BLOCK);
        if (header.every((b) => b === 0)) break;
        const type = header[156];
        if (type !== 0 && type !== 0x30) {
            if (type === 0x4c || type === 0x4b || type === 0x78) {
                throw new Error("暂不支持带 GNU 长名 / PAX 扩展的 .canopus 包改写");
            }
            throw new Error("包内存在非普通文件条目，无法改写");
        }
        const prefix = field(header, 345, 155);
        const name = prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100);
        const rawSize = field(header, 124, 12).trim();
        const size = rawSize === "" ? 0 : Number.parseInt(rawSize, 8);
        if (!Number.isFinite(size) || size < 0) {
            throw new Error(`tar 条目 ${name} 的大小无效`);
        }
        const start = offset + TAR_BLOCK;
        if (start + size > bytes.length) {
            throw new Error("tar 已被截断");
        }
        if (names.has(name)) throw new Error(`tar 条目 ${name} 出现了多次`);
        names.add(name);
        const rawMode = field(header, 100, 8).trim();
        const rawMtime = field(header, 136, 12).trim();
        entries.push({
            name,
            bytes: bytes.subarray(start, start + size),
            mode: rawMode === "" ? 0o644 : Number.parseInt(rawMode, 8),
            mtime: rawMtime === "" ? 0 : Number.parseInt(rawMtime, 8),
        });
        offset = start + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    }
    return entries;
}

function octal(value: number, width: number): string {
    return value.toString(8).padStart(width - 1, "0") + "\0";
}

function encodeTarName(name: string): { name: string; prefix: string } {
    const encoder = new TextEncoder();
    if (encoder.encode(name).length <= 100) return { name, prefix: "" };
    for (let i = name.length - 1; i > 0; i -= 1) {
        if (name[i] !== "/") continue;
        const prefix = name.slice(0, i);
        const leaf = name.slice(i + 1);
        if (
            encoder.encode(prefix).length <= 155 &&
            encoder.encode(leaf).length <= 100
        ) {
            return { name: leaf, prefix };
        }
    }
    throw new Error(`tar 条目路径过长，无法改写：${name}`);
}

/** 按原条目顺序重写 tar；未修改的条目内容逐字节保留。 */
function writeCanopusTarEntries(entries: TarEntry[]): Uint8Array {
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    for (const entry of entries) {
        const header = new Uint8Array(TAR_BLOCK);
        const { name, prefix } = encodeTarName(entry.name);
        header.set(encoder.encode(name), 0);
        header.set(encoder.encode(octal(entry.mode, 8)), 100);
        header.set(encoder.encode(octal(0, 8)), 108);
        header.set(encoder.encode(octal(0, 8)), 116);
        header.set(encoder.encode(octal(entry.bytes.length, 12)), 124);
        header.set(encoder.encode(octal(entry.mtime, 12)), 136);
        header.set(encoder.encode("        "), 148);
        header[156] = 0x30;
        header.set(encoder.encode("ustar\0" + "00"), 257);
        if (prefix) header.set(encoder.encode(prefix), 345);
        let sum = 0;
        for (const byte of header) sum += byte;
        header.set(encoder.encode(octal(sum, 7) + " "), 148);
        parts.push(
            header,
            entry.bytes,
            new Uint8Array((TAR_BLOCK - (entry.bytes.length % TAR_BLOCK)) % TAR_BLOCK),
        );
    }
    parts.push(new Uint8Array(TAR_BLOCK * 2));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function readU32(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] |
            (bytes[offset + 1] << 8) |
            (bytes[offset + 2] << 16) |
            (bytes[offset + 3] << 24)) >>>
        0
    );
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error("当前环境不支持 SHA-256，无法改写 .canopus 包");
    }
    const digest = await subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}

function integer(value: unknown, what: string, max = MAX_U32): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
        throw new Error(`${what} 必须是 0..${max} 的整数`);
    }
    return value;
}

/** 解析并校验 `.canopus` 包的清单，返回商店条目需要的信息。不合法时抛出带原因的错误。 */
export function readCanopusPackage(bytes: Uint8Array): CanopusPackageInfo {
    let manifest: Record<string, unknown>;
    try {
        manifest = JSON.parse(new TextDecoder().decode(readManifestEntry(bytes)));
    } catch (error) {
        throw new Error(
            `不是有效的 .canopus 包：${error instanceof Error ? error.message : String(error)}`,
        );
    }
    const moduleId = String(manifest.module_id ?? "");
    const idError = validateCanopusIdFormat(moduleId);
    if (idError) throw new Error(`包内模块 ID「${moduleId}」不合法：${idError}`);
    const version = String(manifest.version ?? "");
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`包内版本「${version}」不是 major.minor.patch`);
    }
    const versionCode = integer(manifest.version_code, "version_code");
    if (versionCode === 0) throw new Error("version_code 必须大于 0");

    const abi = Number(manifest.canopus_abi);
    if (!Number.isInteger(abi) || abi < 1) {
        throw new Error(`canopus_abi「${String(manifest.canopus_abi)}」不是正整数`);
    }
    const artifacts = manifest.artifacts;
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
        throw new Error("包内没有任何产物");
    }
    const targets: string[] = [];
    let portable = 0;
    for (const raw of artifacts) {
        const artifact = raw as { target_id?: unknown; path?: unknown };
        const path = String(artifact.path ?? "");
        const targetId = String(artifact.target_id ?? "");
        if (!TARGET_ID.test(targetId)) {
            throw new Error(`产物 target_id「${targetId}」不合法`);
        }
        if (targets.includes(targetId)) {
            throw new Error(`target「${targetId}」出现了多次`);
        }
        targets.push(targetId);
        const match = PORTABLE_ARTIFACT.exec(path);
        if (match) {
            if (Number(match[1]) !== abi) {
                throw new Error(`portable 产物路径 ${path} 与 canopus_abi ${abi} 不一致`);
            }
            portable += 1;
        } else if (path !== `artifacts/${targetId}/module.elf`) {
            throw new Error(`产物路径 ${path} 与 target「${targetId}」不对应`);
        }
    }
    if (portable !== 0 && portable !== targets.length) {
        throw new Error("同一个包不能混合 portable 与绑定固件的产物");
    }
    return {
        moduleId,
        version,
        versionCode,
        canopus: portable ? { abi } : { abi, targets: [...targets].sort() },
    };
}

const RECEIPT_SIZE = 176;
const RECEIPT_MODULE_VERSION_OFFSET = 20;
const SIGNATURE_ENTRY = "signature.ed25519";

const CANOPUS_SIGNED_REASON =
    ".canopus 包带签名，改动包内字节会让签名失效，不能在控制台内改写版本。" +
    "请用 canopus 构建工具链重新打包后再导入。";

const CANOPUS_RECEIPT_REASON =
    ".canopus 包的安装回执不完整，无法在控制台内改写版本。" +
    "请用 canopus package 重新打包后再导入。";

/**
 * 返回阻止在控制台内改写 `.canopus` 版本的原因；可改写时返回 null。
 *
 * 与 rpk 不同，.canopus 包本身没有包级签名；真正绑定版本的是每个产物的
 * 安装回执（+20 的 module_version）。因此判断可写性时只看两件事：包是否被
 * 签名，以及每个产物是否都带完整、可校验的回执。
 */
export function canopusPackageWriteBlocker(bytes: Uint8Array): string | null {
    let entries: TarEntry[];
    try {
        entries = readCanopusTarEntries(bytes);
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
    if (!manifestEntry) return "包内没有 manifest.json";
    let manifest: Record<string, unknown>;
    try {
        const parsed = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return "manifest.json 不是对象";
        }
        manifest = parsed as Record<string, unknown>;
    } catch {
        return "manifest.json 不是有效 JSON";
    }
    if (
        entries.some((entry) => entry.name === SIGNATURE_ENTRY) ||
        (manifest.signature !== undefined && manifest.signature !== null)
    ) {
        return CANOPUS_SIGNED_REASON;
    }
    const artifacts = manifest.artifacts;
    if (!Array.isArray(artifacts)) return "manifest.json 中没有产物列表";
    const versionCode = manifest.version_code;
    if (typeof versionCode !== "number" || !Number.isInteger(versionCode)) {
        return CANOPUS_RECEIPT_REASON;
    }
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    for (const raw of artifacts) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return "manifest.json 中的产物条目无效";
        }
        const artifact = raw as Record<string, unknown>;
        const receiptPath = artifact.receipt_path;
        const receiptSha = artifact.receipt_sha256;
        if (typeof receiptPath !== "string" || typeof receiptSha !== "string") {
            return CANOPUS_RECEIPT_REASON;
        }
        const receipt = byName.get(receiptPath);
        if (!receipt) return `包内缺少安装回执 ${receiptPath}`;
        if (receipt.bytes.length !== RECEIPT_SIZE) {
            return `安装回执 ${receiptPath} 大小不是 ${RECEIPT_SIZE} 字节`;
        }
        if (readU32(receipt.bytes, RECEIPT_MODULE_VERSION_OFFSET) !== versionCode) {
            return `安装回执 ${receiptPath} 的 module_version 与 manifest.version_code 不一致`;
        }
    }
    return null;
}

export interface CanopusPackageVersionPatch {
    version: string;
    versionCode: number;
}

/**
 * 改写 `.canopus` 包的展示版本与 versionCode，返回新的 tar 字节。
 *
 * 必须同时改三处，缺一处 AstroBox-NG 的 `prepare_install` 就会拒装：
 * - manifest.json 的 `version` / `version_code`（`build_generation` 若原值等于
 *   旧 version_code，也同步成新值）；
 * - 每个产物安装回执 +20 的 `module_version`；
 * - manifest.artifacts[].receipt_sha256。
 *
 * 产物 ELF、资源文件和 module_id 都不动。包带签名或回执不完整时抛错，
 * 不做半套改写。
 */
export async function rewriteCanopusPackage(
    bytes: Uint8Array,
    patch: CanopusPackageVersionPatch,
): Promise<Uint8Array> {
    if (!/^\d+\.\d+\.\d+$/.test(patch.version)) {
        throw new Error("包内版本必须是 major.minor.patch");
    }
    if (
        !Number.isInteger(patch.versionCode) ||
        patch.versionCode <= 0 ||
        patch.versionCode > MAX_U32
    ) {
        throw new Error(`version_code 必须是 1..${MAX_U32} 的整数`);
    }
    const blocker = canopusPackageWriteBlocker(bytes);
    if (blocker) throw new Error(blocker);

    const entries = readCanopusTarEntries(bytes);
    const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
    if (!manifestEntry) throw new Error("包内没有 manifest.json");
    const manifest = JSON.parse(
        new TextDecoder().decode(manifestEntry.bytes),
    ) as Record<string, unknown>;
    const oldVersionCode = Number(manifest.version_code);

    manifest.version = patch.version;
    manifest.version_code = patch.versionCode;
    if (manifest.build_generation === oldVersionCode) {
        manifest.build_generation = patch.versionCode;
    }

    const artifacts = manifest.artifacts;
    if (!Array.isArray(artifacts)) throw new Error("manifest.json 中没有产物列表");
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const rewrittenReceipts = new Map<string, Uint8Array>();
    for (const raw of artifacts) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error("manifest.json 中的产物条目无效");
        }
        const artifact = raw as Record<string, unknown>;
        const receiptPath = String(artifact.receipt_path ?? "");
        const receiptEntry = byName.get(receiptPath);
        if (!receiptEntry) throw new Error(`包内缺少安装回执 ${receiptPath}`);
        let receipt = rewrittenReceipts.get(receiptPath);
        if (!receipt) {
            receipt = new Uint8Array(receiptEntry.bytes);
            if (receipt.length !== RECEIPT_SIZE) {
                throw new Error(`安装回执 ${receiptPath} 大小不是 ${RECEIPT_SIZE} 字节`);
            }
            writeU32(receipt, RECEIPT_MODULE_VERSION_OFFSET, patch.versionCode);
            rewrittenReceipts.set(receiptPath, receipt);
            receiptEntry.bytes = receipt;
        }
        artifact.receipt_sha256 = await sha256Hex(receipt);
    }

    manifestEntry.bytes = new TextEncoder().encode(
        JSON.stringify(manifest, null, 2),
    );
    const rewritten = writeCanopusTarEntries(entries);
    const check = readCanopusPackage(rewritten);
    if (
        check.version !== patch.version ||
        check.versionCode !== patch.versionCode
    ) {
        throw new Error("改写后的 .canopus 包校验失败");
    }
    return rewritten;
}

export interface CanopusEntryClaim {
    device: string;
    version?: string;
    versionCode?: number;
    canopus?: ManifestCanopusMeta;
}

/**
 * 商店条目声明与包体清单不一致的地方。条目的 `canopus` 元数据是 AstroBox 安装前
 * 唯一的兼容性依据，所以发布者填的和包里实际的必须逐项相符；`minFramework` 只能由
 * 发布者声明，包内没有对应字段，不参与比较。
 */
export function canopusEntryProblems(
    bytes: Uint8Array,
    resourceId: string,
    claims: CanopusEntryClaim[],
): string[] {
    let info: CanopusPackageInfo;
    try {
        info = readCanopusPackage(bytes);
    } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
    }
    const problems: string[] = [];
    if (resourceId && info.moduleId !== resourceId) {
        problems.push(`包内模块 ID「${info.moduleId}」与资源 ID「${resourceId}」不一致`);
    }
    for (const claim of claims) {
        const where = `设备 ${claim.device}`;
        if (!claim.canopus) {
            problems.push(`${where} 的下载项缺少 canopus 元数据`);
            continue;
        }
        if (claim.canopus.abi !== info.canopus.abi) {
            problems.push(
                `${where} 声明 ABI ${claim.canopus.abi}，包内是 ${info.canopus.abi}`,
            );
        }
        const declared = [...(claim.canopus.targets ?? [])].sort().join(",");
        const actual = (info.canopus.targets ?? []).join(",");
        if (declared !== actual) {
            problems.push(
                `${where} 声明的 target（${declared || "portable"}）与包内（${actual || "portable"}）不一致`,
            );
        }
        const min = claim.canopus.minFramework;
        if (min !== undefined && (!Number.isInteger(min) || min < 0 || min > MAX_U32)) {
            problems.push(`${where} 的 minFramework 必须是 0..${MAX_U32} 的整数`);
        }
        if (claim.versionCode !== info.versionCode) {
            problems.push(
                `${where} 声明 versionCode ${claim.versionCode ?? "(无)"}，包内是 ${info.versionCode}`,
            );
        }
        if (claim.version !== info.version) {
            problems.push(`${where} 声明版本 ${claim.version ?? "(无)"}，包内是 ${info.version}`);
        }
    }
    return problems;
}
