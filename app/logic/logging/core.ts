/**
 * 日志核心管道（参考 slf4j/pino facade 模式 + AstroBox-NG 的落盘方案）：
 *
 *   任意来源（console 劫持 / 全局错误 / 网络拦截 / 业务显式调用）
 *     → 级别过滤 → 脱敏(redactText/sanitizeData) → 单行格式化（防日志注入）
 *     → GlobalSink：invoke frontend_log，Rust 端统一打时间戳落盘
 *     → SessionSink：发布/编辑会话激活期间镜像到 resource/ 会话文件（批量）
 *
 * 所有路径 fire-and-forget：日志失败绝不影响业务运行。
 */
import { invoke } from "@tauri-apps/api/core";
import { redactText, sanitizeData } from "./mask";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

const LEVEL_STORAGE_KEY = "ABCC_LOG_LEVEL_V1";
const SESSION_FLUSH_INTERVAL_MS = 500;
const SESSION_FLUSH_BATCH = 10;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_LINE_LENGTH = 16_000;

function defaultLevel(): LogLevel {
  return import.meta.env.DEV ? "debug" : "info";
}

function loadLevel(): LogLevel {
  try {
    const stored = localStorage.getItem(LEVEL_STORAGE_KEY);
    if (stored && stored in LEVEL_WEIGHT) return stored as LogLevel;
  } catch {
    /* localStorage 不可用时使用默认级别 */
  }
  return defaultLevel();
}

let currentLevel: LogLevel = loadLevel();

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function setLogLevel(level: LogLevel): void {
  if (!(level in LEVEL_WEIGHT)) return;
  currentLevel = level;
  try {
    localStorage.setItem(LEVEL_STORAGE_KEY, level);
  } catch {
    /* 忽略持久化失败 */
  }
}

export interface SessionSink {
  write(lines: string[]): void;
}

let sessionSink: SessionSink | null = null;

/** 由 publish-flow 会话模块注册；置 null 即停止镜像。 */
export function setSessionSink(sink: SessionSink | null): void {
  sessionSink = sink;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`
  );
}

/** 单行化：CR/LF 转义为字面量，防止日志注入与断行。 */
function toSingleLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\r\n\t]+/g, (match) =>
    match.includes("\r")
      ? "\\r"
      : match.includes("\n")
        ? "\\n"
        : match.includes("\t")
          ? "\\t"
          : " ",
  );
}

let pendingLines: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingSync(): void {
  if (!pendingLines.length || !sessionSink) return;
  const lines = pendingLines;
  pendingLines = [];
  try {
    sessionSink.write(lines);
  } catch {
    /* 会话写入失败不影响全局日志 */
  }
}

/** 立即把缓冲中的会话日志行交给 SessionSink（用于会话收尾前保证顺序）。 */
export function flushSessionLines(): void {
  flushPendingSync();
}

// 页面隐藏/关闭前尽力刷出未落盘的会话日志。
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingSync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingSync();
  });
}

export interface LogOptions {
  /** 结构化附加数据；敏感字段会被自动脱敏。 */
  data?: unknown;
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  options?: LogOptions,
): void {
  try {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel]) return;

    const safeScope =
      scope.replace(/[^\w./:-]+/g, "-").replace(/^-+|-+$/g, "") || "app";
    const cleanMessage = toSingleLine(
      redactText(String(message ?? "")).slice(0, MAX_MESSAGE_LENGTH),
    );

    let dataJson: string | undefined;
    if (options?.data !== undefined) {
      dataJson = JSON.stringify(sanitizeData(options.data));
      if (dataJson.length > MAX_LINE_LENGTH - cleanMessage.length) {
        dataJson = `${dataJson.slice(0, Math.max(0, MAX_LINE_LENGTH - cleanMessage.length))}…"`;
      }
    }

    // GlobalSink：立即发送，时间戳由 Rust 端统一生成。
    if (isTauriRuntime()) {
      const globalMessage = dataJson ? `${cleanMessage} | ${dataJson}` : cleanMessage;
      void invoke("frontend_log", {
        level,
        target: safeScope,
        message: globalMessage,
      }).catch(() => {});
    }

    // SessionSink：带本地毫秒级时间戳的完整行，批量写入会话文件。
    if (sessionSink && pendingLines.length < 5_000) {
      const ts = formatTimestamp(new Date());
      pendingLines.push(
        dataJson
          ? `[${ts}][${LEVEL_LABEL[level]}][${safeScope}] ${cleanMessage} | ${dataJson}`
          : `[${ts}][${LEVEL_LABEL[level]}][${safeScope}] ${cleanMessage}`,
      );
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushPendingSync();
        }, SESSION_FLUSH_INTERVAL_MS);
      }
      if (pendingLines.length >= SESSION_FLUSH_BATCH) {
        clearTimeout(flushTimer);
        flushTimer = null;
        flushPendingSync();
      }
    }
  } catch {
    /* 日志永不抛错 */
  }
}

export interface Logger {
  trace(scope: string, message: string, options?: LogOptions): void;
  debug(scope: string, message: string, options?: LogOptions): void;
  info(scope: string, message: string, options?: LogOptions): void;
  warn(scope: string, message: string, options?: LogOptions): void;
  error(scope: string, message: string, options?: LogOptions): void;
}

export const log: Logger = {
  trace: (scope, message, options) => emit("trace", scope, message, options),
  debug: (scope, message, options) => emit("debug", scope, message, options),
  info: (scope, message, options) => emit("info", scope, message, options),
  warn: (scope, message, options) => emit("warn", scope, message, options),
  error: (scope, message, options) => emit("error", scope, message, options),
};
