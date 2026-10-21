import { FlaskIcon, UserIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "~/api/astrobox/request";
import { resolveBetaUrl, type BetaProfile } from "~/api/astrobox/beta";
import { loadDeviceOptions, type DeviceOption } from "~/logic/devices/catalog";

export const BETA_CARD_CLASS = "!border-0 bg-nav-item";

export function describeBetaError(error: unknown, fallback = "操作失败") {
    if (error instanceof ApiError) {
        if (error.status === 402) return "测试分发需要 CreatorPlus 或更高级会员";
        return error.message || fallback;
    }
    return error instanceof Error ? error.message : fallback;
}

export function formatDateTime(value?: string | null) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
}

export function formatRelative(value?: string | null) {
    if (!value) return "--";
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return value;
    const diff = Date.now() - time;
    const minute = 60_000;
    if (diff < minute) return "刚刚";
    if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
    if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
    if (diff < 30 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
    return formatDateTime(value);
}

export function daysUntil(value?: string | null) {
    if (!value) return null;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return null;
    return Math.ceil((time - Date.now()) / (24 * 3600 * 1000));
}

export function ProgramIcon({ src, size = 44 }: { src: string | null; size?: number }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);
    return (
        <div
            className="flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-white/10 bg-white/5"
            style={{ width: size, height: size }}
        >
            {src && !failed ? (
                <img
                    src={resolveBetaUrl(src)}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() => setFailed(true)}
                />
            ) : (
                <FlaskIcon size={size * 0.5} weight="duotone" className="text-purple-200/80" />
            )}
        </div>
    );
}

export function Avatar({ profile, size = 28 }: { profile: Pick<BetaProfile, "avatar">; size?: number }) {
    const [failed, setFailed] = useState(false);
    return (
        <div
            className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10"
            style={{ width: size, height: size }}
        >
            {profile.avatar && !failed ? (
                <img src={profile.avatar} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
            ) : (
                <UserIcon size={size * 0.55} className="text-white/60" />
            )}
        </div>
    );
}

export function displayNameOf(profile: BetaProfile) {
    return profile.displayName?.trim() || profile.userId;
}

/** 官方设备库（devices_v2.json），把设备 ID 映射成名称。 */
export function useDeviceCatalog() {
    const [options, setOptions] = useState<DeviceOption[]>([]);
    const [error, setError] = useState("");
    useEffect(() => {
        let alive = true;
        loadDeviceOptions()
            .then((loaded) => {
                if (alive) setOptions(loaded);
            })
            .catch((err) => {
                if (alive) setError(err instanceof Error ? err.message : String(err));
            });
        return () => {
            alive = false;
        };
    }, []);
    const nameOf = useMemo(() => {
        const map = new Map(options.map((option) => [option.id, option.name]));
        return (id: string) => map.get(id) ?? id;
    }, [options]);
    return { options, error, nameOf };
}
