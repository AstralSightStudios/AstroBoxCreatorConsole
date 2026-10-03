import { REPO_ENVS } from "~/config/repoEnv";
import { getRepoFile } from "~/logic/publish/github-actions";
import type { RepoInfo } from "~/logic/publish/github-actions";
import { fetchDeviceJsonViaCdn } from "./device-json-cdn";

/**
 * 设备列表固定取正式环境 AstroBox-Repo，**不随发布环境开关变化**。
 *
 * 设备库是全站共享的规范化 id 表（表盘 12 位 ID、模块名称、资源包 themeId
 * 都以它为准），而 TestEnv 的 devices_v2.json 落后于正式库。若跟着环境切换，
 * 切到 TestEnv 后正式环境已上架的设备会从下拉里凭空消失，创作者配不了包体，
 * 审核端也会解析不出设备名。
 */
const DEVICE_SOURCE = REPO_ENVS.official;
const DEVICE_CACHE_KEY = `devices:${DEVICE_SOURCE.id}`;

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
    const cached = optionsCache.get(DEVICE_CACHE_KEY);
    if (cached) return cached;

    const pending = inflight.get(DEVICE_CACHE_KEY);
    if (pending) return pending;

    const promise = (async () => {
        const payload = await loadDevicesPayload();
        const options = parseDeviceOptions(payload);
        if (options.length === 0) {
            throw new Error("设备列表为空");
        }
        optionsCache.set(DEVICE_CACHE_KEY, options);
        return options;
    })();

    inflight.set(DEVICE_CACHE_KEY, promise);
    try {
        return await promise;
    } finally {
        inflight.delete(DEVICE_CACHE_KEY);
    }
}

async function loadDevicesPayload(): Promise<DevicesPayload> {
    const cachedPayload = payloadCache.get(DEVICE_CACHE_KEY);
    if (cachedPayload) return cachedPayload;

    const { owner, repoName, defaultBranch } = DEVICE_SOURCE;
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
    payloadCache.set(DEVICE_CACHE_KEY, payload);
    return payload;
}

/**
 * 设备令牌（manifest downloads 的 key 可能是机型号如 M2345B1，也可能是
 * 规范化 id 如 xmb9）解析为规范化 id。devices_v2.json 的结构为
 * vendor -> {机型号 -> {id, name}}，这里把机型号与 id 都映射到 id。
 */
export type DeviceTokenResolver = (token: string) => string | undefined;

export async function loadDeviceTokenResolver(): Promise<DeviceTokenResolver> {
    const payload = await loadDevicesPayload();

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
