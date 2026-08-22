/**
 * 日志脱敏工具（行业规范：redaction 在 sink/管道层统一执行，调用方无需感知）。
 *
 * 规则：
 * - 普通敏感值（AES key 等）：保留前 4 后 4，中间打星；过短整体打码
 * - 账号凭据（token/password/authorization 等）：仅保留末 4 位
 * - 兜底正则：ghp_* / github_pat_* / Bearer xxx 无论出现在哪里都会被打码
 */

const MASKED = "****";

/** 保留前 4 后 4 的通用脱敏。 */
export function maskValue(value: string): string {
  if (!value) return "";
  const chars = [...value];
  if (chars.length <= 12) return "*".repeat(chars.length);
  const middle = "*".repeat(Math.min(chars.length - 8, 8));
  return `${chars.slice(0, 4).join("")}${middle}${chars.slice(-4).join("")}`;
}

/** 账号凭据类脱敏：仅保留末 4 位。 */
export function maskCredential(value: string): string {
  if (!value) return "";
  const chars = [...value];
  if (chars.length <= 8) return "*".repeat(chars.length);
  return `${MASKED}${chars.slice(-4).join("")}`;
}

const CREDENTIAL_KEY_PATTERN =
  /(token|secret|password|passwd|authorization|cookie|credential|session_?id)/i;
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passwd|authorization|cookie|credential|api[-_]?key|^key$|[-_]key$|^key[-_]|refresh)/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY_PATTERN.test(key);
}

const MAX_VALUE_LENGTH = 2_000;
const MAX_DEPTH = 6;

function truncate(text: string): string {
  if (text.length <= MAX_VALUE_LENGTH) return text;
  return `${text.slice(0, MAX_VALUE_LENGTH)}…(截断，原长 ${text.length})`;
}

export function redactText(text: string): string {
  return text
    .replace(/gh[posur]_[A-Za-z0-9]{16,}/g, (match) => maskValue(match))
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, (match) => maskValue(match))
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, (match) => {
      const [scheme, ...rest] = match.split(/\s+/);
      return `${scheme} ${maskCredential(rest.join(""))}`;
    });
}

function sanitizeString(key: string | null, value: string): string {
  let result = redactText(value);
  if (key) {
    if (isCredentialKey(key)) {
      // 整段值视为凭据：即便已被正则部分打码，也统一只留末 4。
      result = value.trim().length > 0 && /^[A-Za-z0-9._~+/=-]+$/.test(value.trim())
        ? maskCredential(value.trim())
        : result;
    } else if (isSensitiveKey(key)) {
      result =
        value.trim().length > 0 && /^[A-Za-z0-9._~+/=-]+$/.test(value.trim())
          ? maskValue(value.trim())
          : result;
    }
  }
  return truncate(result);
}

/** 递归遍历 data，对敏感字段名对应的字符串值做脱敏，返回可安全序列化的副本。 */
export function sanitizeData(data: unknown, depth = 0): unknown {
  if (data === null || data === undefined) return data;
  if (depth > MAX_DEPTH) return "[深度超限]";
  if (typeof data === "string") return sanitizeString(null, data);
  if (typeof data === "number" || typeof data === "boolean") return data;
  if (data instanceof Error) {
    return sanitizeData(
      { name: data.name, message: data.message, stack: data.stack },
      depth + 1,
    );
  }
  if (Array.isArray(data)) {
    return data.slice(0, 100).map((item) => sanitizeData(item, depth + 1));
  }
  if (typeof data === "object") {
    const source = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (
        value !== null &&
        typeof value === "string" &&
        isSensitiveKey(key)
      ) {
        result[key] = sanitizeString(key, value);
      } else {
        result[key] = sanitizeData(value, depth + 1);
      }
    }
    return result;
  }
  return String(data);
}
