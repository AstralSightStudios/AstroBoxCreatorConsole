/**
 * 用户可见反馈 + 日志的统一入口（行业规范：任何未成功的操作必须有提示，
 * 不能无反应）。页面层 catch 统一走 reportFailure：用户看到简短原因，
 * 日志里保存完整错误上下文。
 */
import { toast } from "sonner";
import { log } from "./core";

export interface ReportOptions {
  /** 附加到日志的结构化数据（自动脱敏），不会展示给用户。 */
  data?: unknown;
}

function errorToData(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

/** 失败操作：toast 提示用户 + error 级日志。 */
export function reportFailure(
  scope: string,
  userMessage: string,
  error?: unknown,
  options?: ReportOptions,
): void {
  log.error(scope, `${userMessage}${error ? `: ${String(error)}` : ""}`, {
    data:
      error !== undefined
        ? { ...errorToData(error), ...(options?.data as object | undefined) }
        : options?.data,
  });
  toast.error(userMessage);
}

/** 需要用户注意的非致命问题。 */
export function reportWarning(
  scope: string,
  userMessage: string,
  options?: ReportOptions,
): void {
  log.warn(scope, userMessage, { data: options?.data });
  toast.warning(userMessage);
}

/** 成功操作：toast + info 日志，保证关键节点在两个通道都有痕迹。 */
export function reportSuccess(
  scope: string,
  userMessage: string,
  options?: ReportOptions,
): void {
  log.info(scope, userMessage, { data: options?.data });
  toast.success(userMessage);
}
