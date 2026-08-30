import { loadRepoEnv } from "~/config/repoEnv";
import { getRepoFile } from "~/logic/publish/github-actions";
import type { RepoInfo } from "~/logic/publish/github-actions";
import { fetchDeviceJsonViaCdn } from "./device-json-cdn";

export interface DeviceOption {
    id: string;
    name: string;
    vendor?: string;
    aliases?: string[];
}

/** 设备选项显示名只使用设备名称，不拼接厂商字段。 */
export function getDeviceDisplayName(
    option?: Pick<DeviceOption, "name" | "vendor">,
): string {
    const name = option?.name?.trim();
    return name || "";
}

type DevicesPayload = Record<string, Record<string, { id: string; name: string }>>;

const DEVICES_FILE_PATH = "devices_v2.json";

const optionsCache = new Map<string, DeviceOption[]>();
const payloadCache = new Map<string, DevicesPayload>();
const inflight = new Map<string, Promise<DeviceOption[]>>();

function parseDeviceOptions(payload: DevicesPayload): DeviceOption[] {
    const map = new Map<string, DeviceOption>();
    Object.entries(payload).forEach(([vendor, devices]) => {
        Object.entries(devices).forEach(([modelNumber, device]) => {
            const current = map.get(device.id);
            if (current) {
                if (modelNumber && !current.aliases?.includes(modelNumber)) {
                    current.aliases = [...(current.aliases ?? []), modelNumber];
                }
                return;
            }
            map.set(device.id, {
                id: device.id,
                name: device.name || device.id,
                vendor,
                aliases: modelNumber ? [modelNumber] : [],
            });
        });
    });

    return Array.from(map.values());
}

function decodeBase64(content?: string) {
    if (!content) return "";
    return new TextDecoder().decode(
        Uint8Array.from(atob(content), (c) => c.charCodeAt(0)),
    );
}

export async function loadDeviceOptions() {
    const env = loadRepoEnv();
    const cacheKey = `devices:${env.id}`;
    const cached = optionsCache.get(cacheKey);
    if (cached) return cached;

    const pending = inflight.get(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
        const payload = await loadDevicesPayload(env.owner, env.repoName, env.defaultBranch, cacheKey);
        const options = parseDeviceOptions(payload);
        if (options.length === 0) {
            throw new Error("设备列表为空");
        }
        optionsCache.set(cacheKey, options);
        return options;
    })();

    inflight.set(cacheKey, promise);
    try {
        return await promise;
    } finally {
        inflight.delete(cacheKey);
    }
}

async function loadDevicesPayload(
    owner: string,
    repoName: string,
    defaultBranch: string,
    cacheKey: string,
): Promise<DevicesPayload> {
    const cachedPayload = payloadCache.get(cacheKey);
    if (cachedPayload) return cachedPayload;

    const repo: RepoInfo = {
        owner,
        name: repoName,
        branch: defaultBranch,
    };
    let payload: DevicesPayload;
    try {
        // 公开仓库走 CDN 链（jsDelivr → GitHub raw → 前缀代理镜像），无需登录且更快。
        payload = await fetchDeviceJsonViaCdn<DevicesPayload>(
            owner,
            repoName,
            defaultBranch,
            DEVICES_FILE_PATH,
        );
    } catch {
        // CDN 链全部失败（私有仓库 / 全部源不可达）时回退到带鉴权的 Contents API。
        const response = await getRepoFile({
            repo,
            path: DEVICES_FILE_PATH,
            ref: defaultBranch,
        });
        payload = JSON.parse(decodeBase64(response.content)) as DevicesPayload;
    }
    payloadCache.set(cacheKey, payload);
    return payload;
}

/**
 * 设备令牌（manifest downloads 的 key 可能是机型号如 M2345B1，也可能是
 * 规范化 id 如 xmb9）解析为规范化 id。devices_v2.json 的结构为
 * vendor -> {机型号 -> {id, name}}，这里把机型号与 id 都映射到 id。
 */
export type DeviceTokenResolver = (token: string) => string | undefined;

export async function loadDeviceTokenResolver(): Promise<DeviceTokenResolver> {
    const env = loadRepoEnv();
    const cacheKey = `devices:${env.id}`;
    const payload = await loadDevicesPayload(env.owner, env.repoName, env.defaultBranch, cacheKey);

    const tokenToCanonical = new Map<string, string>();
    for (const devices of Object.values(payload)) {
        for (const [modelNumber, device] of Object.entries(devices)) {
            const canonicalId = device.id;
            if (!canonicalId) continue;
            tokenToCanonical.set(modelNumber.toLowerCase(), canonicalId);
            tokenToCanonical.set(canonicalId.toLowerCase(), canonicalId);
        }
    }

    return (token: string) => {
        const normalized = token.trim().toLowerCase();
        if (!normalized) return undefined;
        return tokenToCanonical.get(normalized);
    };
}

export async function loadDeviceNameMap() {
    const options = await loadDeviceOptions();
    return new Map(options.map((option) => [option.id, option.name]));
}

export function resolveDeviceName(
    deviceNameMap: Map<string, string>,
    rawName: string,
    rawId?: string,
) {
    if (rawId && deviceNameMap.has(rawId)) {
        return deviceNameMap.get(rawId)!;
    }
    return deviceNameMap.get(rawName) || rawName;
}
