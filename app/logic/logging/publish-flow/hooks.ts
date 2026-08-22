/**
 * 资源流程会话的 React 接入点（属于 publish-flow 可移除边界）。
 *
 * 用法：在发布/编辑向导组件里调用一次即可——
 *
 *   usePublishFlowSession({ mode: edit ? "edit" : "publish", meta: sessionMeta });
 *
 * 挂载时自动开启会话文件；卸载时若流程尚未显式结束（PR 创建成功等），
 * 自动标记为 abandoned。显式结束请调用 endResourceSession。
 */
import { useEffect, useRef } from "react";
import {
  finishResourceSession,
  startResourceSession,
  type PublishFlowMode,
  type PublishFlowOutcome,
  type ResourceSessionMeta,
} from "./session";

export interface UsePublishFlowSessionOptions {
  mode: PublishFlowMode;
  /** 进入向导时刻的上下文快照；仅在挂载时取值一次。 */
  meta?: () => ResourceSessionMeta;
}

export function usePublishFlowSession(
  options: UsePublishFlowSessionOptions,
): void {
  const { mode, meta } = options;
  const finishedRef = useRef(false);

  useEffect(() => {
    finishedRef.current = false;
    void startResourceSession(mode, meta?.());
    return () => {
      if (!finishedRef.current) {
        void finishResourceSession("abandoned", "离开向导页面");
      }
    };
    // 会话与进入时刻绑定，上下文只在挂载时采样一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
}

/** 显式结束会话（成功/失败路径），避免卸载时被误标为 abandoned。 */
export async function endResourceSession(
  outcome: Exclude<PublishFlowOutcome, "superseded">,
  detail?: string,
): Promise<void> {
  await finishResourceSession(outcome, detail);
}
