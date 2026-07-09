import { loadRepoEnv } from "~/config/repoEnv";
import { getRepoFile } from "~/logic/publish/github-actions";
import type { RepoInfo } from "~/logic/publish/github-actions";

export interface DeviceOption {
    id: string;
    name: string;
    vendor?: string;
}

type DevicesPayload = Record<string, Record<string, { id: string; name: string }>>;

const optionsCache = new Map<string, DeviceOption[]>();
const payloadCache = new Map<string, DevicesPayload>();
const inflight = new Map<string, Promise<DeviceOption[]>>();

function parseDeviceOptions(payload: DevicesPayload): DeviceOption[] {
    const map = new Map<string, DeviceOption>();
    Object.entries(payload).forEach(([vendor, devices]) => {
        Object.values(devices).forEach((device) => {
            if (!map.has(device.id)) {
                map.set(device.id, {
                    id: device.id,
                    name: device.name || device.id,
                    vendor,
                });
            }
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
    const response = await getRepoFile({
        repo,
        path: "devices_v2.json",
        ref: defaultBranch,
    });
    const raw = decodeBase64(response.content);
    const payload = JSON.parse(raw) as DevicesPayload;
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
