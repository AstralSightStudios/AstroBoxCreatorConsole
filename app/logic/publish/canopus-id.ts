export function validateCanopusIdFormat(id: string): string | null {
    const trimmed = id.trim();
    if (!trimmed) {
        return "请填写模块名称";
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) {
        return "模块名称仅支持字母、数字、下划线和中划线";
    }
    return null;
}