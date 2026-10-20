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
