export const CANOPUS_ID_PREFIX = "canopus_";

export function normalizeCanopusIdInput(value: string): string {
    const next = value.trim();
    if (!next) return CANOPUS_ID_PREFIX;
    if (next.startsWith(CANOPUS_ID_PREFIX)) return next;
    if (CANOPUS_ID_PREFIX.startsWith(next)) return next;
    return CANOPUS_ID_PREFIX + next;
}

export function validateCanopusIdFormat(id: string): string | null {
    if (!id.startsWith(CANOPUS_ID_PREFIX)) {
        return `模块 ID 必须以 ${CANOPUS_ID_PREFIX} 开头`;
    }
    const rest = id.slice(CANOPUS_ID_PREFIX.length);
    if (!rest) {
        return "请在前缀后填写模块名称";
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(rest)) {
        return "模块名称仅支持字母、数字、下划线和中划线";
    }
    return null;
}
