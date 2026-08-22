/**
 * 资源发布/编辑流程会话日志 —— 独立模块边界（可能被整体移除）。
 *
 * 设计约束：
 * - 每次进入发布/编辑向导都新建一个会话文件（不按 PR 分文件，因为 PR 可能
 *   根本没创建成功），文件位于 `app_log_dir()/resource/`
 * - 会话激活期间，全局日志管道中的所有条目（console 输出、网络失败、业务
 *   显式打点）都会自动镜像进当前会话文件——业务代码零改动即有完整链路
 * - 移除方式：删除 publish-flow/ 目录 + 全局搜索 "publish-flow" 清理调用点
 */
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import {
  flushSessionLines,
  log,
  setSessionSink,
  type LogLevel,
} from "../core";

export type PublishFlowMode = "publish" | "edit";
export type PublishFlowOutcome =
  | "pr_created"
  | "completed"
  | "failed"
  | "abandoned"
  | "superseded";

export interface ResourceSessionMeta {
  /** 提交流程：staging / legacy */
  flow?: string;
  /** 发布仓库环境 id（official / testenv） */
  repoEnv?: string;
  itemId?: string;
  itemName?: string;
  repoOwner?: string;
  repoName?: string;
  prNumber?: number;
}

interface ActiveSession {
  fileName: string;
  mode: PublishFlowMode;
  startedAt: number;
}

let activeSession: ActiveSession | null = null;
let writeChain: Promise<void> = Promise.resolve();

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function enqueueWrite(lines: string[]): void {
  if (!activeSession) return;
  const fileName = activeSession.fileName;
  writeChain = writeChain
    .then(async () => {
      try {
        await invoke("resource_log_write", { fileName, lines });
      } catch (error) {
        // 写文件失败时退回全局日志，避免完全无痕。
        log.warn("session/write", `会话日志写入失败: ${String(error)}`);
      }
    })
    .catch(() => {});
}

async function buildHeaderLines(
  mode: PublishFlowMode,
  meta: ResourceSessionMeta,
): Promise<string[]> {
  let version = "unknown";
  try {
    version = await getVersion();
  } catch {
    /* 非 Tauri 环境 */
  }
  const separator = "=".repeat(64);
  return [
    separator,
    "AstroBox CreatorConsole 资源流程日志",
    `模式: ${mode === "edit" ? "编辑已有资源 (edit)" : "发布新资源 (publish)"}`,
    `提交流程: ${meta.flow ?? "staging"} | 仓库环境: ${meta.repoEnv ?? "-"}`,
    `资源标识: ${meta.itemId || "-"} | 名称: ${meta.itemName || "-"}`,
    meta.repoName ? `目标仓库: ${meta.repoOwner ?? "?"}/${meta.repoName}` : null,
    meta.prNumber != null ? `关联 PR: #${meta.prNumber}` : null,
    `应用版本: v${version}`,
    separator,
  ].filter((line): line is string => line !== null);
}

/**
 * 开启一个新的资源流程会话。同一模式短时间内重复调用（React StrictMode 双挂载）
 * 会复用现有会话；不同模式或超时会话会被标记 superseded 后另起新文件。
 */
export async function startResourceSession(
  mode: PublishFlowMode,
  meta: ResourceSessionMeta = {},
): Promise<string | null> {
  if (!isTauri()) return null;

  const now = Date.now();
  if (
    activeSession &&
    activeSession.mode === mode &&
    now - activeSession.startedAt < 5_000
  ) {
    return activeSession.fileName;
  }
  if (activeSession) {
    await finishResourceSession("superseded", "新的会话覆盖了未结束的旧会话");
  }

  const headerLines = await buildHeaderLines(mode, meta);
  try {
    const session = await invoke<{ fileName: string }>("resource_log_start", {
      mode,
      headerLines,
    });
    activeSession = {
      fileName: session.fileName,
      mode,
      startedAt: now,
    };
    setSessionSink({ write: enqueueWrite });
    log.info(`flow/${mode}/start`, `资源${mode === "edit" ? "编辑" : "发布"}会话开始`, {
      data: { file: session.fileName, ...meta },
    });
    return session.fileName;
  } catch (error) {
    console.warn("[session-log] 无法创建资源会话日志", error);
    return null;
  }
}

/** 记录流程里程碑事件（自动进入全局日志；会话激活时同时镜像进会话文件）。 */
export function flowStep(
  level: LogLevel,
  step: string,
  message: string,
  data?: unknown,
): void {
  log[level](`flow/${step}`, message, data === undefined ? undefined : { data });
}

/**
 * 包裹一段异步流程：自动记录开始、耗时与失败详情。
 * 失败原样向上抛出，由调用方决定用户提示。
 */
export async function flowSpan<T>(
  step: string,
  message: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  flowStep("debug", `${step}/begin`, message);
  try {
    const result = await run();
    flowStep("info", `${step}/done`, `${message} 完成`, {
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    flowStep("error", `${step}/fail`, `${message} 失败: ${String(error)}`, {
      error,
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}

/** 结束当前会话并写入结果行；之后不再镜像任何日志。 */
export async function finishResourceSession(
  outcome: PublishFlowOutcome,
  detail?: string,
): Promise<void> {
  const session = activeSession;
  if (!session) return;

  flushSessionLines();
  const ts = new Date().toLocaleString();
  const label: Record<PublishFlowOutcome, string> = {
    pr_created: "PR 已创建，会话正常完成",
    completed: "流程完成",
    failed: "流程失败",
    abandoned: "用户中途离开，流程未完成",
    superseded: "会话被新会话取代",
  };
  enqueueWrite([
    `[${ts}][INFO][session/end] ===== 会话结束: ${outcome} (${label[outcome]})${detail ? ` | ${detail}` : ""} =====`,
  ]);
  await writeChain.catch(() => {});

  setSessionSink(null);
  activeSession = null;
}

/** 当前活动会话信息（用于调试展示）；无会话返回 null。 */
export function getActiveResourceSession(): { fileName: string; mode: PublishFlowMode } | null {
  return activeSession ? { ...activeSession } : null;
}
