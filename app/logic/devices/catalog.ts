export interface DeviceOption {
    id: string;
    name: string;
    vendor?: string;
}

const DEVICES_URL =
    "https://raw.githubusercontent.com/AstralSightStudios/AstroBox-Repo/refs/heads/main/devices_v2.json";

type DevicesPayload = Record<string, Record<string, { id: string; name: string }>>;

let cachedDeviceOptions: DeviceOption[] | null = null;
let loadingPromise: Promise<DeviceOption[]> | null = null;

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

export async function loadDeviceOptions() {
    if (cachedDeviceOptions) {
        return cachedDeviceOptions;
    }
    if (loadingPromise) {
        return loadingPromise;
    }

    loadingPromise = (async () => {
        const response = await fetch(DEVICES_URL);
        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }
        const payload = (await response.json()) as DevicesPayload;
        const options = parseDeviceOptions(payload);
        if (options.length === 0) {
            throw new Error("设备列表为空");
        }
        cachedDeviceOptions = options;
        return options;
    })();

    try {
        return await loadingPromise;
    } finally {
        loadingPromise = null;
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
