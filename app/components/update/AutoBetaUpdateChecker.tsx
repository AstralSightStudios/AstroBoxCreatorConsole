import { useEffect, useRef, useState } from "react";
import {
  fetchLatestArtifact,
  isBetaRunIgnored,
  isTauriRuntime,
  type BetaArtifactInfo,
} from "~/logic/update/update-checker";
import { isBetaUpdateEnabled } from "~/config/betaUpdate";
import BetaUpdateAvailableDialog from "./BetaUpdateAvailableDialog";

// 启动后延迟检查，避免与首屏加载抢网络
const CHECK_DELAY_MS = 5_000;

/** 应用启动时静默检查一次 GitHub Actions 最新 artifact，有新版且未被忽略时弹窗提示。 */
export default function AutoBetaUpdateChecker() {
  const [info, setInfo] = useState<BetaArtifactInfo | null>(null);
  const [open, setOpen] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (!isTauriRuntime() || !isBetaUpdateEnabled()) return;

          // 获取最新的 artifact 以获取当前 runId 基准
          const latest = await fetchLatestArtifact();
          if (cancelled || !latest) return;

          // 如果已经忽略了这个 run，不提示
          if (isBetaRunIgnored(latest.runId)) return;

          // 这里可以存储当前已知的最新 runId，下次对比
          // 简单起见：只要有 artifact 且未忽略就提示（用户可手动忽略）
          setInfo(latest);
          setOpen(true);
        } catch {
          // 更新检测失败不打扰用户
        }
      })();
    }, CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <BetaUpdateAvailableDialog
      info={info}
      open={open}
      onOpenChange={setOpen}
    />
  );
}