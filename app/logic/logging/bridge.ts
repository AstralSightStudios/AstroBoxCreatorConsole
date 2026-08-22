/**
 * 前端日志桥（参考 AstroBox-NG frontendLogBridge）：
 * - 劫持 console 全部输出方法，浏览器控制台里能看到的一切都会进入日志文件
 * - 捕获 window.onerror / unhandledrejection 等全局未处理错误
 * 仅在 Tauri 运行时激活；在 main.tsx 顶部 import 即生效。
 */
import { log } from "./core";

type ConsoleMethod = "debug" | "log" | "info" | "warn" | "error";

const METHOD_TO_LEVEL: Record<ConsoleMethod, "debug" | "info" | "warn" | "error"> = {
  debug: "debug",
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
};

function serializeArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`;
  if (typeof arg === "bigint") return `${arg}n`;
  if (arg === undefined) return "undefined";
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(arg, (_key, value: unknown) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value as object)) return "[Circular]";
        seen.add(value as object);
      }
      if (typeof value === "bigint") return `${value}n`;
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      return value;
    });
  } catch {
    return String(arg);
  }
}

let installed = false;

export function installFrontendLogBridge(): void {
  if (installed || typeof window === "undefined") return;
  if (!("__TAURI_INTERNALS__" in window)) return;
  installed = true;

  const original: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
  for (const method of Object.keys(METHOD_TO_LEVEL) as ConsoleMethod[]) {
    const native = console[method]?.bind(console);
    original[method] = native;
    console[method] = (...args: unknown[]) => {
      try {
        const text = args.map(serializeArg).join(" ");
        log[METHOD_TO_LEVEL[method]](`console/${method}`, `[console.${method}] ${text}`);
      } catch {
        /* 桥接失败不影响原始输出 */
      }
      native?.(...args);
    };
  }

  // console.debug 与 console.log 在多数实现中同级别；单独保留 trace 语义。
  const nativeTrace = typeof console.trace === "function" ? console.trace.bind(console) : null;
  console.trace = (...args: unknown[]) => {
    try {
      log.debug(
        "console/trace",
        `[console.trace] ${args.map(serializeArg).join(" ")}`,
        { data: new Error("trace").stack },
      );
    } catch {
      /* 忽略 */
    }
    nativeTrace?.(...args);
  };

  window.addEventListener("error", (event) => {
    const detail =
      event.error ?? (event.message ? new Error(event.message) : new Error("未知脚本错误"));
    log.error("window/error", `未捕获异常: ${event.message ?? String(detail)}`, {
      data: { stack: detail instanceof Error ? detail.stack : undefined, filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    log.error("window/rejection", `未处理的 Promise 拒绝: ${String(reason)}`, {
      data:
        reason instanceof Error
          ? { name: reason.name, message: reason.message, stack: reason.stack }
          : { reason: String(reason) },
    });
  });
}
