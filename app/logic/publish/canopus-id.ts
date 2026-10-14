// Canopus module id (ADR-CAN-003): also the quick-app package suffix
// (com.canopus.pkg.<id>), the install receipt module id and the on-band token.
export function validateCanopusIdFormat(id: string): string | null {
    const trimmed = id.trim();
    if (!trimmed) {
        return "请填写模块名称";
    }
    if (!/^[a-z][a-z0-9_]{0,15}$/.test(trimmed)) {
        return "模块名称仅支持小写字母开头的小写字母、数字和下划线，最长 16 个字符";
    }
    return null;
}
