import { loadRepoEnv } from "~/config/repoEnv";
import { getRepoFile } from "~/logic/publish/github-actions";
import type { RepoInfo } from "~/logic/publish/github-actions";

export interface DeviceOption {
    id: string;
    name: string;
    vendor?: string;
}

type DevicesPayload = Record<string, Record<string, { id: string; name: string }>>;

const cache = new Map<string, DeviceOption[]>();
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
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const pending = inflight.get(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
        const repo: RepoInfo = {
            owner: env.owner,
            name: env.repoName,
            branch: env.defaultBranch,
        };
        const response = await getRepoFile({
            repo,
            path: "devices_v2.json",
            ref: env.defaultBranch,
        });
        const raw = decodeBase64(response.content);
        const payload = JSON.parse(raw) as DevicesPayload;
        const options = parseDeviceOptions(payload);
        if (options.length === 0) {
            throw new Error("设备列表为空");
        }
        cache.set(cacheKey, options);
        return options;
    })();

    inflight.set(cacheKey, promise);
    try {
        return await promise;
    } finally {
        inflight.delete(cacheKey);
    }
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
